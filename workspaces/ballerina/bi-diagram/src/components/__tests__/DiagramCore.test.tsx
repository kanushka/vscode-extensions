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

/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, prettyDOM } from '@testing-library/react';
import { DiagramCore } from '../DiagramCore';
import { DiagramContextProvider, DiagramContextState } from '../DiagramContext';
import { Flow } from '../../utils/types';

// Import the test data
const startModelData = require('../../stories/1-start.json');
const startModel = startModelData as Flow;

// Mock localStorage
const localStorageMock = (() => {
    let store: { [key: string]: string } = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
            store[key] = value.toString();
        },
        clear: () => {
            store = {};
        },
        removeItem: (key: string) => {
            delete store[key];
        }
    };
})();

Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
});

const mockContext: DiagramContextState = {
    flow: startModel,
    componentPanel: {
        visible: false,
        show: jest.fn(),
        hide: jest.fn(),
    },
    showErrorFlow: false,
    expandedErrorHandler: undefined,
    toggleErrorHandlerExpansion: jest.fn(),
    onAddNode: jest.fn(),
    onAddNodePrompt: jest.fn(),
    onDeleteNode: jest.fn(),
    onAddComment: jest.fn(),
    onNodeSelect: jest.fn(),
    onNodeSave: jest.fn(),
    addBreakpoint: jest.fn(),
    removeBreakpoint: jest.fn(),
    onConnectionSelect: jest.fn(),
    goToSource: jest.fn(),
    openView: jest.fn(),
    agentNode: {
        onModelSelect: jest.fn(),
        onAddTool: jest.fn(),
        onAddMcpServer: jest.fn(),
        onSelectTool: jest.fn(),
        onSelectMcpToolkit: jest.fn(),
        onDeleteTool: jest.fn(),
        goToTool: jest.fn(),
        onSelectMemoryManager: jest.fn(),
        onDeleteMemoryManager: jest.fn(),
    },
    aiNodes: {
        onModelSelect: jest.fn(),
    },
    suggestions: {
        fetching: false,
        onAccept: jest.fn(),
        onDiscard: jest.fn(),
    },
    projectPath: "",
    readOnly: false,
    lockCanvas: false,
    setLockCanvas: jest.fn(),
    expressionContext: {
        completions: [],
        triggerCharacters: [],
        retrieveCompletions: jest.fn().mockResolvedValue(undefined),
    }
};

describe('DiagramCore Component', () => {
  it('should render correctly and match snapshot', () => {
    const { container } = render(
      <DiagramContextProvider value={mockContext}>
        <DiagramCore model={startModel} />
      </DiagramContextProvider>
    );
    
    const prettyDom = prettyDOM(container, 1000000, {
        highlight: false,
    });

    const sanitizedDom = prettyDom.replaceAll(/\s+(marker-end|id)="[^"]*"/g, '');
    expect(sanitizedDom).toMatchSnapshot();
  });
});
