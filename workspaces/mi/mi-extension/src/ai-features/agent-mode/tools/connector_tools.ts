/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com/) All Rights Reserved.
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { CONNECTOR_DB } from '../context/connectors/connector_db';
import { INBOUND_DB } from '../context/connectors/inbound_db';
import { ToolResult } from './types';
import { logInfo, logDebug, logWarn } from '../../copilot/logger';
import {
    getConnectorStoreCatalog,
    lookupConnectorFromCache,
    isFullArtifactId,
    ConnectorStoreSource,
} from './connector_store_cache';
import {
    getConnectorInfoFromLS,
    getInboundInfoFromLS,
    getLocalInboundCatalog,
    readOutputSchema,
    LSConnectorResult,
    LSInboundResult,
    LocalInboundCatalogEntry,
} from './connector_ls_client';
import {
    resolveTargetVersion,
    describeVersionSource,
    ResolvedVersion,
    VersionResolutionError,
} from './connector_version';

const NO_OUTPUT_SCHEMA_PLACEHOLDER = 'not available for this operation';

// ============================================================================
// Utility Functions
// ============================================================================

function normalizeIdentifier(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim().toLowerCase();
}

function normalizeSelectionNames(names: unknown): string[] {
    if (!Array.isArray(names)) {
        return [];
    }
    return Array.from(
        new Set(
            names
                .map((name) => normalizeIdentifier(name))
                .filter((name) => name.length > 0)
        )
    );
}

/**
 * Derive initialization flags from LS connector result.
 */
function deriveInitFlags(lsResult: LSConnectorResult): { connectionLocalEntryNeeded: boolean; noInitializationNeeded: boolean } {
    const connectionTypes = Object.keys(lsResult.connectionUiSchema);
    const noInitializationNeeded = connectionTypes.length === 0;
    const hasInitAction = lsResult.actions.some(a => normalizeIdentifier(a.name) === 'init');
    const connectionLocalEntryNeeded = noInitializationNeeded ? false : !hasInitAction;
    return { connectionLocalEntryNeeded, noInitializationNeeded };
}

/**
 * Look up a connector/inbound in the static DB for maven coords and repoName.
 * Used only for metadata that the LS doesn't provide (repoName for DeepWiki).
 */
function findInStaticDB(name: string): any | null {
    const normalized = normalizeIdentifier(name);
    if (normalized.length === 0) return null;

    // Fully-qualified artifact id ("mi-inbound-file") must match exactly — otherwise
    // stripped matching incorrectly collapses "mi-inbound-file" and "mi-connector-file"
    // to the same "file" and picks whichever DB comes first.
    if (isFullArtifactId(normalized)) {
        return CONNECTOR_DB.find(c => normalizeIdentifier(c.mavenArtifactId) === normalized)
            || INBOUND_DB.find(c => normalizeIdentifier(c.mavenArtifactId) === normalized)
            || null;
    }

    // Bare name ("file", "File Connector") — loose match on name or stripped artifact id.
    const stripped = normalized.replace(/^(mi-(connector|module|inbound)|esb-connector)-/, '');
    return CONNECTOR_DB.find(c =>
        normalizeIdentifier(c.connectorName) === normalized
        || normalizeIdentifier(c.mavenArtifactId) === normalized
        || normalizeIdentifier(c.connectorName) === stripped
        || normalizeIdentifier(c.mavenArtifactId) === stripped
    ) || INBOUND_DB.find(c =>
        normalizeIdentifier(c.connectorName) === normalized
        || normalizeIdentifier(c.mavenArtifactId) === normalized
        || normalizeIdentifier(c.connectorName) === stripped
        || normalizeIdentifier(c.mavenArtifactId) === stripped
    ) || null;
}

export type IdentifierKind = 'bundled-inbound' | 'maven-inbound' | 'connector';

/**
 * Classify an identifier by shape. User-specified rule:
 *  - Single "word" (no hyphen, no slash) → bundled inbound (e.g. "http", "jms")
 *  - Contains the substring "inbound"    → downloadable (maven) inbound (e.g. "mi-inbound-amazonsqs")
 *  - Otherwise                            → connector (e.g. "mi-connector-redis", "mi-module-fhirbase")
 *
 * This runs on the raw artifact_id from the tool call, before any cache lookup.
 */
