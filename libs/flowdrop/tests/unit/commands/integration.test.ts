/**
 * Integration Tests — parse and execute round-trip
 *
 * Tests the full pipeline: parseCommand() → executeCommand() / executeBatch()
 * against a mock context, verifying that string commands produce the correct
 * dispatch calls and results.
 */

import { describe, it, expect, vi } from 'vitest';
import { parseCommand } from '../../../src/lib/commands/parser.js';
import { executeCommand } from '../../../src/lib/commands/executor.js';
import { executeBatch } from '../../../src/lib/commands/batch.js';
import { buildTypeMap } from '../../../src/lib/commands/types.js';
import type {
  Command,
  CommandContext,
  CommandDispatch,
  AddNodeResultData,
  GetConfigResultData,
  ListNodesResultData,
  ListTypesResultData
} from '../../../src/lib/commands/types.js';
import type {
  WorkflowNode,
  WorkflowEdge,
  Workflow,
  NodeMetadata
} from '../../../src/lib/types/index.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockMetadata(
  id: string,
  name: string,
  overrides?: Partial<NodeMetadata>
): NodeMetadata {
  return {
    node_type_id: id,
    name,
    category: 'ai',
    inputs: [],
    outputs: [],
    configSchema: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          default: 'gpt-4'
        }
      }
    },
    ...overrides
  } as NodeMetadata;
}

function createMockNode(id: string, metadata: NodeMetadata): WorkflowNode {
  return {
    id,
    type: 'universalNode',
    position: { x: 100, y: 100 },
    deletable: true,
    data: {
      label: metadata.name,
      config: { model: 'gpt-4' },
      metadata
    }
  } as WorkflowNode;
}

function createMockDispatch(): CommandDispatch {
  return {
    addNode: vi.fn(),
    removeNode: vi.fn(),
    updateNode: vi.fn(),
    addEdge: vi.fn(),
    removeEdge: vi.fn(),
    batchUpdate: vi.fn(),
    undo: vi.fn().mockReturnValue(true),
    redo: vi.fn().mockReturnValue(true),
    startTransaction: vi.fn(),
    commitTransaction: vi.fn(),
    cancelTransaction: vi.fn()
  };
}

function createMockWorkflow(nodes: WorkflowNode[] = [], edges: Workflow['edges'] = []): Workflow {
  return {
    id: 'test-workflow',
    name: 'Test Workflow',
    nodes,
    edges
  };
}

const llmMeta = createMockMetadata('agentspec.llm_node', 'LLM Node', {
  inputs: [{ id: 'prompt', name: 'Prompt', type: 'input', dataType: 'string' }],
  outputs: [
    {
      id: 'llm_output',
      name: 'LLM Output',
      type: 'output',
      dataType: 'string'
    }
  ]
});

const apiMeta = createMockMetadata('agentspec.api_node', 'API Node', {
  inputs: [{ id: 'body', name: 'Body', type: 'input', dataType: 'string' }],
  outputs: [{ id: 'response', name: 'Response', type: 'output', dataType: 'string' }]
});

const nodeTypes = [llmMeta, apiMeta];

function createMockContext(workflow: Workflow | null, dispatch?: CommandDispatch): CommandContext {
  return {
    getWorkflow: () => workflow,
    nodeTypes,
    typeMap: buildTypeMap(nodeTypes),
    dispatch: dispatch ?? createMockDispatch()
  };
}

/**
 * Helper: parse a string command and execute it, returning the result.
 */
