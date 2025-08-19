/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com) All Rights Reserved.
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import React, { useState, memo } from "react";
import { Flow, FlowNode, Branch, LineRange, NodePosition, ToolData } from "../utils/types";
import { DiagramContextProvider, DiagramContextState, ExpressionContextProps } from "./DiagramContext";
import { CurrentBreakpointsResponse as BreakpointInfo } from "@wso2/ballerina-core";
import { DiagramCore } from "./DiagramCore";

export interface DiagramProps {
    model: Flow;
    onAddNode?: (parent: FlowNode | Branch, target: LineRange) => void;
    onAddNodePrompt?: (parent: FlowNode | Branch, target: LineRange, prompt: string) => void;
    onDeleteNode?: (node: FlowNode) => void;
    onAddComment?: (comment: string, target: LineRange) => void;
    onNodeSelect?: (node: FlowNode) => void;
    onNodeSave?: (node: FlowNode) => void;
    addBreakpoint?: (node: FlowNode) => void;
    removeBreakpoint?: (node: FlowNode) => void;
    onConnectionSelect?: (connectionName: string) => void;
    goToSource?: (node: FlowNode) => void;
    openView?: (filePath: string, position: NodePosition) => void;
    // agent node callbacks
    agentNode?: {
        onModelSelect: (node: FlowNode) => void;
        onAddTool: (node: FlowNode) => void;
        onAddMcpServer: (node: FlowNode) => void;
        onSelectTool: (tool: ToolData, node: FlowNode) => void;
        onSelectMcpToolkit: (tool: ToolData, node: FlowNode) => void;
        onDeleteTool: (tool: ToolData, node: FlowNode) => void;
        goToTool: (tool: ToolData, node: FlowNode) => void;
        onSelectMemoryManager: (node: FlowNode) => void;
        onDeleteMemoryManager: (node: FlowNode) => void;
    };
    // ai nodes callbacks
    aiNodes?: {
        onModelSelect: (node: FlowNode) => void;
    };
    // ai suggestions callbacks
    suggestions?: {
        fetching: boolean;
        onAccept(): void;
        onDiscard(): void;
    };
    projectPath?: string;
    breakpointInfo?: BreakpointInfo;
    readOnly?: boolean;
    expressionContext?: ExpressionContextProps;
    organizationLocation?: string;
    getProjectPath?: (fileName: string) => Promise<string>;
}

// Wrapper component with context provider
export function Diagram(props: DiagramProps) {
    const {
        model,
        onAddNode,
        onAddNodePrompt,
        onDeleteNode,
        onAddComment,
        onNodeSelect,
        onNodeSave,
        onConnectionSelect,
        goToSource,
        openView,
        agentNode,
        aiNodes,
        suggestions,
        projectPath,
        addBreakpoint,
        removeBreakpoint,
        breakpointInfo,
        readOnly,
        expressionContext,
        organizationLocation,
        getProjectPath
    } = props;

    const [showComponentPanel, setShowComponentPanel] = useState(false);
    const [showErrorFlow, setShowErrorFlow] = useState(false);
    const [expandedErrorHandler, setExpandedErrorHandler] = useState<string | undefined>(undefined);

    const handleCloseComponentPanel = () => {
        setShowComponentPanel(false);
    };

    const handleShowComponentPanel = () => {
        setShowComponentPanel(true);
    };

    const toggleErrorHandlerExpansion = (nodeId: string) => {
        setExpandedErrorHandler((prev) => (prev === nodeId ? undefined : nodeId));
    };

    const context: DiagramContextState = {
        flow: model,
        componentPanel: {
            visible: showComponentPanel,
            show: handleShowComponentPanel,
            hide: handleCloseComponentPanel,
        },
        showErrorFlow: showErrorFlow,
        expandedErrorHandler: expandedErrorHandler,
        toggleErrorHandlerExpansion: toggleErrorHandlerExpansion,
        onAddNode: onAddNode,
        onAddNodePrompt: onAddNodePrompt,
        onDeleteNode: onDeleteNode,
        onAddComment: onAddComment,
        onNodeSelect: onNodeSelect,
        onNodeSave: onNodeSave,
        addBreakpoint: addBreakpoint,
        removeBreakpoint: removeBreakpoint,
        onConnectionSelect: onConnectionSelect,
        goToSource: goToSource,
        openView: openView,
        agentNode: agentNode,
        aiNodes: aiNodes,
        suggestions: suggestions,
        projectPath: projectPath,
        readOnly: onAddNode === undefined || onDeleteNode === undefined || onNodeSelect === undefined || readOnly,
        expressionContext: expressionContext,
        organizationLocation: organizationLocation,
        getProjectPath: getProjectPath
    };

    return (
        <DiagramContextProvider value={context}>
            <DiagramCore {...props} />
        </DiagramContextProvider>
    );
}

export const MemoizedDiagram = memo(Diagram);

// Re-export DiagramCore for direct testing
export { DiagramCore } from "./DiagramCore";