export function classifyIdentifier(identifier: string): IdentifierKind {
    const id = typeof identifier === 'string' ? identifier.trim().toLowerCase() : '';
    if (id.length === 0) {
        return 'connector'; // caller handles the empty-input error earlier
    }
    if (!id.includes('-') && !id.includes('/')) {
        return 'bundled-inbound';
    }
    if (id.includes('inbound')) {
        return 'maven-inbound';
    }
    return 'connector';
}

// ============================================================================
// Output Builders
// ============================================================================

/**
 * Build the per-connector init-mode `<system-reminder>` string.
 * Shared between the summary and deep-details outputs.
 */
function buildInitModeReminder(name: string, lsResult: LSConnectorResult): string {
    const { connectionLocalEntryNeeded, noInitializationNeeded } = deriveInitFlags(lsResult);
    const id = normalizeIdentifier(name);
    let body: string;
    if (noInitializationNeeded) {
        body = `For this connector, no init is required. Call operations directly, no .init or localEntry required.`;
    } else if (connectionLocalEntryNeeded) {
        body = `For this connector, localEntry init is required. Create a local entry with <${id}.init>, use configKey in operations (the key of the local entry).`;
    } else {
        body = `For this connector, inline init is required. Call <${id}.init> before using any connector operation. No localEntry required.`;
    }
    return `<system-reminder>${body} Call get_connector_info with include_full_descriptions=true and specific operation_names for richer operation details before writing XML. Use add_or_remove_connector to add the connector to the project.</system-reminder>\n`;
}

/**
 * Build a high-level summary from LS data + static DB metadata.
 */
export function buildLSHighLevelSummary(
    name: string,
    lsResult: LSConnectorResult,
    dbEntry: any | null,
    resolvedVersion?: ResolvedVersion,
): string {
    const { connectionLocalEntryNeeded, noInitializationNeeded } = deriveInitFlags(lsResult);

    const connectionTypes = Object.keys(lsResult.connectionUiSchema);
    const visibleActions = lsResult.actions.filter(a => !a.isHidden);

    let message = buildInitModeReminder(name, lsResult);

    // Header
    message += `### ${lsResult.displayName || name}\n`;

    // GitHub repo from static DB (for DeepWiki)
    const repoName = dbEntry?.repoName;
    if (repoName) {
        message += `- GitHub: wso2-extensions/${repoName}\n`;
    }

    // Maven coordinate
    const groupId = dbEntry?.mavenGroupId || lsResult.packageName || 'unknown';
    const artifactId = dbEntry?.mavenArtifactId || lsResult.artifactId || 'unknown';
    message += `- Maven: ${groupId}:${artifactId}\n`;

    // Version from LS (authoritative for what was actually loaded)
    message += `- Version: ${lsResult.version || 'unknown'}\n`;

    // Where the requested version came from (pom / latest / explicit override)
    if (resolvedVersion) {
        message += `- Version source: ${describeVersionSource(resolvedVersion)}\n`;
    }

    // Init flags
    message += `- Init: ${noInitializationNeeded ? 'none required' : connectionLocalEntryNeeded ? 'localEntry + configKey' : 'in-sequence init'}\n`;

    // Connection types
    if (connectionTypes.length > 0) {
        message += `- Connection Types: ${connectionTypes.join(', ')}\n`;
    }

    // Operations
    const agentActions = visibleActions.filter(a => a.canActAsAgentTool);
    if (agentActions.length > 0) {
        message += `- Operations: ${agentActions.map(a => a.name).join(', ')}\n`;
    } else {
        message += `- Operations: none available\n`;
    }

    return message;
}

/**
 * Build deep operation details from LS data.
 */
