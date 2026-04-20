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

// ============================================================================
// DeepWiki MCP — Local MCP Client Bridge
// ============================================================================

import { tool } from 'ai';
import { createMCPClient } from '@ai-sdk/mcp';
import { z } from 'zod';
import { logDebug, logError, logInfo } from '../../copilot/logger';
import {
    DEEPWIKI_MCP_TOOL_NAME,
    DeepWikiAskQuestionExecuteFn,
    ToolResult,
} from './types';

/**
 * DeepWiki remote MCP endpoint.
 */
const DEEPWIKI_MCP_URL = 'https://mcp.deepwiki.com/mcp';

const deepWikiQuestionSchema = z.object({
    repoName: z.union([
        z.string().min(3),
        z.array(z.string().min(3)).min(1),
    ]).describe('GitHub repo (or array of repos) to query, e.g. "wso2/wso2-synapse" or ["wso2/wso2-synapse","wso2/product-micro-integrator"].'),
    question: z.string().min(3).describe('Specific source-level question to ask DeepWiki.'),
});

function normalizeRepoName(repoName: string | string[]): string | string[] {
    if (Array.isArray(repoName)) {
        return Array.from(
            new Set(
                repoName
                    .map((item) => item.trim())
                    .filter((item) => item.length > 0)
            )
        );
    }
    return repoName.trim();
}

function normalizeDeepWikiContent(content: unknown): string {
    if (!Array.isArray(content)) {
        if (typeof content === 'string') {
            return content;
        }
        return content === undefined ? '' : JSON.stringify(content, null, 2);
    }

    const textBlocks: string[] = [];
    for (const block of content) {
        if (typeof block === 'string') {
            if (block.trim().length > 0) {
                textBlocks.push(block);
            }
            continue;
        }

        if (!block || typeof block !== 'object') {
            continue;
        }

        const text = (block as { text?: unknown }).text;
        if (typeof text === 'string' && text.trim().length > 0) {
            textBlocks.push(text);
            continue;
        }

        textBlocks.push(JSON.stringify(block, null, 2));
    }

    return textBlocks.join('\n\n').trim();
}

function toToolResult(output: any): ToolResult {
    const message = normalizeDeepWikiContent(output?.content)
        || (output?.structuredContent ? JSON.stringify(output.structuredContent, null, 2) : '')
        || (typeof output === 'string' ? output : JSON.stringify(output, null, 2));

    if (output?.isError === true) {
        return {
            success: false,
            message: message || 'DeepWiki returned an error.',
            error: 'DEEPWIKI_QUERY_FAILED',
        };
    }

    return {
        success: true,
        message: message || 'DeepWiki query completed successfully.',
    };
}

/**
 * Creates execute function for the DeepWiki ask_question tool.
 * Uses a local MCP client (AI SDK MCP bridge) instead of Anthropic server-side mcpServers.
 *
 * The optional `mainAbortSignal` is threaded into the MCP client call so a
 * user-initiated abort stops the in-flight HTTP request instead of blocking
 * until the remote server responds.
 */
export function createDeepWikiExecute(mainAbortSignal?: AbortSignal): DeepWikiAskQuestionExecuteFn {
    return async (args): Promise<ToolResult> => {
        const repoName = normalizeRepoName(args.repoName);
        if ((Array.isArray(repoName) && repoName.length === 0) || (!Array.isArray(repoName) && repoName.length === 0)) {
            return {
                success: false,
                message: 'DeepWiki query failed: repoName is required.',
                error: 'DEEPWIKI_INVALID_INPUT',
            };
        }

        const question = args.question.trim();
        if (!question) {
            return {
                success: false,
                message: 'DeepWiki query failed: question is required.',
                error: 'DEEPWIKI_INVALID_INPUT',
            };
        }

        if (mainAbortSignal?.aborted) {
            return {
                success: false,
                message: 'DeepWiki query aborted before dispatch.',
                error: 'DEEPWIKI_ABORTED',
            };
        }

        let client: any;
        try {
            logInfo('[DeepWikiTool] Querying DeepWiki MCP server');
            client = await createMCPClient({
                transport: {
                    type: 'http',
                    url: DEEPWIKI_MCP_URL,
                    redirect: 'error',
                },
            });

            const tools = await client.tools({
                schemas: {
                    [DEEPWIKI_MCP_TOOL_NAME]: {
                        inputSchema: deepWikiQuestionSchema,
                    },
                },
            });

            const askQuestionTool = (tools as Record<string, any>)[DEEPWIKI_MCP_TOOL_NAME];
            if (!askQuestionTool || typeof askQuestionTool.execute !== 'function') {
                throw new Error(`DeepWiki MCP tool '${DEEPWIKI_MCP_TOOL_NAME}' is unavailable.`);
            }

            const output = await askQuestionTool.execute(
                { repoName, question },
                {
                    toolCallId: `deepwiki_${Date.now()}`,
                    messages: [],
                    abortSignal: mainAbortSignal,
                } as any
            );

            const result = toToolResult(output);
            if (!result.success) {
                logDebug(`[DeepWikiTool] DeepWiki returned error output: ${JSON.stringify(output)}`);
            }
            return result;
        } catch (error: any) {
            logError('[DeepWikiTool] DeepWiki query failed', error);
            return {
                success: false,
                message: `DeepWiki query failed: ${error?.message || String(error)}`,
                error: 'DEEPWIKI_QUERY_FAILED',
            };
        } finally {
            if (client) {
                try {
                    await client.close();
                } catch (closeError) {
                    logDebug(`[DeepWikiTool] Failed to close MCP client cleanly: ${String(closeError)}`);
                }
            }
        }
    };
}

/**
 * Tool definition for DeepWiki ask_question.
 */
export function createDeepWikiTool(execute: DeepWikiAskQuestionExecuteFn) {
    return (tool as any)({
        description: 'Query DeepWiki for source-grounded answers from specific GitHub repositories. Provide repoName and a focused technical question.',
        inputSchema: deepWikiQuestionSchema,
        execute,
    });
}
