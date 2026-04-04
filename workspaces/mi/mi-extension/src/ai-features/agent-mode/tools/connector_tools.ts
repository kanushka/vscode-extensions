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
import { logInfo, logDebug } from '../../copilot/logger';
import {
    getConnectorStoreCatalog,
    lookupConnectorFromCache,
    ConnectorStoreSource,
} from './connector_store_cache';
import {
    resolveConnectorViaLS,
    getConnectorFromLS,
    readOutputSchema,
    LSConnectorResult,
} from './connector_ls_client';

// ============================================================================
// Utility Functions
// ============================================================================

function normalizeIdentifier(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }
    return value.trim().toLowerCase();
}

function toNames(items: any[]): string[] {
    const names = new Set<string>();
    for (const item of items) {
        const name = item?.connectorName;
        if (typeof name === 'string' && name.length > 0) {
            names.add(name);
        }
    }
    return Array.from(names);
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

    // Also strip known prefixes for artifact ID matching
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

// ============================================================================
// Output Builders
// ============================================================================

/**
 * Build a high-level summary from LS data + static DB metadata.
 */
export function buildLSHighLevelSummary(
    name: string,
    lsResult: LSConnectorResult,
    dbEntry: any | null,
): string {
    const { connectionLocalEntryNeeded, noInitializationNeeded } = deriveInitFlags(lsResult);

    const connectionTypes = Object.keys(lsResult.connectionUiSchema);
    const visibleActions = lsResult.actions.filter(a => !a.isHidden);

    let message = '';

    // Minimal system reminder — only the per-connector init mode (the decision tree is in the system prompt)
    if (noInitializationNeeded) {
        message += `<system-reminder>For this connector, no init is required. Call operations directly, no .init or localEntry required.`;
    } else if (connectionLocalEntryNeeded) {
        message += `<system-reminder>For this connector, localEntry init is required. Create a local entry with <${normalizeIdentifier(name)}.init>, use configKey in operations (the key of the local entry).`;
    } else {
        message += `<system-reminder>For this connector, inline init is required. Call <${normalizeIdentifier(name)}.init> before using any connector operation. No localEntry required.`;
    }
    message += ` Call get_connector_info with include_full_descriptions=true and specific operation_names for richer operation details before writing XML. Use add_or_remove_connector to add the connector to the project.</system-reminder>\n`;

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

    // Version from LS (authoritative)
    message += `- Version: ${lsResult.version || 'unknown'}\n`;

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

        // Try to read output schema
        let outputSchema: any = null;
        if (action.outputSchemaPath) {
            outputSchema = await readOutputSchema(
                lsResult.outputSchemaPath || '',
                action.name
            );
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
            ...(outputSchema ? { outputSchema } : {}),
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
// Catalog Functions (store with fallbacks to static DB)
// ============================================================================

export interface AvailableConnectorCatalog {
    connectors: string[];
    inboundEndpoints: string[];
    storeStatus: 'healthy' | 'degraded';
    warnings: string[];
    runtimeVersionUsed: string;
    source: {
        connectors: ConnectorStoreSource;
        inbounds: ConnectorStoreSource;
    };
}

export async function getAvailableConnectorCatalog(projectPath: string): Promise<AvailableConnectorCatalog> {
    const catalog = await getConnectorStoreCatalog(projectPath, CONNECTOR_DB, INBOUND_DB);
    return {
        connectors: toNames(catalog.connectors),
        inboundEndpoints: toNames(catalog.inbounds),
        storeStatus: catalog.storeStatus,
        warnings: catalog.warnings,
        runtimeVersionUsed: catalog.runtimeVersionUsed,
        source: catalog.source,
    };
}

export async function getAvailableConnectors(projectPath: string): Promise<string[]> {
    const catalog = await getAvailableConnectorCatalog(projectPath);
    return catalog.connectors;
}

export async function getAvailableInboundEndpoints(projectPath: string): Promise<string[]> {
    const catalog = await getAvailableConnectorCatalog(projectPath);
    return catalog.inboundEndpoints;
}

// ============================================================================
// Execute Function Type
// ============================================================================

export type ConnectorExecuteFn = (args: {
    name?: string;
    include_full_descriptions?: boolean;
    operation_names?: string[];
    connection_names?: string[];
}) => Promise<ToolResult>;

// ============================================================================
// Execute Function
// ============================================================================

/**
 * Creates the execute function for get_connector_info tool.
 *
 * Flow:
 * 1. Look up static DB for maven coords + repoName
 * 2. Resolve connector via LS (synapse/resolveDependency — downloads without modifying pom.xml)
 * 3. Query LS for rich connector data (synapse/availableConnectors)
 * 4. Return combined output: static DB (repoName, maven) + LS (operations, params, schemas)
 * 5. If LS fails → error (no store fallback for operation details)
 */
export function createConnectorExecute(projectPath: string): ConnectorExecuteFn {
    return async (args: {
        name?: string;
        include_full_descriptions?: boolean;
        operation_names?: string[];
        connection_names?: string[];
    }): Promise<ToolResult> => {
        const {
            name,
            include_full_descriptions = false,
            operation_names = [],
            connection_names = [],
        } = args;

        const requestedName = typeof name === 'string' ? name.trim() : '';
        if (requestedName.length === 0) {
            return {
                success: false,
                message: 'Provide name for a connector or inbound endpoint.',
                error: 'Error: Missing name for get_connector_info'
            };
        }

        const requestedOperations = normalizeSelectionNames(operation_names);
        const requestedConnections = normalizeSelectionNames(connection_names);
        const warningSet = new Set<string>();

        if (include_full_descriptions && requestedOperations.length === 0 && requestedConnections.length === 0) {
            warningSet.add(
                'include_full_descriptions=true but both operation_names and connection_names are empty. ' +
                'Provide exact names to retrieve detailed parameter descriptions.'
            );
        }

        logInfo(`[ConnectorTool] Fetching info for: ${requestedName}`);

        // Step 1: Look up maven coords from store cache (primary), fallback to static DB
        const { item: storeItem } = await lookupConnectorFromCache(
            projectPath,
            requestedName,
            CONNECTOR_DB,
            INBOUND_DB
        );
        const dbEntry = storeItem ?? findInStaticDB(requestedName);

        // Step 2: Resolve connector via LS (download/extract without pom.xml change)
        if (dbEntry) {
            const groupId = typeof dbEntry.mavenGroupId === 'string' ? dbEntry.mavenGroupId : '';
            const artifactId = typeof dbEntry.mavenArtifactId === 'string' ? dbEntry.mavenArtifactId : '';
            const versionTag = typeof dbEntry.version?.tagName === 'string' ? dbEntry.version.tagName : '';

            if (groupId && artifactId && versionTag) {
                await resolveConnectorViaLS(projectPath, [{
                    groupId,
                    artifact: artifactId,
                    version: versionTag,
                    type: 'zip',
                }]);
            }
        }

        // Step 3: Query LS for rich connector data
        const lsResult = await getConnectorFromLS(projectPath, requestedName);

        // Step 4: Build output — LS only, no store fallback
        if (!lsResult) {
            return {
                success: false,
                message: `Connector or inbound endpoint '${requestedName}' not found. Verify the name matches an available connector.`,
                error: `Error: Connector '${requestedName}' not found via Language Server`
            };
        }

        let message = buildLSHighLevelSummary(requestedName, lsResult, dbEntry);

        // Deep details if requested
        if (include_full_descriptions && (requestedOperations.length > 0 || requestedConnections.length > 0)) {
            const detailPayload = await buildLSOperationDetails(
                requestedName,
                lsResult,
                dbEntry,
                requestedOperations,
                requestedConnections,
                warningSet,
            );
            if (detailPayload) {
                message += `\nSelected Operation Details:\n\`\`\`json\n${JSON.stringify(detailPayload, null, 2)}\n\`\`\`\n`;
            }
        }

        // Prepend warnings
        const warnings = Array.from(warningSet);
        if (warnings.length > 0) {
            message = `Warnings: ${warnings.join(' | ')}\n\n${message}`;
        }

        logDebug(`[ConnectorTool] Retrieved: ${requestedName} | lsAvailable=true | dbEntry=${!!dbEntry}`);

        return { success: true, message };
    };
}

// ============================================================================
// Tool Definition (Vercel AI SDK format)
// ============================================================================

const connectorInputSchema = z.object({
    name: z.string()
        .min(1)
        .describe('Name of a single connector or inbound endpoint to fetch (e.g., "Gmail" or "Kafka (Inbound)"). Use the exact name from available catalogs.'),
    include_full_descriptions: z.boolean()
        .optional()
        .default(false)
        .describe('When true, returns detailed parameter descriptions (xsdType, required, allowedConnectionTypes, outputSchema) for selected operation_names and/or connection_names.'),
    operation_names: z.array(z.string())
        .optional()
        .describe('Operation names for targeted detailed output when include_full_descriptions=true. Example: ["sendMail","readMail"].'),
    connection_names: z.array(z.string())
        .optional()
        .describe('Connection type names for targeted detailed output when include_full_descriptions=true. Example: ["GMAIL_CONNECTION"].'),
});

/**
 * Creates the get_connector_info tool
 */
export function createConnectorTool(execute: ConnectorExecuteFn) {
    return (tool as any)({
        description: `Retrieves info for one MI connector or inbound endpoint by name.
            Resolves the connector via the Language Server for authoritative data (parameters with xsdType, allowedConnectionTypes, supportsResponseModel, outputSchema).
            Default output is a high-level summary with operations list, connection types, and initialization flags.
            Set include_full_descriptions=true with specific operation_names to get detailed parameters and output schemas.
            Does NOT add the connector to the project — use add_or_remove_connector for that.
            Call this tool in parallel for multiple connectors.`,
        inputSchema: connectorInputSchema,
        execute
    });
}