async function buildLSOperationDetails(
    name: string,
    lsResult: LSConnectorResult,
    dbEntry: any | null,
    requestedOperations: string[],
    requestedConnections: string[],
    warnings: Set<string>,
): Promise<Record<string, any> | null> {
    const { connectionLocalEntryNeeded, noInitializationNeeded } = deriveInitFlags(lsResult);
    const selectedOperations: any[] = [];
    const selectedConnections: string[] = [];

    // Process requested operations
    for (const reqOp of requestedOperations) {
        const action = lsResult.actions.find(
            a => normalizeIdentifier(a.name) === reqOp
        );

        if (!action) {
            warnings.add(`Requested operation '${reqOp}' was not found for '${name}'.`);
            continue;
        }

        // Try to read output schema. Three states:
        //  1. action declares an outputSchemaPath AND the file reads + parses → use parsed JSON
        //  2. action declares an outputSchemaPath BUT the file is missing/unreadable → warn (likely a bug), use placeholder
        //  3. action does NOT declare an outputSchemaPath → use placeholder (legacy/operation-style connectors)
        let outputSchema: any = NO_OUTPUT_SCHEMA_PLACEHOLDER;
        if (action.outputSchemaPath) {
            const parsed = await readOutputSchema(
                lsResult.outputSchemaPath || '',
                action.name
            );
            if (parsed !== null) {
                outputSchema = parsed;
            } else {
                logWarn(`[ConnectorTool] Output schema declared for '${name}.${action.name}' but could not be read at '${lsResult.outputSchemaPath}/${action.name}.json'`);
            }
        }

        selectedOperations.push({
            name: action.name,
            description: action.description,
            supportsResponseModel: action.supportsResponseModel,
            allowedConnectionTypes: action.allowedConnectionTypes,
            parameters: action.parameters.map(p => ({
                name: p.name,
                description: p.description,
                required: p.required,
                type: p.xsdType,
            })),
            outputSchema,
        });
    }

    // Process requested connections
    const connectionTypes = Object.keys(lsResult.connectionUiSchema);
    for (const reqConn of requestedConnections) {
        const match = connectionTypes.find(
            ct => normalizeIdentifier(ct) === reqConn
        );

        if (!match) {
            warnings.add(`Requested connection '${reqConn}' was not found for '${name}'.`);
            continue;
        }

        selectedConnections.push(match);
    }

    if (selectedOperations.length === 0 && selectedConnections.length === 0) {
        return null;
    }

    const groupId = dbEntry?.mavenGroupId || lsResult.packageName || 'unknown';
    const artifactIdVal = dbEntry?.mavenArtifactId || lsResult.artifactId || 'unknown';

    return {
        name: lsResult.displayName || name,
        maven: `${groupId}:${artifactIdVal}`,
        version: lsResult.version || 'unknown',
        operations: selectedOperations,
        connectionTypes: selectedConnections.length > 0 ? selectedConnections : connectionTypes,
        connectionLocalEntryNeeded,
        noInitializationNeeded,
    };
}

// ============================================================================
// Inbound rendering (parallel to the connector path)
// ============================================================================

/**
 * Build the high-level summary for an inbound endpoint result.
 * No init-mode reminder — inbounds don't have connections / init semantics.
 */
export function buildInboundSummary(
    identifier: string,
    ls: LSInboundResult,
    dbEntry: any | null,
    resolvedVersion?: ResolvedVersion,
): string {
    const visibleParams = ls.parameters;
    const paramList = visibleParams
        .map(p => `${p.name}${p.required ? '*' : ''}`)
        .join(', ');

    let message = `### ${ls.displayName || ls.name || identifier}\n`;

    if (ls.description) {
        message += `- Description: ${ls.description}\n`;
    }
    message += `- Source: ${ls.source}\n`;

    if (ls.source === 'downloaded') {
        const groupId = dbEntry?.mavenGroupId || 'unknown';
        const artifactId = dbEntry?.mavenArtifactId || identifier;
        message += `- Maven: ${groupId}:${artifactId}\n`;
        if (resolvedVersion) {
            message += `- Version: ${resolvedVersion.version}\n`;
            message += `- Version source: ${describeVersionSource(resolvedVersion)}\n`;
        }
    } else {
        // Bundled inbounds have no version; the id is the stable identifier.
        message += `- Id: ${ls.id}\n`;
    }

    if (ls.type) {
        message += `- Type: ${ls.type}\n`;
    }
    message += `- Parameters (${visibleParams.length}, * = required): ${paramList || 'none'}\n`;
    return message;
}

/**
 * Build deep parameter details for an inbound endpoint. Returns a JSON-friendly object
 * or null if the agent didn't request specific parameters and there's nothing to add
 * beyond the summary.
 */