function parseAndExecute(input: string, context: CommandContext) {
  const parsed = parseCommand(input);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(`Parse failed: ${parsed.error}`);
  return executeCommand(parsed.command, context);
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration: parse → execute round-trip', () => {
  // --------------------------------------------------------------------------
  // add
  // --------------------------------------------------------------------------

  it('add llm_node → dispatch.addNode called with correct node structure', () => {
    const dispatch = createMockDispatch();
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, dispatch);

    const result = parseAndExecute('add llm_node', context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(dispatch.addNode).toHaveBeenCalledOnce();
    const node = (dispatch.addNode as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkflowNode;

    expect(node.type).toBe('universalNode');
    expect(node.deletable).toBe(true);
    expect(node.id).toBeTruthy();
    expect(node.data.config).toEqual({ model: 'gpt-4' }); // config defaults populated
    expect(node.data.label).toBe('LLM Node');
    expect(node.data.metadata).toBe(llmMeta);

    const data = result.data as AddNodeResultData;
    expect(data.nodeId).toContain('llm_node');
    expect(data.type).toBe('llm_node');
    expect(data.label).toBe('LLM Node');
  });

  it('add llm_node at 200,300 → node at exact position', () => {
    const dispatch = createMockDispatch();
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, dispatch);

    const result = parseAndExecute('add llm_node at 200,300', context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const node = (dispatch.addNode as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkflowNode;
    expect(node.position).toEqual({ x: 200, y: 300 });

    const data = result.data as AddNodeResultData;
    expect(data.position).toEqual({ x: 200, y: 300 });
  });

  // --------------------------------------------------------------------------
  // connect
  // --------------------------------------------------------------------------

  it('connect llm_node.1:llm_output to api_node.1:body → dispatch.addEdge with correct handles and styling', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMeta);
    const apiNode = createMockNode('agentspec.api_node.1', apiMeta);
    const workflow = createMockWorkflow([llmNode, apiNode]);
    const context = createMockContext(workflow, dispatch);

    const result = parseAndExecute('connect llm_node.1:llm_output to api_node.1:body', context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(dispatch.addEdge).toHaveBeenCalledOnce();
    const edge = (dispatch.addEdge as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkflowEdge;

    expect(edge.source).toBe('agentspec.llm_node.1');
    expect(edge.target).toBe('agentspec.api_node.1');
    expect(edge.sourceHandle).toBe('agentspec.llm_node.1-output-llm_output');
    expect(edge.targetHandle).toBe('agentspec.api_node.1-input-body');

    // Styling was applied
    expect(edge.style).toBeDefined();
    expect(edge.class).toBeDefined();
    expect(edge.data?.metadata?.edgeType).toBeDefined();
  });

  it('connect with reversed port direction → error result citing metadata', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMeta);
    const apiNode = createMockNode('agentspec.api_node.1', apiMeta);
    const workflow = createMockWorkflow([llmNode, apiNode]);
    const context = createMockContext(workflow, dispatch);

    const result = parseAndExecute('connect api_node.1:body to llm_node.1:llm_output', context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_CONNECTION');
    expect(result.error).toContain('reversed');
    expect(dispatch.addEdge).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // delete
  // --------------------------------------------------------------------------

  it('delete llm_node.1 → dispatch.removeNode called with full internal ID', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMeta);
    const workflow = createMockWorkflow([llmNode]);
    const context = createMockContext(workflow, dispatch);

    const result = parseAndExecute('delete llm_node.1', context);

    expect(result.ok).toBe(true);
    expect(dispatch.removeNode).toHaveBeenCalledOnce();
    expect(dispatch.removeNode).toHaveBeenCalledWith('agentspec.llm_node.1');
  });

  // --------------------------------------------------------------------------
  // set_config
  // --------------------------------------------------------------------------

  it('set llm_node.1:model gpt-4 → dispatch.updateNode called with updated config', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMeta);
    const workflow = createMockWorkflow([llmNode]);
    const context = createMockContext(workflow, dispatch);

    const result = parseAndExecute('set llm_node.1:model gpt-4', context);

    expect(result.ok).toBe(true);

    expect(dispatch.updateNode).toHaveBeenCalledOnce();
    const updateArg = (dispatch.updateNode as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updateArg[0]).toBe('agentspec.llm_node.1');
    expect(updateArg[1].data.config.model).toBe('gpt-4');
  });

  it('set llm_node.1:name "42" → value is string "42", not number', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMeta);
    const workflow = createMockWorkflow([llmNode]);
    const context = createMockContext(workflow, dispatch);

    const result = parseAndExecute('set llm_node.1:name "42"', context);

    expect(result.ok).toBe(true);

    const updateArg = (dispatch.updateNode as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(updateArg[1].data.config.name).toBe('42');
    expect(typeof updateArg[1].data.config.name).toBe('string');
  });

  // --------------------------------------------------------------------------
  // get_config
  // --------------------------------------------------------------------------

  it('get llm_node.1:model → returns correct value from node config', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMeta);
    const workflow = createMockWorkflow([llmNode]);
    const context = createMockContext(workflow, dispatch);

    const result = parseAndExecute('get llm_node.1:model', context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = result.data as GetConfigResultData;
    if (!('key' in data)) throw new Error('expected the single-key shape');
    expect(data.key).toBe('model');
    expect(data.value).toBe('gpt-4');
    expect(data.nodeId).toBe('llm_node.1');
  });

  // --------------------------------------------------------------------------
  // list nodes
  // --------------------------------------------------------------------------

  it('list nodes → returns DSL-format short IDs', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMeta);
    const apiNode = createMockNode('agentspec.api_node.1', apiMeta);
    const workflow = createMockWorkflow([llmNode, apiNode]);
    const context = createMockContext(workflow, dispatch);

    const result = parseAndExecute('list nodes', context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = result.data as ListNodesResultData;
    expect(data.nodes).toHaveLength(2);
    expect(data.nodes[0].nodeId).toBe('llm_node.1');
    expect(data.nodes[1].nodeId).toBe('api_node.1');
    // Short IDs, not namespaced
    expect(data.nodes[0].nodeId).not.toContain('agentspec.');
    expect(data.nodes[1].nodeId).not.toContain('agentspec.');
  });

  // --------------------------------------------------------------------------
  // list types
  // --------------------------------------------------------------------------

  it('list types → returns short type names matching what add accepts', () => {
    const dispatch = createMockDispatch();
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, dispatch);

    const result = parseAndExecute('list types', context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = result.data as ListTypesResultData;
    expect(data.types).toHaveLength(2);

    // Type IDs should be short (no namespace prefix)
    const typeIds = data.types.map((t) => t.typeId);
    expect(typeIds).toContain('llm_node');
    expect(typeIds).toContain('api_node');

    // These short IDs should be what "add <type>" accepts
    for (const typeId of typeIds) {
      const addResult = parseCommand(`add ${typeId}`);
      expect(addResult.ok).toBe(true);
    }
  });

  // --------------------------------------------------------------------------
  // Batch: all success
  // --------------------------------------------------------------------------

  it('batch of [add, add, connect] → transaction used, getWorkflow called per command', () => {
    const dispatch = createMockDispatch();

    // Simulate evolving workflow state across batch commands
    const llmNode = createMockNode('agentspec.llm_node.1', llmMeta);
    const apiNode = createMockNode('agentspec.api_node.1', apiMeta);

    let callCount = 0;
    const getWorkflow = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return createMockWorkflow(); // empty for first add
      } else if (callCount === 2) {
        return createMockWorkflow([llmNode]); // after first add
      }
      return createMockWorkflow([llmNode, apiNode]); // after second add
    });

    const context: CommandContext = {
      getWorkflow,
      nodeTypes,
      typeMap: buildTypeMap(nodeTypes),
      dispatch
    };

    const commands: Command[] = [
      { type: 'add_node', nodeTypeId: 'llm_node' },
      { type: 'add_node', nodeTypeId: 'api_node' },
      {
        type: 'connect',
        sourceNodeId: 'llm_node.1',
        sourcePort: 'llm_output',
        targetNodeId: 'api_node.1',
        targetPort: 'body'
      }
    ];

    const result = executeBatch(commands, context);

    expect(result.ok).toBe(true);
    expect(result.completedCount).toBe(3);
    expect(result.totalCount).toBe(3);

    // Transaction was used
    expect(dispatch.startTransaction).toHaveBeenCalledOnce();
    expect(dispatch.commitTransaction).toHaveBeenCalledOnce();
    expect(dispatch.cancelTransaction).not.toHaveBeenCalled();

    // getWorkflow called before each command
    expect(getWorkflow).toHaveBeenCalledTimes(3);

    // All dispatches happened
    expect(dispatch.addNode).toHaveBeenCalledTimes(2);
    expect(dispatch.addEdge).toHaveBeenCalledOnce();
  });

  // --------------------------------------------------------------------------
  // Batch: error at step 3
  // --------------------------------------------------------------------------

  it('batch with error at step 3 → cancelTransaction called, partial results returned', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMeta);

    let callCount = 0;
    const getWorkflow = vi.fn(() => {
      callCount++;
      if (callCount <= 2) return createMockWorkflow();
      return createMockWorkflow([llmNode]); // only llm_node exists
    });

    const context: CommandContext = {
      getWorkflow,
      nodeTypes,
      typeMap: buildTypeMap(nodeTypes),
      dispatch
    };

    const commands: Command[] = [
      { type: 'add_node', nodeTypeId: 'llm_node' },
      { type: 'add_node', nodeTypeId: 'api_node' },
      { type: 'delete_node', nodeId: 'nonexistent.99' } // will fail
    ];

    const result = executeBatch(commands, context);

    expect(result.ok).toBe(false);
    expect(result.completedCount).toBe(2);
    expect(result.totalCount).toBe(3);
    expect(result.results).toHaveLength(3); // 2 success + 1 error
    expect(result.results[0].ok).toBe(true);
    expect(result.results[1].ok).toBe(true);
    expect(result.results[2].ok).toBe(false);
    expect(result.error).toBeDefined();

    expect(dispatch.startTransaction).toHaveBeenCalledOnce();
    expect(dispatch.cancelTransaction).toHaveBeenCalledOnce();
    expect(dispatch.commitTransaction).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Invalid command string
  // --------------------------------------------------------------------------

  it('invalid command string → parse error with ok: false', () => {
    const result = parseCommand('frobnicate the widget');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Unknown command');
    expect(result.input).toBe('frobnicate the widget');
  });

  it('known verb with bad syntax → parse error with syntax hint', () => {
    const result = parseCommand('add');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Invalid syntax');
    expect(result.error).toContain('add');
  });

  it('empty input → parse error', () => {
    const result = parseCommand('   ');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Empty command');
  });
});
