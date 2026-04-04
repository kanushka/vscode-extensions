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

import * as fs from 'fs';
import * as path from 'path';
import { MILanguageClient } from '../../../lang-client/activator';
import { logDebug, logWarn } from '../../copilot/logger';

// ============================================================================
// Types
// ============================================================================

export interface LSConnectorAction {
    name: string;
    tag: string;
    displayName: string;
    description: string;
    isHidden: boolean;
    supportsResponseModel: boolean;
    canActAsAgentTool: boolean;
    allowedConnectionTypes: string[];
    parameters: Array<{
        name: string;
        description: string;
        required: boolean;
        xsdType: string;
    }>;
    outputSchemaPath?: string;
}

export interface LSConnectorResult {
    name: string;
    displayName: string;
    artifactId: string;
    version: string;
    packageName: string;
    uiSchemaPath: string;
    outputSchemaPath: string;
    connectionUiSchema: Record<string, string>;
    actions: LSConnectorAction[];
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Find a document URI within the project for LS requests.
 * Uses pom.xml as the reference document.
 */
function getDocumentUri(projectPath: string): string {
    return path.join(projectPath, 'pom.xml');
}

/**
 * Normalize a connector name for LS lookup.
 * The LS uses lowercase internal names (e.g. "gmail"), but the agent may pass
 * "Gmail", "mi-connector-gmail", "esb-connector-amazons3", etc.
 */
function normalizeConnectorNameForLS(name: string): string {
    let normalized = name.trim().toLowerCase();
    // Strip known artifact ID prefixes
    normalized = normalized.replace(/^(mi-(connector|module|inbound)|esb-connector)-/, '');
    return normalized;
}

/**
 * Map raw LS action data to typed LSConnectorAction.
 */
function mapAction(raw: any): LSConnectorAction {
    return {
        name: typeof raw?.name === 'string' ? raw.name : '',
        tag: typeof raw?.tag === 'string' ? raw.tag : '',
        displayName: typeof raw?.displayName === 'string' ? raw.displayName : '',
        description: typeof raw?.description === 'string' ? raw.description : '',
        isHidden: raw?.hidden === true,
        supportsResponseModel: raw?.supportsResponseModel === true,
        canActAsAgentTool: raw?.canActAsAgentTool !== false, // defaults to true
        allowedConnectionTypes: Array.isArray(raw?.allowedConnectionTypes) ? raw.allowedConnectionTypes : [],
        parameters: Array.isArray(raw?.parameters)
            ? raw.parameters.map((p: any) => ({
                name: typeof p?.name === 'string' ? p.name : '',
                description: typeof p?.description === 'string' ? p.description : '',
                required: p?.required === true,
                xsdType: typeof p?.xsdType === 'string' ? p.xsdType : 'xs:string',
            }))
            : [],
        outputSchemaPath: typeof raw?.outputSchemaPath === 'string' ? raw.outputSchemaPath : undefined,
    };
}

/**
 * Map raw LS connector response to typed LSConnectorResult.
 */
function mapConnectorResult(raw: any): LSConnectorResult | null {
    if (!raw || typeof raw.name !== 'string') {
        return null;
    }

    return {
        name: raw.name,
        displayName: typeof raw.displayName === 'string' ? raw.displayName : raw.name,
        artifactId: typeof raw.artifactId === 'string' ? raw.artifactId : '',
        version: typeof raw.version === 'string' ? raw.version : '',
        packageName: typeof raw.packageName === 'string' ? raw.packageName : '',
        uiSchemaPath: typeof raw.uiSchemaPath === 'string' ? raw.uiSchemaPath : '',
        outputSchemaPath: typeof raw.outputSchemaPath === 'string' ? raw.outputSchemaPath : '',
        connectionUiSchema: (raw.connectionUiSchema && typeof raw.connectionUiSchema === 'object')
            ? raw.connectionUiSchema as Record<string, string>
            : {},
        actions: Array.isArray(raw.actions) ? raw.actions.map(mapAction) : [],
    };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve a connector via LS — downloads/extracts WITHOUT modifying pom.xml.
 * Uses the new synapse/resolveDependency endpoint.
 */
export async function resolveConnectorViaLS(
    projectPath: string,
    dependencies: Array<{ groupId: string; artifact: string; version: string; type?: string }>
): Promise<boolean> {
    try {
        const langClient = await MILanguageClient.getInstance(projectPath);
        if (!langClient) {
            logWarn('[ConnectorLSClient] Language client not available');
            return false;
        }

        await langClient.resolveDependency({ dependencies: dependencies.map(d => ({ ...d, type: d.type as any })) });
        logDebug(`[ConnectorLSClient] Resolved ${dependencies.length} dependency(ies) via LS`);
        return true;
    } catch (error) {
        logWarn(`[ConnectorLSClient] Failed to resolve dependencies via LS: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

/**
 * Get a single installed/resolved connector from the LS.
 * Returns null if the connector is not available or LS is unavailable.
 */
export async function getConnectorFromLS(
    projectPath: string,
    connectorName: string
): Promise<LSConnectorResult | null> {
    try {
        const langClient = await MILanguageClient.getInstance(projectPath);
        if (!langClient) {
            logWarn('[ConnectorLSClient] Language client not available');
            return null;
        }

        const documentUri = getDocumentUri(projectPath);
        const normalizedName = normalizeConnectorNameForLS(connectorName);
        const response = await langClient.getAvailableConnectors({
            documentUri,
            connectorName: normalizedName,
        });

        if (!response || !response.name) {
            logDebug(`[ConnectorLSClient] Connector '${connectorName}' not found in LS`);
            return null;
        }

        return mapConnectorResult(response);
    } catch (error) {
        logWarn(`[ConnectorLSClient] Failed to get connector '${connectorName}' from LS: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

/**
 * Get all installed/resolved connectors from the LS.
 */
export async function getAllConnectorsFromLS(
    projectPath: string
): Promise<LSConnectorResult[]> {
    try {
        const langClient = await MILanguageClient.getInstance(projectPath);
        if (!langClient) {
            logWarn('[ConnectorLSClient] Language client not available');
            return [];
        }

        const documentUri = getDocumentUri(projectPath);
        const response = await langClient.getAvailableConnectors({
            documentUri,
            connectorName: '',
        });

        if (!response || !Array.isArray(response.connectors)) {
            return [];
        }

        const results: LSConnectorResult[] = [];
        for (const raw of response.connectors) {
            const mapped = mapConnectorResult(raw);
            if (mapped) {
                results.push(mapped);
            }
        }

        logDebug(`[ConnectorLSClient] Found ${results.length} connector(s) from LS`);
        return results;
    } catch (error) {
        logWarn(`[ConnectorLSClient] Failed to get connectors from LS: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

/**
 * Read the output schema JSON for a specific operation from disk.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export async function readOutputSchema(
    outputSchemaDir: string,
    operationName: string
): Promise<any | null> {
    try {
        const schemaPath = path.join(outputSchemaDir, `${operationName}.json`);
        if (!fs.existsSync(schemaPath)) {
            return null;
        }

        const content = fs.readFileSync(schemaPath, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        logDebug(`[ConnectorLSClient] Failed to read output schema for '${operationName}': ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}