function buildInboundDetails(
    identifier: string,
    ls: LSInboundResult,
    dbEntry: any | null,
    requestedParams: string[],
    warnings: Set<string>,
): Record<string, any> | null {
    let selected = ls.parameters;
    if (requestedParams.length > 0) {
        const wanted = new Set(requestedParams);
        selected = [];
        for (const p of ls.parameters) {
            if (wanted.has(normalizeIdentifier(p.name))) {
                selected.push(p);
            }
        }
        for (const req of requestedParams) {
            if (!ls.parameters.some(p => normalizeIdentifier(p.name) === req)) {
                warnings.add(`Requested parameter '${req}' was not found for inbound '${identifier}'.`);
            }
        }
        if (selected.length === 0) {
            return null;
        }
    }

    const payload: Record<string, any> = {
        name: ls.displayName || ls.name || identifier,
        id: ls.id,
        source: ls.source,
        type: ls.type,
        parameters: selected.map(p => ({
            name: p.name,
            description: p.description,
            required: p.required,
            type: p.xsdType,
        })),
    };
    if (ls.source === 'downloaded' && dbEntry?.mavenGroupId && dbEntry?.mavenArtifactId) {
        payload.maven = `${dbEntry.mavenGroupId}:${dbEntry.mavenArtifactId}`;
    }
    return payload;
}

function renderInboundOutput(
    identifier: string,
    ls: LSInboundResult,
    dbEntry: any | null,
    includeFullDescriptions: boolean,
    requestedParameters: string[],
    resolvedVersion: ResolvedVersion | undefined,
    warningSet: Set<string>,
): string {
    let message: string;
    if (includeFullDescriptions) {
        const detail = buildInboundDetails(identifier, ls, dbEntry, requestedParameters, warningSet);
        message = detail
            ? `Selected Inbound Parameter Details:\n\`\`\`json\n${JSON.stringify(detail, null, 2)}\n\`\`\`\n`
            : '';
    } else {
        message = buildInboundSummary(identifier, ls, dbEntry, resolvedVersion);
    }
    const warnings = Array.from(warningSet);
    if (warnings.length > 0) {
        message = `Warnings: ${warnings.join(' | ')}\n\n${message}`;
    }
    return message;
}

// ============================================================================
// Catalog Functions (store with fallbacks to static DB)
// ============================================================================

export interface AvailableConnectorCatalog {
    // Maven artifact ids from the connector store (e.g. "mi-connector-redis").
    connectorArtifactIds: string[];
    // Maven artifact ids from the connector store for downloadable inbound endpoints
    // (e.g. "mi-inbound-amazonsqs").
    inboundArtifactIds: string[];
    // Bundled inbound ids from the MI runtime (e.g. "http", "jms"). Runtime-dependent.
    bundledInboundIds: string[];
    storeStatus: 'healthy' | 'degraded';
    warnings: string[];
    runtimeVersionUsed: string;
    source: {
        connectors: ConnectorStoreSource;
        inbounds: ConnectorStoreSource;
    };
}

function toArtifactIds(items: any[]): string[] {
    const ids = new Set<string>();
    for (const item of items) {
        const id = item?.mavenArtifactId;
        if (typeof id === 'string' && id.length > 0) {
            ids.add(id);
        }
    }
    return Array.from(ids);
}

export async function getAvailableConnectorCatalog(projectPath: string): Promise<AvailableConnectorCatalog> {
    const [catalog, localInbound] = await Promise.all([
        getConnectorStoreCatalog(projectPath, CONNECTOR_DB, INBOUND_DB),
        getLocalInboundCatalog(projectPath),
    ]);
    return {
        connectorArtifactIds: toArtifactIds(catalog.connectors),
        inboundArtifactIds: toArtifactIds(catalog.inbounds),
        bundledInboundIds: localInbound.bundled.map(b => b.id),
        storeStatus: catalog.storeStatus,
        warnings: catalog.warnings,
        runtimeVersionUsed: catalog.runtimeVersionUsed,
        source: catalog.source,
    };
}

export async function getAvailableConnectors(projectPath: string): Promise<string[]> {
    const catalog = await getAvailableConnectorCatalog(projectPath);
    return catalog.connectorArtifactIds;
}

export async function getAvailableInboundEndpoints(projectPath: string): Promise<string[]> {
    const catalog = await getAvailableConnectorCatalog(projectPath);
    return catalog.inboundArtifactIds;
}

export async function getAvailableBundledInbounds(projectPath: string): Promise<string[]> {
    const catalog = await getAvailableConnectorCatalog(projectPath);
    return catalog.bundledInboundIds;
}

/**
 * Reverse lookup: given an artifact id, return a friendly display name if the
 * store cache / static DB / bundled catalog knows it. Used by tool-action-mapper
 * and UI to show "fetching Redis" instead of "fetching mi-connector-redis".
 *
 * Returns null if unknown — caller should fall back to the raw id.
 */
export async function findDisplayNameForArtifactId(
    projectPath: string,
    artifactId: string
): Promise<string | null> {
    const trimmed = typeof artifactId === 'string' ? artifactId.trim() : '';
    if (trimmed.length === 0) {
        return null;
    }
    const { item } = await lookupConnectorFromCache(projectPath, trimmed, CONNECTOR_DB, INBOUND_DB);
    if (item?.connectorName) {
        return item.connectorName;
    }
    const bundled = findInStaticDB(trimmed);
    if (bundled?.connectorName) {
        return bundled.connectorName;
    }
    // Try bundled inbound list (id → name)
    const local = await getLocalInboundCatalog(projectPath);
    const match = local.bundled.find((b: LocalInboundCatalogEntry) => b.id === trimmed.toLowerCase());
    return match?.name ?? null;
}

// ============================================================================
// Execute Function Type
// ============================================================================

export type ConnectorExecuteFn = (args: {
    artifact_id?: string;
    include_full_descriptions?: boolean;
    operation_names?: string[];
    connection_names?: string[];
    parameter_names?: string[];
    version?: string;
}) => Promise<ToolResult>;

// ============================================================================
// Execute Function
// ============================================================================

/**
 * Creates the execute function for get_connector_info tool.
 *
 * Identifier is a Maven artifact id ("mi-connector-redis") or a bundled inbound id ("jms").
 * Classification picks one of three branches — see `classifyIdentifier`.
 *
 * Connector / maven-inbound flow:
 *   1. Store-cache / static-DB lookup by artifactId for maven coords + repoName + latest version
 *   2. Resolve target version via `resolveTargetVersion` (pom-or-latest default, override honored)
 *   3. Single LS call: `getConnectorInfoFromLS` OR `getInboundInfoFromLS(maven coords)` — LS handles download+parse
 *   4. Render: connector → `buildLSHighLevelSummary` + optional `buildLSOperationDetails`
 *              inbound   → `buildInboundSummary` + optional `buildInboundDetails`
 *
 * Bundled-inbound flow:
 *   1. Single LS call: `getInboundInfoFromLS({id})` — no download, no version
 *   2. Render via `buildInboundSummary` (source: "bundled")
 *   3. Ignore `version` override (with a warning).
 */
export function createConnectorExecute(projectPath: string): ConnectorExecuteFn {
    return async (args: {
        artifact_id?: string;
        include_full_descriptions?: boolean;
        operation_names?: string[];
        connection_names?: string[];
        parameter_names?: string[];
        version?: string;
    }): Promise<ToolResult> => {
        const {
            artifact_id,
            include_full_descriptions = false,
            operation_names = [],
            connection_names = [],
            parameter_names = [],
            version,
        } = args;

        const requestedId = typeof artifact_id === 'string' ? artifact_id.trim() : '';
        if (requestedId.length === 0) {
            return {
                success: false,
                message: 'Provide artifact_id for a connector or inbound endpoint.',
                error: 'Error: Missing artifact_id for get_connector_info'
            };
        }

        const requestedOperations = normalizeSelectionNames(operation_names);
        const requestedConnections = normalizeSelectionNames(connection_names);
        const requestedParameters = normalizeSelectionNames(parameter_names);
        const warningSet = new Set<string>();
        const kind = classifyIdentifier(requestedId);

        logInfo(`[ConnectorTool] artifact_id=${requestedId} kind=${kind} version_override=${version ?? '(default)'}`);

        // --- Bundled inbound branch: no cache lookup, no version resolution ---
        if (kind === 'bundled-inbound') {
            if (typeof version === 'string' && version.trim().length > 0) {
                warningSet.add(`Bundled inbound endpoints have no version concept — override '${version}' ignored.`);
            }
            if (requestedOperations.length > 0 || requestedConnections.length > 0) {
                warningSet.add('operation_names and connection_names apply only to connectors. Use parameter_names for inbound endpoints.');
            }

            const inboundRes = await getInboundInfoFromLS(projectPath, { id: requestedId });
            if ('error' in inboundRes) {
                return {
                    success: false,
                    message: `Bundled inbound endpoint '${requestedId}' not found. ${inboundRes.error}`,
                    error: `Error: ${inboundRes.error}`,
                };
            }

            const message = renderInboundOutput(
                requestedId,
                inboundRes,
                null,
                include_full_descriptions,
                requestedParameters,
                undefined,
                warningSet,
            );
            return { success: true, message };
        }

        // --- Maven-inbound / Connector branch ---
        // Step 1: Look up maven coords from store cache (primary), fall back to static DB.
        const { item: storeItem } = await lookupConnectorFromCache(
            projectPath,
            requestedId,
            CONNECTOR_DB,
            INBOUND_DB
        );
        const dbEntry = storeItem ?? findInStaticDB(requestedId);

        if (!dbEntry) {
            return {
                success: false,
                message: `Artifact id '${requestedId}' was not found in the connector store or the local static catalog. Check the <AVAILABLE_*> lists in the system reminder for valid artifact ids.`,
                error: `Error: Unknown artifact id '${requestedId}'`,
            };
        }

        const groupId = typeof dbEntry.mavenGroupId === 'string' ? dbEntry.mavenGroupId : '';
        const artifactId = typeof dbEntry.mavenArtifactId === 'string' ? dbEntry.mavenArtifactId : '';
        const latestVersion = typeof dbEntry.version?.tagName === 'string' ? dbEntry.version.tagName : '';

        if (!groupId || !artifactId) {
            return {
                success: false,
                message: `'${requestedId}' is missing Maven coordinates in the store/DB — cannot fetch via LS.`,
                error: `Error: Incomplete maven coords for '${requestedId}'`,
            };
        }

        // Step 2: Resolve target version (pom-or-latest default).
        let resolvedVersion: ResolvedVersion;
        try {
            resolvedVersion = await resolveTargetVersion(
                projectPath,
                { name: requestedId, groupId, artifactId, latestVersion },
                version,
                'pom-or-latest'
            );
        } catch (err) {
            if (err instanceof VersionResolutionError) {
                return {
                    success: false,
                    message: err.message,
                    error: `Error: ${err.message}`,
                };
            }
            throw err;
        }

        // Step 3: Single LS call, branching on inbound vs connector.
        if (kind === 'maven-inbound') {
            if (requestedOperations.length > 0 || requestedConnections.length > 0) {
                warningSet.add('operation_names and connection_names apply only to connectors. Use parameter_names for inbound endpoints.');
            }
            const inboundRes = await getInboundInfoFromLS(projectPath, {
                groupId, artifactId, version: resolvedVersion.version,
            });
            if ('error' in inboundRes) {
                return {
                    success: false,
                    message: `Failed to load inbound '${requestedId}' at ${resolvedVersion.version}: ${inboundRes.error}`,
                    error: `Error: ${inboundRes.error}`,
                };
            }

            const message = renderInboundOutput(
                requestedId,
                inboundRes,
                dbEntry,
                include_full_descriptions,
                requestedParameters,
                resolvedVersion,
                warningSet,
            );
            logDebug(`[ConnectorTool] Retrieved maven-inbound: ${requestedId}@${resolvedVersion.version}`);
            return { success: true, message };
        }

        // Connector branch
        if (include_full_descriptions && requestedOperations.length === 0 && requestedConnections.length === 0) {
            warningSet.add(
                'include_full_descriptions=true but both operation_names and connection_names are empty. ' +
                'Provide exact names to retrieve detailed parameter descriptions.'
            );
        }

        const connectorRes = await getConnectorInfoFromLS(projectPath, groupId, artifactId, resolvedVersion.version);
        if ('error' in connectorRes) {
            return {
                success: false,
                message: `Failed to load connector '${requestedId}' at ${resolvedVersion.version}: ${connectorRes.error}`,
                error: `Error: ${connectorRes.error}`,
            };
        }

        const wantsDeepDetails = include_full_descriptions
            && (requestedOperations.length > 0 || requestedConnections.length > 0);

        let message: string;
        if (wantsDeepDetails) {
            message = buildInitModeReminder(requestedId, connectorRes);
            const detailPayload = await buildLSOperationDetails(
                requestedId,
                connectorRes,
                dbEntry,
                requestedOperations,
                requestedConnections,
                warningSet,
            );
            if (detailPayload) {
                message += `\nSelected Operation Details:\n\`\`\`json\n${JSON.stringify(detailPayload, null, 2)}\n\`\`\`\n`;
            }
        } else {
            message = buildLSHighLevelSummary(requestedId, connectorRes, dbEntry, resolvedVersion);
        }

        const warnings = Array.from(warningSet);
        if (warnings.length > 0) {
            message = `Warnings: ${warnings.join(' | ')}\n\n${message}`;
        }

        logDebug(`[ConnectorTool] Retrieved connector: ${requestedId}@${resolvedVersion.version}`);
        return { success: true, message };
    };
}

// ============================================================================
// Tool Definition (Vercel AI SDK format)
// ============================================================================

const connectorInputSchema = z.object({
    artifact_id: z.string()
        .min(1)
        .describe(
            'Maven artifact id for a connector or downloadable inbound endpoint ' +
            '(e.g. "mi-connector-redis", "mi-module-fhirbase", "mi-inbound-amazonsqs"), ' +
            'OR a bundled inbound id (e.g. "http", "jms", "rabbitmq", "mqtt", "hl7"). ' +
            'Classification by shape: single-word (no hyphen) → bundled inbound; contains "inbound" → downloadable inbound; otherwise → connector. ' +
            'Pull ids from the <AVAILABLE_*> lists in the system reminder.'
        ),
    include_full_descriptions: z.boolean()
        .optional()
        .default(false)
        .describe('When true, returns deep details. For connectors: parameter xsdType, required, allowedConnectionTypes, outputSchema for the selected operation_names / connection_names. For inbound endpoints: parameter details for the selected parameter_names. The summary is NOT re-printed in this mode — you only get an init-mode reminder (connectors) or the details JSON.'),
    operation_names: z.array(z.string())
        .optional()
        .describe('Connectors only. Operation names for targeted detailed output when include_full_descriptions=true. Example: ["sendMail","readMail"].'),
    connection_names: z.array(z.string())
        .optional()
        .describe('Connectors only. Connection type names for targeted detailed output when include_full_descriptions=true. Example: ["GMAIL_CONNECTION"].'),
    parameter_names: z.array(z.string())
        .optional()
        .describe('Inbound endpoints only. Parameter names for targeted detailed output when include_full_descriptions=true. Omit to get all parameters.'),
    version: z.string()
        .optional()
        .describe('Optional version selector. Accepts a concrete version string (e.g. "3.1.6"), the literal "latest" (force the store-cache latest), or "pom" (force the version currently declared in the project pom.xml — errors if the artifact is not in pom). When omitted, defaults to "pom if declared, else latest". Bundled inbound endpoints ignore this field (they have no version). The chosen version and its source appear in the response under "Version source".'),
});

/**
 * Creates the get_connector_info tool
 */
export function createConnectorTool(execute: ConnectorExecuteFn) {
    return (tool as any)({
        description: `Retrieves info for one MI connector, downloadable inbound endpoint, or bundled inbound endpoint by its artifact_id.
            Identifier classification by shape: single-word "http"/"jms" → bundled inbound (no download); "mi-inbound-*" → downloadable inbound from Maven; everything else ("mi-connector-*", "mi-module-*") → connector.
            The LS downloads + parses on demand — one call returns everything. Default output is a high-level summary (operations/parameters, version source, init flags for connectors).
            Set include_full_descriptions=true with specific operation_names/connection_names (connectors) or parameter_names (inbounds) to get deep details. In that mode the summary header is NOT re-printed — call without include_full_descriptions first if you need the full summary.
            Use 'version' to pin a specific version, force "latest" from the store, or force "pom" (the version in pom.xml). Default: pom version if declared, else latest. Bundled inbound endpoints have no version — the field is ignored with a warning.
            Connector output schema for each operation is either parsed JSON or the placeholder string "${NO_OUTPUT_SCHEMA_PLACEHOLDER}" — do not retry hoping for a different result.
            Does NOT add the artifact to the project — use add_or_remove_connector for that.
            Call this tool in parallel for multiple artifacts.`,
        inputSchema: connectorInputSchema,
        execute
    });
}
