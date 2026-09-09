import { describe, it, expect, vi } from 'vitest';
import {
  executeCommand,
  toShortId,
  toShortTypeId,
  resolveNode
} from '../../../src/lib/commands/executor.js';
import type {
  CommandContext,
  CommandDispatch,
  AddNodeResultData,
  GetConfigResultData,
  InfoResultData,
  ListNodesResultData,
  ListEdgesResultData,
  ListTypesResultData,
  HelpResultData
} from '../../../src/lib/commands/types.js';
import type {
  WorkflowNode,
  WorkflowEdge,
  Workflow,
  NodeMetadata,
  ConfigProperty
} from '../../../src/lib/types/index.js';
import { buildTypeMap } from '../../../src/lib/commands/types.js';

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
        },
        temperature: {
          type: 'number',
          default: 0.7
        }
      }
    },
    ...overrides
  } as NodeMetadata;
}

function createMockNode(
  id: string,
  metadata: NodeMetadata,
  overrides?: Partial<WorkflowNode>
): WorkflowNode {
  return {
    id,
    type: 'universalNode',
    position: { x: 100, y: 100 },
    deletable: true,
    data: {
      label: metadata.name,
      config: { model: 'gpt-4', temperature: 0.7 },
      metadata
    },
    ...overrides
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

function createMockContext(
  workflow: Workflow | null,
  nodeTypes: NodeMetadata[],
  dispatch?: CommandDispatch
): CommandContext {
  return {
    getWorkflow: () => workflow,
    nodeTypes,
    typeMap: buildTypeMap(nodeTypes),
    dispatch: dispatch ?? createMockDispatch()
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

// ============================================================================
// Helper Tests
// ============================================================================

describe('toShortId', () => {
  it('strips namespace from namespaced ID', () => {
    expect(toShortId('agentspec.llm_node.1')).toBe('llm_node.1');
  });

  it('returns unchanged for non-namespaced ID', () => {
    expect(toShortId('llm_node.1')).toBe('llm_node.1');
  });

  it('strips namespace from multi-segment type', () => {
    expect(toShortId('agentspec.boolean_gateway.2')).toBe('boolean_gateway.2');
  });

  it('returns unchanged for single segment', () => {
    expect(toShortId('someNode')).toBe('someNode');
  });
});

describe('resolveNode', () => {
  const metadata = createMockMetadata('agentspec.llm_node', 'LLM Node');
  const node = createMockNode('agentspec.llm_node.1', metadata);
  const nodes = [node];

  it('resolves by exact ID', () => {
    expect(resolveNode('agentspec.llm_node.1', nodes)).toBe(node);
  });

  it('resolves by short ID', () => {
    expect(resolveNode('llm_node.1', nodes)).toBe(node);
  });

  it('returns undefined for non-existent ID', () => {
    expect(resolveNode('llm_node.99', nodes)).toBeUndefined();
  });
});

// ============================================================================
// add_node
// ============================================================================

describe('executeCommand — add_node', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node');
  const nodeTypes = [llmMetadata];

  it('adds a node with auto-position on empty canvas', () => {
    const dispatch = createMockDispatch();
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'add_node', nodeTypeId: 'llm_node' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Verify dispatch was called
    expect(dispatch.addNode).toHaveBeenCalledOnce();
    const addedNode = (dispatch.addNode as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as WorkflowNode;

    // Node structure must match drag-and-drop parity
    expect(addedNode.id).toBe('agentspec.llm_node.1');
    expect(addedNode.type).toBe('universalNode');
    expect(addedNode.deletable).toBe(true);
    expect(addedNode.id).toBe('agentspec.llm_node.1');
    expect(addedNode.data.label).toBe('LLM Node');
    expect(addedNode.data.metadata).toBe(llmMetadata);
    expect(addedNode.data.config).toEqual({ model: 'gpt-4', temperature: 0.7 });

    // Auto-positioned on empty canvas
    expect(addedNode.position).toEqual({ x: 100, y: 100 });

    // Result data uses short IDs
    const data = result.data as AddNodeResultData;
    expect(data.nodeId).toBe('llm_node.1');
    expect(data.type).toBe('llm_node');
    expect(data.label).toBe('LLM Node');
    expect(data.position).toEqual({ x: 100, y: 100 });
  });

  it('adds a node at explicit position', () => {
    const dispatch = createMockDispatch();
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'add_node',
        nodeTypeId: 'llm_node',
        position: { x: 200, y: 300 }
      },
      context
    );

    expect(result.ok).toBe(true);
    const addedNode = (dispatch.addNode as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as WorkflowNode;
    expect(addedNode.position).toEqual({ x: 200, y: 300 });
  });

  it('auto-positions relative to existing nodes', () => {
    const dispatch = createMockDispatch();
    const existingNode = createMockNode('agentspec.llm_node.1', llmMetadata, {
      position: { x: 400, y: 200 }
    });
    const workflow = createMockWorkflow([existingNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'add_node', nodeTypeId: 'llm_node' }, context);

    expect(result.ok).toBe(true);
    const addedNode = (dispatch.addNode as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as WorkflowNode;
    expect(addedNode.position).toEqual({ x: 650, y: 200 });

    // Second node gets .2
    expect(addedNode.id).toBe('agentspec.llm_node.2');
    const data = (result as { ok: true; data: AddNodeResultData }).data;
    expect(data.nodeId).toBe('llm_node.2');
  });

  it('returns NODE_TYPE_NOT_FOUND for unknown type', () => {
    const context = createMockContext(createMockWorkflow(), nodeTypes);

    const result = executeCommand({ type: 'add_node', nodeTypeId: 'nonexistent_type' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_TYPE_NOT_FOUND');
    expect(result.error).toContain('nonexistent_type');
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand({ type: 'add_node', nodeTypeId: 'llm_node' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });

  it('resolves full namespaced type ID', () => {
    const dispatch = createMockDispatch();
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'add_node', nodeTypeId: 'agentspec.llm_node' }, context);

    expect(result.ok).toBe(true);
    expect(dispatch.addNode).toHaveBeenCalledOnce();
  });

  it('populates config from configSchema defaults', () => {
    const dispatch = createMockDispatch();
    const metaWithConfig = createMockMetadata('agentspec.api_node', 'API Node', {
      configSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', default: 'https://example.com' },
          method: { type: 'string', default: 'GET' },
          timeout: { type: 'number', default: 30 }
        }
      }
    });
    const context = createMockContext(createMockWorkflow(), [metaWithConfig], dispatch);

    executeCommand({ type: 'add_node', nodeTypeId: 'api_node' }, context);

    const addedNode = (dispatch.addNode as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as WorkflowNode;
    expect(addedNode.data.config).toEqual({
      url: 'https://example.com',
      method: 'GET',
      timeout: 30
    });
  });

  it('handles metadata with no configSchema', () => {
    const dispatch = createMockDispatch();
    const metaNoConfig = createMockMetadata('agentspec.simple_node', 'Simple Node', {
      configSchema: undefined
    });
    const context = createMockContext(createMockWorkflow(), [metaNoConfig], dispatch);

    executeCommand({ type: 'add_node', nodeTypeId: 'simple_node' }, context);

    const addedNode = (dispatch.addNode as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as WorkflowNode;
    expect(addedNode.data.config).toEqual({});
  });
});

// ============================================================================
// delete_node
// ============================================================================

describe('executeCommand — delete_node', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node');
  const nodeTypes = [llmMetadata];

  it('deletes a node by short ID', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'delete_node', nodeId: 'llm_node.1' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain('llm_node.1');
    // dispatch.removeNode called with the full internal ID
    expect(dispatch.removeNode).toHaveBeenCalledWith('agentspec.llm_node.1');
  });

  it('deletes a node by full ID', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'delete_node', nodeId: 'agentspec.llm_node.1' }, context);

    expect(result.ok).toBe(true);
    expect(dispatch.removeNode).toHaveBeenCalledWith('agentspec.llm_node.1');
  });

  it('returns NODE_NOT_FOUND for missing node', () => {
    const context = createMockContext(createMockWorkflow(), nodeTypes);

    const result = executeCommand({ type: 'delete_node', nodeId: 'llm_node.99' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_NOT_FOUND');
    expect(result.error).toContain('llm_node.99');
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand({ type: 'delete_node', nodeId: 'llm_node.1' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });
});

// ============================================================================
// toShortTypeId
// ============================================================================

describe('toShortTypeId', () => {
  it('strips namespace from type ID', () => {
    expect(toShortTypeId('agentspec.llm_node')).toBe('llm_node');
  });

  it('returns unchanged for non-namespaced type ID', () => {
    expect(toShortTypeId('llm_node')).toBe('llm_node');
  });
});

// ============================================================================
// rename_node
// ============================================================================

describe('executeCommand — rename_node', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node');
  const nodeTypes = [llmMetadata];

  it('renames a node', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'rename_node', nodeId: 'llm_node.1', label: 'My Custom LLM' },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain('My Custom LLM');
    expect(dispatch.updateNode).toHaveBeenCalledWith(
      'agentspec.llm_node.1',
      expect.objectContaining({
        data: expect.objectContaining({ label: 'My Custom LLM' })
      })
    );
  });

  it('preserves other data fields when renaming', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    executeCommand({ type: 'rename_node', nodeId: 'llm_node.1', label: 'New Name' }, context);

    const updateCall = (dispatch.updateNode as ReturnType<typeof vi.fn>).mock.calls[0];
    const updatedData = updateCall[1].data;
    expect(updatedData.config).toEqual({ model: 'gpt-4', temperature: 0.7 });
    expect(updatedData.metadata).toBe(llmMetadata);
  });

  it('returns NODE_NOT_FOUND for missing node', () => {
    const context = createMockContext(createMockWorkflow(), nodeTypes);

    const result = executeCommand(
      { type: 'rename_node', nodeId: 'llm_node.99', label: 'Test' },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_NOT_FOUND');
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand(
      { type: 'rename_node', nodeId: 'llm_node.1', label: 'Test' },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });
});

// ============================================================================
// set_config
// ============================================================================

describe('executeCommand — set_config', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node');
  const nodeTypes = [llmMetadata];

  it('sets a string config value', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'set_config',
        nodeId: 'llm_node.1',
        key: 'model',
        value: 'gpt-4o'
      },
      context
    );

    expect(result.ok).toBe(true);
    const updateCall = (dispatch.updateNode as ReturnType<typeof vi.fn>).mock.calls[0];
    const updatedConfig = updateCall[1].data.config;
    expect(updatedConfig.model).toBe('gpt-4o');
    expect(updatedConfig.temperature).toBe(0.7); // preserved
  });

  it('parses number values', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    executeCommand(
      {
        type: 'set_config',
        nodeId: 'llm_node.1',
        key: 'temperature',
        value: '0.9'
      },
      context
    );

    const updatedConfig = (dispatch.updateNode as ReturnType<typeof vi.fn>).mock.calls[0][1].data
      .config;
    expect(updatedConfig.temperature).toBe(0.9);
    expect(typeof updatedConfig.temperature).toBe('number');
  });

  it('parses boolean values', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    executeCommand(
      {
        type: 'set_config',
        nodeId: 'llm_node.1',
        key: 'streaming',
        value: 'true'
      },
      context
    );

    const updatedConfig = (dispatch.updateNode as ReturnType<typeof vi.fn>).mock.calls[0][1].data
      .config;
    expect(updatedConfig.streaming).toBe(true);
  });

  it('preserves quoted strings as strings', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    executeCommand(
      { type: 'set_config', nodeId: 'llm_node.1', key: 'name', value: '"42"' },
      context
    );

    const updatedConfig = (dispatch.updateNode as ReturnType<typeof vi.fn>).mock.calls[0][1].data
      .config;
    expect(updatedConfig.name).toBe('42');
    expect(typeof updatedConfig.name).toBe('string');
  });

  it('parses JSON array values', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    executeCommand(
      {
        type: 'set_config',
        nodeId: 'llm_node.1',
        key: 'tags',
        value: '["a","b"]'
      },
      context
    );

    const updatedConfig = (dispatch.updateNode as ReturnType<typeof vi.fn>).mock.calls[0][1].data
      .config;
    expect(updatedConfig.tags).toEqual(['a', 'b']);
  });

  it('returns NODE_NOT_FOUND for missing node', () => {
    const context = createMockContext(createMockWorkflow(), nodeTypes);

    const result = executeCommand(
      {
        type: 'set_config',
        nodeId: 'llm_node.99',
        key: 'model',
        value: 'gpt-4'
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_NOT_FOUND');
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand(
      {
        type: 'set_config',
        nodeId: 'llm_node.1',
        key: 'model',
        value: 'gpt-4'
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });
});

// ============================================================================
// set_config — ConfigSchema validation (US-017)
// ============================================================================

describe('executeCommand — set_config validation', () => {
  const enumMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node', {
    configSchema: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          default: 'gpt-4',
          enum: ['gpt-4', 'gpt-4o', 'claude-3']
        },
        temperature: {
          type: 'number',
          default: 0.7
        },
        stream: {
          type: 'boolean',
          default: false
        },
        // Backend node config schemas send a JSON Schema type array here;
        // `ConfigProperty.type` stays a single literal, so the fixture casts
        // through `unknown` the way a real backend payload would arrive.
        flexible: {
          type: ['string', 'boolean'] as unknown as ConfigProperty['type'],
          default: 'x'
        },
        count: {
          type: ['integer'] as unknown as ConfigProperty['type']
        }
      }
    }
  });
  const nodeTypes = [enumMetadata];

  function makeNode() {
    return createMockNode('agentspec.llm_node.1', enumMetadata, {
      data: {
        label: 'LLM Node',
        config: { model: 'gpt-4', temperature: 0.7, stream: false, flexible: 'x', count: 1 },
        metadata: enumMetadata
      }
    });
  }

  it('succeeds with warning for enum violation (advisory mode)', () => {
    const dispatch = createMockDispatch();
    const node = makeNode();
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'set_config',
        nodeId: 'llm_node.1',
        key: 'model',
        value: 'gpt-5'
      },
      context
    );

    // Advisory: command succeeds
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // But has warnings
    const data = result.data as import('../../../src/lib/commands/types.js').SetConfigResultData;
    expect(data.warnings).toBeDefined();
    expect(data.warnings!.length).toBe(1);
    expect(data.warnings![0].type).toBe('enum');
    expect(data.warnings![0].allowedValues).toEqual(['gpt-4', 'gpt-4o', 'claude-3']);

    // Value was still applied
    const updatedConfig = (dispatch.updateNode as ReturnType<typeof vi.fn>).mock.calls[0][1].data
      .config;
    expect(updatedConfig.model).toBe('gpt-5');
  });

  it('rejects enum violation in strict mode', () => {
    const dispatch = createMockDispatch();
    const node = makeNode();
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'set_config',
        nodeId: 'llm_node.1',
        key: 'model',
        value: 'gpt-5',
        strict: true
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONFIG_VALIDATION_ERROR');
    expect(result.error).toContain('gpt-4');
    expect(result.error).toContain('gpt-4o');
    expect(result.error).toContain('claude-3');

    // Value was NOT applied
    expect(dispatch.updateNode as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('succeeds with warning for type mismatch (advisory mode)', () => {
    const dispatch = createMockDispatch();
    const node = makeNode();
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    // Setting a number field with a string value (not parseable as number)
    const result = executeCommand(
      {
        type: 'set_config',
        nodeId: 'llm_node.1',
        key: 'temperature',
        value: 'hot'
      },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = result.data as import('../../../src/lib/commands/types.js').SetConfigResultData;
    expect(data.warnings).toBeDefined();
    expect(data.warnings!.length).toBe(1);
    expect(data.warnings![0].type).toBe('type_mismatch');
    expect(data.warnings![0].expectedType).toBe('number');
    expect(data.warnings![0].actualType).toBe('string');

    // Value was still applied
    const updatedConfig = (dispatch.updateNode as ReturnType<typeof vi.fn>).mock.calls[0][1].data
      .config;
    expect(updatedConfig.temperature).toBe('hot');
  });

  it('rejects type mismatch in strict mode', () => {
    const dispatch = createMockDispatch();
    const node = makeNode();
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'set_config',
        nodeId: 'llm_node.1',
        key: 'temperature',
        value: 'hot',
        strict: true
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONFIG_VALIDATION_ERROR');
    expect(result.error).toContain('number');
    expect(result.error).toContain('string');
    expect(dispatch.updateNode as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('no validation when configSchema is missing', () => {
    const noSchemaMetadata = createMockMetadata('agentspec.basic_node', 'Basic Node', {
      configSchema: undefined
    });
    const node = createMockNode('agentspec.basic_node.1', noSchemaMetadata, {
      data: {
        label: 'Basic Node',
        config: {},
        metadata: noSchemaMetadata
      }
    });
    const dispatch = createMockDispatch();
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, [noSchemaMetadata], dispatch);

    const result = executeCommand(
      {
        type: 'set_config',
        nodeId: 'basic_node.1',
        key: 'anything',
        value: 'whatever'
      },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // No warnings when no schema
    const data = result.data as import('../../../src/lib/commands/types.js').SetConfigResultData;
    expect(data.warnings).toBeUndefined();

    // Value applied
    expect(dispatch.updateNode as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });

  it('no validation warning when value matches schema', () => {
    const dispatch = createMockDispatch();
    const node = makeNode();
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'set_config',
        nodeId: 'llm_node.1',
        key: 'model',
        value: 'gpt-4o'
      },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = result.data as import('../../../src/lib/commands/types.js').SetConfigResultData;
    expect(data.warnings).toBeUndefined();
  });

  it('a key not in the schema is stored with an unknown_key warning that lists the declared keys', () => {
    const dispatch = createMockDispatch();
    const node = makeNode();
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'set_config',
        nodeId: 'llm_node.1',
        key: 'custom_field',
        value: 'anything'
      },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Stored anyway — hosts keep config open.
    expect(dispatch.updateNode as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    const data = result.data as import('../../../src/lib/commands/types.js').SetConfigResultData;
    expect(data.warnings).toHaveLength(1);
    expect(data.warnings![0].type).toBe('unknown_key');
    expect(data.warnings![0].knownKeys).toContain('model');
    expect(data.warnings![0].message).toContain('model');
  });

  it('strict mode refuses a key the schema does not declare', () => {
    const dispatch = createMockDispatch();
    const node = makeNode();
    const context = createMockContext(createMockWorkflow([node]), nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'set_config', nodeId: 'llm_node.1', key: 'custom_field', value: 'x', strict: true },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONFIG_VALIDATION_ERROR');
    expect(dispatch.updateNode as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('warns on boolean type mismatch', () => {
    const dispatch = createMockDispatch();
    const node = makeNode();
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    // "yes" is a string, not a boolean
    const result = executeCommand(
      { type: 'set_config', nodeId: 'llm_node.1', key: 'stream', value: 'yes' },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = result.data as import('../../../src/lib/commands/types.js').SetConfigResultData;
    expect(data.warnings).toBeDefined();
    expect(data.warnings![0].type).toBe('type_mismatch');
    expect(data.warnings![0].expectedType).toBe('boolean');
  });

  it('accepts a string for a property with a JSON Schema type array, no warning', () => {
    const dispatch = createMockDispatch();
    const node = makeNode();
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'set_config', nodeId: 'llm_node.1', key: 'flexible', value: 'yes' },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as import('../../../src/lib/commands/types.js').SetConfigResultData;
    expect(data.warnings).toBeUndefined();
  });

  it('accepts a boolean for a property with a JSON Schema type array, no warning', () => {
    const dispatch = createMockDispatch();
    const node = makeNode();
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'set_config', nodeId: 'llm_node.1', key: 'flexible', value: 'true' },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as import('../../../src/lib/commands/types.js').SetConfigResultData;
    expect(data.warnings).toBeUndefined();
  });

  it('rejects a number for a property with a JSON Schema type array, with a joined message', () => {
    const dispatch = createMockDispatch();
    const node = makeNode();
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'set_config', nodeId: 'llm_node.1', key: 'flexible', value: '5' },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as import('../../../src/lib/commands/types.js').SetConfigResultData;
    expect(data.warnings).toBeDefined();
    expect(data.warnings![0].type).toBe('type_mismatch');
    expect(data.warnings![0].message).toBe("Expected type 'string' or 'boolean' but got 'number'");
  });

  it('accepts a number for a single-element JSON Schema type array (integer)', () => {
    const dispatch = createMockDispatch();
    const node = makeNode();
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'set_config', nodeId: 'llm_node.1', key: 'count', value: '42' },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as import('../../../src/lib/commands/types.js').SetConfigResultData;
    expect(data.warnings).toBeUndefined();
  });
});

// ============================================================================
// get_config
// ============================================================================

describe('executeCommand — get_config', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node');
  const nodeTypes = [llmMetadata];

  it('returns config value for existing key', () => {
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand(
      { type: 'get_config', nodeId: 'llm_node.1', key: 'model' },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as GetConfigResultData;
    if (!('key' in data)) throw new Error('expected the single-key shape');
    expect(data.nodeId).toBe('llm_node.1');
    expect(data.key).toBe('model');
    expect(data.value).toBe('gpt-4');
  });

  it('returns CONFIG_KEY_NOT_FOUND for missing key', () => {
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand(
      { type: 'get_config', nodeId: 'llm_node.1', key: 'nonexistent' },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONFIG_KEY_NOT_FOUND');
    expect(result.error).toContain('nonexistent');
  });

  it('returns NODE_NOT_FOUND for missing node', () => {
    const context = createMockContext(createMockWorkflow(), nodeTypes);

    const result = executeCommand(
      { type: 'get_config', nodeId: 'llm_node.99', key: 'model' },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_NOT_FOUND');
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand(
      { type: 'get_config', nodeId: 'llm_node.1', key: 'model' },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });
});

// ============================================================================
// info
// ============================================================================

describe('executeCommand — info', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node', {
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
  const apiMetadata = createMockMetadata('agentspec.api_node', 'API Node', {
    inputs: [{ id: 'body', name: 'Body', type: 'input', dataType: 'string' }],
    outputs: []
  });
  const nodeTypes = [llmMetadata, apiMetadata];

  it('returns full node info with ports', () => {
    const node = createMockNode('agentspec.llm_node.1', llmMetadata, {
      position: { x: 200, y: 300 }
    });
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand({ type: 'info', nodeId: 'llm_node.1' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as InfoResultData;
    expect(data.nodeId).toBe('llm_node.1');
    expect(data.label).toBe('LLM Node');
    expect(data.type).toBe('llm_node');
    expect(data.position).toEqual({ x: 200, y: 300 });
    expect(data.config).toEqual({ model: 'gpt-4', temperature: 0.7 });
    expect(data.inputs).toEqual([{ portId: 'prompt', name: 'Prompt', dataType: 'string' }]);
    expect(data.outputs).toEqual([
      { portId: 'llm_output', name: 'LLM Output', dataType: 'string' }
    ]);
  });

  it('includes connected edges', () => {
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const edge: WorkflowEdge = {
      id: 'edge-1',
      source: 'agentspec.llm_node.1',
      target: 'agentspec.api_node.1',
      sourceHandle: 'agentspec.llm_node.1-output-llm_output',
      targetHandle: 'agentspec.api_node.1-input-body'
    };
    const workflow = createMockWorkflow([llmNode, apiNode], [edge]);
    const context = createMockContext(workflow, nodeTypes);

    // Info on source node
    const result = executeCommand({ type: 'info', nodeId: 'llm_node.1' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as InfoResultData;
    expect(data.connectedEdges).toHaveLength(1);
    expect(data.connectedEdges[0]).toEqual({
      edgeId: 'edge-1',
      direction: 'outgoing',
      remoteNodeId: 'api_node.1',
      remotePort: 'body',
      localPort: 'llm_output'
    });

    // Info on target node — should show incoming
    const result2 = executeCommand({ type: 'info', nodeId: 'api_node.1' }, context);

    expect(result2.ok).toBe(true);
    if (!result2.ok) return;
    const data2 = result2.data as InfoResultData;
    expect(data2.connectedEdges).toHaveLength(1);
    expect(data2.connectedEdges[0]).toEqual({
      edgeId: 'edge-1',
      direction: 'incoming',
      remoteNodeId: 'llm_node.1',
      remotePort: 'llm_output',
      localPort: 'body'
    });
  });

  it('returns empty connectedEdges for isolated node', () => {
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand({ type: 'info', nodeId: 'llm_node.1' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as InfoResultData;
    expect(data.connectedEdges).toEqual([]);
  });

  it('returns NODE_NOT_FOUND for missing node', () => {
    const context = createMockContext(createMockWorkflow(), nodeTypes);

    const result = executeCommand({ type: 'info', nodeId: 'llm_node.99' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_NOT_FOUND');
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand({ type: 'info', nodeId: 'llm_node.1' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });
});

// ============================================================================
// connect
// ============================================================================

describe('executeCommand — connect', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node', {
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
  const apiMetadata = createMockMetadata('agentspec.api_node', 'API Node', {
    inputs: [{ id: 'body', name: 'Body', type: 'input', dataType: 'string' }],
    outputs: [{ id: 'response', name: 'Response', type: 'output', dataType: 'string' }]
  });
  const triggerMetadata = createMockMetadata('agentspec.trigger_node', 'Trigger Node', {
    inputs: [],
    outputs: [
      {
        id: 'trigger_out',
        name: 'Trigger Out',
        type: 'output',
        dataType: 'trigger'
      }
    ]
  });
  const nodeTypes = [llmMetadata, apiMetadata, triggerMetadata];

  it('creates a valid connection between compatible ports', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const workflow = createMockWorkflow([llmNode, apiNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'connect',
        sourceNodeId: 'llm_node.1',
        sourcePort: 'llm_output',
        targetNodeId: 'api_node.1',
        targetPort: 'body'
      },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain('llm_node.1');
    expect(result.message).toContain('api_node.1');

    // Verify dispatch.addEdge was called
    expect(dispatch.addEdge).toHaveBeenCalledOnce();
    const edge = (dispatch.addEdge as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkflowEdge;

    // Edge structure
    expect(edge.source).toBe('agentspec.llm_node.1');
    expect(edge.target).toBe('agentspec.api_node.1');
    expect(edge.sourceHandle).toBe('agentspec.llm_node.1-output-llm_output');
    expect(edge.targetHandle).toBe('agentspec.api_node.1-input-body');

    // Edge ID format
    expect(edge.id).toBe(
      'agentspec.llm_node.1-agentspec.llm_node.1-output-llm_output-agentspec.api_node.1-agentspec.api_node.1-input-body'
    );

    // Styling was applied (edge should have style, class, markerEnd)
    expect(edge.style).toBeDefined();
    expect(edge.class).toBeDefined();
    expect(edge.data?.metadata?.edgeType).toBeDefined();
  });

  it('returns error when source port direction is reversed', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const workflow = createMockWorkflow([llmNode, apiNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    // Attempt to connect input→output (reversed)
    const result = executeCommand(
      {
        type: 'connect',
        sourceNodeId: 'api_node.1',
        sourcePort: 'body', // body is an input
        targetNodeId: 'llm_node.1',
        targetPort: 'llm_output' // llm_output is an output
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_CONNECTION');
    expect(result.error).toContain('reversed');
    expect(dispatch.addEdge).not.toHaveBeenCalled();
  });

  it('returns PORT_NOT_FOUND for missing source port', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const workflow = createMockWorkflow([llmNode, apiNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'connect',
        sourceNodeId: 'llm_node.1',
        sourcePort: 'nonexistent_port',
        targetNodeId: 'api_node.1',
        targetPort: 'body'
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PORT_NOT_FOUND');
    expect(result.error).toContain('nonexistent_port');
  });

  it('returns PORT_NOT_FOUND for missing target port', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const workflow = createMockWorkflow([llmNode, apiNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'connect',
        sourceNodeId: 'llm_node.1',
        sourcePort: 'llm_output',
        targetNodeId: 'api_node.1',
        targetPort: 'nonexistent_port'
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PORT_NOT_FOUND');
    expect(result.error).toContain('nonexistent_port');
  });

  it('allows connecting ports of different data types (matches canvas behavior)', () => {
    const dispatch = createMockDispatch();
    const triggerNode = createMockNode('agentspec.trigger_node.1', triggerMetadata);
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const workflow = createMockWorkflow([triggerNode, apiNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    // trigger_out (trigger type) → body (string type)
    // The canvas editor allows cross-type connections freely; DSL executor matches this behavior.
    const result = executeCommand(
      {
        type: 'connect',
        sourceNodeId: 'trigger_node.1',
        sourcePort: 'trigger_out',
        targetNodeId: 'api_node.1',
        targetPort: 'body'
      },
      context
    );

    expect(result.ok).toBe(true);
    expect(dispatch.addEdge).toHaveBeenCalled();
  });

  it('returns NODE_NOT_FOUND for missing source node', () => {
    const dispatch = createMockDispatch();
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const workflow = createMockWorkflow([apiNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'connect',
        sourceNodeId: 'llm_node.99',
        sourcePort: 'llm_output',
        targetNodeId: 'api_node.1',
        targetPort: 'body'
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_NOT_FOUND');
  });

  it('returns NODE_NOT_FOUND for missing target node', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([llmNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'connect',
        sourceNodeId: 'llm_node.1',
        sourcePort: 'llm_output',
        targetNodeId: 'api_node.99',
        targetPort: 'body'
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_NOT_FOUND');
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand(
      {
        type: 'connect',
        sourceNodeId: 'llm_node.1',
        sourcePort: 'llm_output',
        targetNodeId: 'api_node.1',
        targetPort: 'body'
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });

  it('returns error when source port is input (not output)', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const workflow = createMockWorkflow([llmNode, apiNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'connect',
        sourceNodeId: 'llm_node.1',
        sourcePort: 'prompt', // input port, not output
        targetNodeId: 'api_node.1',
        targetPort: 'body'
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_CONNECTION');
    expect(result.error).toContain('input');
    expect(result.error).toContain('not an output');
  });

  // N2: config-driven ports (dynamicOutputs/dynamicInputs) are not in
  // metadata.outputs/inputs, but connect must still resolve them.
  it('resolves a config-driven dynamicOutputs port as a source', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    llmNode.data.config = {
      ...llmNode.data.config,
      dynamicOutputs: [{ name: 'extra_out', label: 'Extra Out', dataType: 'string' }]
    };
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const workflow = createMockWorkflow([llmNode, apiNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'connect',
        sourceNodeId: 'llm_node.1',
        sourcePort: 'extra_out',
        targetNodeId: 'api_node.1',
        targetPort: 'body'
      },
      context
    );

    expect(result.ok).toBe(true);
    expect(dispatch.addEdge).toHaveBeenCalledOnce();
    const edge = (dispatch.addEdge as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkflowEdge;
    expect(edge.sourceHandle).toBe('agentspec.llm_node.1-output-extra_out');
  });

  it('resolves a config-driven dynamicInputs port as a target', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    apiNode.data.config = {
      ...apiNode.data.config,
      dynamicInputs: [{ name: 'extra_in', label: 'Extra In', dataType: 'string' }]
    };
    const workflow = createMockWorkflow([llmNode, apiNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'connect',
        sourceNodeId: 'llm_node.1',
        sourcePort: 'llm_output',
        targetNodeId: 'api_node.1',
        targetPort: 'extra_in'
      },
      context
    );

    expect(result.ok).toBe(true);
    expect(dispatch.addEdge).toHaveBeenCalledOnce();
    const edge = (dispatch.addEdge as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkflowEdge;
    expect(edge.targetHandle).toBe('agentspec.api_node.1-input-extra_in');
  });

  // N3: re-applying an existing connection (e.g. a second AI-assistant Apply)
  // must be an idempotent no-op, never a duplicate edge (which crashes the
  // canvas with `each_key_duplicate`).
  it('treats an already-existing connection as an idempotent no-op', () => {
    // First connect to capture the deterministic edge it produces.
    const firstDispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const firstContext = createMockContext(
      createMockWorkflow([llmNode, apiNode]),
      nodeTypes,
      firstDispatch
    );
    const command = {
      type: 'connect' as const,
      sourceNodeId: 'llm_node.1',
      sourcePort: 'llm_output',
      targetNodeId: 'api_node.1',
      targetPort: 'body'
    };
    executeCommand(command, firstContext);
    const existingEdge = (firstDispatch.addEdge as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as WorkflowEdge;

    // Re-run against a workflow that already holds that edge.
    const dispatch = createMockDispatch();
    const workflow = createMockWorkflow([llmNode, apiNode], [existingEdge]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(command, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain('Already connected');
    expect(dispatch.addEdge).not.toHaveBeenCalled();
  });
});

// ============================================================================
// disconnect_ports
// ============================================================================

describe('executeCommand — disconnect_ports', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node', {
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
  const apiMetadata = createMockMetadata('agentspec.api_node', 'API Node', {
    inputs: [{ id: 'body', name: 'Body', type: 'input', dataType: 'string' }],
    outputs: []
  });
  const nodeTypes = [llmMetadata, apiMetadata];

  it('disconnects a specific edge between two ports', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const edge = {
      id: 'edge-1',
      source: 'agentspec.llm_node.1',
      target: 'agentspec.api_node.1',
      sourceHandle: 'agentspec.llm_node.1-output-llm_output',
      targetHandle: 'agentspec.api_node.1-input-body'
    } as WorkflowEdge;
    const workflow = createMockWorkflow([llmNode, apiNode], [edge]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'disconnect_ports',
        sourceNodeId: 'llm_node.1',
        sourcePort: 'llm_output',
        targetNodeId: 'api_node.1',
        targetPort: 'body'
      },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain('Disconnected');
    expect(dispatch.removeEdge).toHaveBeenCalledWith('edge-1');
  });

  it('returns EDGE_NOT_FOUND when no matching edge exists', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const workflow = createMockWorkflow([llmNode, apiNode]); // no edges
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'disconnect_ports',
        sourceNodeId: 'llm_node.1',
        sourcePort: 'llm_output',
        targetNodeId: 'api_node.1',
        targetPort: 'body'
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EDGE_NOT_FOUND');
  });

  it('returns NODE_NOT_FOUND for missing source node', () => {
    const dispatch = createMockDispatch();
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const workflow = createMockWorkflow([apiNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'disconnect_ports',
        sourceNodeId: 'llm_node.99',
        sourcePort: 'llm_output',
        targetNodeId: 'api_node.1',
        targetPort: 'body'
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_NOT_FOUND');
  });

  it('returns NODE_NOT_FOUND for missing target node', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([llmNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'disconnect_ports',
        sourceNodeId: 'llm_node.1',
        sourcePort: 'llm_output',
        targetNodeId: 'api_node.99',
        targetPort: 'body'
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_NOT_FOUND');
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand(
      {
        type: 'disconnect_ports',
        sourceNodeId: 'llm_node.1',
        sourcePort: 'llm_output',
        targetNodeId: 'api_node.1',
        targetPort: 'body'
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });
});

// ============================================================================
// disconnect_node
// ============================================================================

describe('executeCommand — disconnect_node', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node', {
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
  const apiMetadata = createMockMetadata('agentspec.api_node', 'API Node', {
    inputs: [{ id: 'body', name: 'Body', type: 'input', dataType: 'string' }],
    outputs: [{ id: 'response', name: 'Response', type: 'output', dataType: 'string' }]
  });
  const nodeTypes = [llmMetadata, apiMetadata];

  it('removes all edges connected to a node', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const edge1 = {
      id: 'edge-1',
      source: 'agentspec.llm_node.1',
      target: 'agentspec.api_node.1',
      sourceHandle: 'agentspec.llm_node.1-output-llm_output',
      targetHandle: 'agentspec.api_node.1-input-body'
    } as WorkflowEdge;
    const edge2 = {
      id: 'edge-2',
      source: 'agentspec.api_node.1',
      target: 'agentspec.llm_node.1',
      sourceHandle: 'agentspec.api_node.1-output-response',
      targetHandle: 'agentspec.llm_node.1-input-prompt'
    } as WorkflowEdge;
    const workflow = createMockWorkflow([llmNode, apiNode], [edge1, edge2]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'disconnect_node', nodeId: 'llm_node.1' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain('2 edge(s)');
    expect(dispatch.removeEdge).toHaveBeenCalledTimes(2);
    expect(dispatch.removeEdge).toHaveBeenCalledWith('edge-1');
    expect(dispatch.removeEdge).toHaveBeenCalledWith('edge-2');
  });

  it('succeeds with 0 edges when node is isolated', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([llmNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'disconnect_node', nodeId: 'llm_node.1' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain('0 edge(s)');
    expect(dispatch.removeEdge).not.toHaveBeenCalled();
  });

  it('returns NODE_NOT_FOUND for missing node', () => {
    const context = createMockContext(createMockWorkflow(), nodeTypes);

    const result = executeCommand({ type: 'disconnect_node', nodeId: 'llm_node.99' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_NOT_FOUND');
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand({ type: 'disconnect_node', nodeId: 'llm_node.1' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });
});

// ============================================================================
// List Nodes
// ============================================================================

describe('executeCommand — list_nodes', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node');
  const apiMetadata = createMockMetadata('agentspec.api_node', 'API Node');
  const nodeTypes = [llmMetadata, apiMetadata];

  it('returns all nodes with short IDs, labels, and types', () => {
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata, {
      data: {
        ...createMockNode('agentspec.api_node.1', apiMetadata).data,
        label: 'My API'
      }
    });
    const workflow = createMockWorkflow([llmNode, apiNode]);
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand({ type: 'list_nodes' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as ListNodesResultData;
    expect(data.nodes).toHaveLength(2);
    expect(data.nodes[0]).toEqual({
      nodeId: 'llm_node.1',
      label: 'LLM Node',
      type: 'llm_node'
    });
    expect(data.nodes[1]).toEqual({
      nodeId: 'api_node.1',
      label: 'My API',
      type: 'api_node'
    });
  });

  it('returns empty list for empty workflow', () => {
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand({ type: 'list_nodes' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as ListNodesResultData;
    expect(data.nodes).toHaveLength(0);
    expect(result.message).toContain('No nodes');
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand({ type: 'list_nodes' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });
});

// ============================================================================
// List Edges
// ============================================================================

describe('executeCommand — list_edges', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node', {
    outputs: [{ id: 'llm_output', name: 'LLM Output', dataType: 'string' }]
  });
  const apiMetadata = createMockMetadata('agentspec.api_node', 'API Node', {
    inputs: [{ id: 'body', name: 'Body', dataType: 'string' }]
  });
  const nodeTypes = [llmMetadata, apiMetadata];

  it('returns all edges with short IDs and port names', () => {
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const edge: WorkflowEdge = {
      id: 'edge-1',
      source: 'agentspec.llm_node.1',
      target: 'agentspec.api_node.1',
      sourceHandle: 'agentspec.llm_node.1-output-llm_output',
      targetHandle: 'agentspec.api_node.1-input-body'
    };
    const workflow = createMockWorkflow([llmNode, apiNode], [edge]);
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand({ type: 'list_edges' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as ListEdgesResultData;
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0]).toEqual({
      edgeId: 'edge-1',
      sourceNodeId: 'llm_node.1',
      sourcePort: 'llm_output',
      targetNodeId: 'api_node.1',
      targetPort: 'body'
    });
  });

  it('returns empty list when no edges', () => {
    const workflow = createMockWorkflow([createMockNode('agentspec.llm_node.1', llmMetadata)]);
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand({ type: 'list_edges' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as ListEdgesResultData;
    expect(data.edges).toHaveLength(0);
    expect(result.message).toContain('No edges');
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand({ type: 'list_edges' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });
});

// ============================================================================
// List Types
// ============================================================================

describe('executeCommand — list_types', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node');
  const apiMetadata = createMockMetadata('agentspec.api_node', 'API Node', {
    category: 'integration'
  });
  const nodeTypes = [llmMetadata, apiMetadata];

  it('returns all types with short IDs, names, and categories', () => {
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand({ type: 'list_types' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as ListTypesResultData;
    expect(data.types).toHaveLength(2);
    expect(data.types[0]).toEqual({
      typeId: 'llm_node',
      name: 'LLM Node',
      category: 'ai'
    });
    expect(data.types[1]).toEqual({
      typeId: 'api_node',
      name: 'API Node',
      category: 'integration'
    });
  });

  it('returns short type IDs that match what add command accepts', () => {
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand({ type: 'list_types' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as ListTypesResultData;
    // Each typeId should be resolvable via typeMap
    for (const t of data.types) {
      expect(context.typeMap.has(t.typeId)).toBe(true);
    }
  });

  it('does not require a workflow (context.nodeTypes is sufficient)', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand({ type: 'list_types' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as ListTypesResultData;
    expect(data.types).toHaveLength(2);
  });
});

// ============================================================================
// Help
// ============================================================================

describe('executeCommand — help', () => {
  const nodeTypes: NodeMetadata[] = [];

  it('returns all commands when no argument given', () => {
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand({ type: 'help' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as HelpResultData;
    expect(data.commands.length).toBeGreaterThan(10);
    expect(result.message).toContain('Available commands');
    // Verify structure
    for (const cmd of data.commands) {
      expect(cmd).toHaveProperty('name');
      expect(cmd).toHaveProperty('syntax');
      expect(cmd).toHaveProperty('description');
    }
  });

  it('returns specific command help when argument given', () => {
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand({ type: 'help', command: 'add' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as HelpResultData;
    expect(data.commands.length).toBe(1);
    expect(data.commands[0].name).toBe('add');
    expect(data.commands[0].syntax).toContain('add');
    expect(result.message).toContain("Help for 'add'");
  });

  it('returns multiple entries for commands with variants (disconnect)', () => {
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand({ type: 'help', command: 'disconnect' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as HelpResultData;
    expect(data.commands.length).toBe(2);
    expect(data.commands.every((c) => c.name === 'disconnect')).toBe(true);
  });

  it('returns all commands for unknown command name', () => {
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand({ type: 'help', command: 'nonexistent' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as HelpResultData;
    expect(data.commands.length).toBeGreaterThan(10);
  });

  it('does not require a workflow', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand({ type: 'help' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as HelpResultData;
    expect(data.commands.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// undo
// ============================================================================

describe('executeCommand — undo', () => {
  const nodeTypes: NodeMetadata[] = [];

  it('calls dispatch.undo() and returns success', () => {
    const dispatch = createMockDispatch();
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'undo' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toBe('Undone');
    expect(dispatch.undo).toHaveBeenCalledOnce();
  });

  it('returns UNDO_UNAVAILABLE when dispatch.undo() returns false', () => {
    const dispatch = createMockDispatch();
    (dispatch.undo as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'undo' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNDO_UNAVAILABLE');
    expect(result.error).toContain('Nothing to undo');
  });

  it('does not require a workflow', () => {
    const dispatch = createMockDispatch();
    const context = createMockContext(null, nodeTypes, dispatch);

    const result = executeCommand({ type: 'undo' }, context);

    expect(result.ok).toBe(true);
  });
});

// ============================================================================
// redo
// ============================================================================

describe('executeCommand — redo', () => {
  const nodeTypes: NodeMetadata[] = [];

  it('calls dispatch.redo() and returns success', () => {
    const dispatch = createMockDispatch();
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'redo' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toBe('Redone');
    expect(dispatch.redo).toHaveBeenCalledOnce();
  });

  it('returns REDO_UNAVAILABLE when dispatch.redo() returns false', () => {
    const dispatch = createMockDispatch();
    (dispatch.redo as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'redo' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('REDO_UNAVAILABLE');
    expect(result.error).toContain('Nothing to redo');
  });

  it('does not require a workflow', () => {
    const dispatch = createMockDispatch();
    const context = createMockContext(null, nodeTypes, dispatch);

    const result = executeCommand({ type: 'redo' }, context);

    expect(result.ok).toBe(true);
  });
});

// ============================================================================
// clear
// ============================================================================

describe('executeCommand — clear', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node');
  const apiMetadata = createMockMetadata('agentspec.api_node', 'API Node');
  const nodeTypes = [llmMetadata, apiMetadata];

  it('removes all nodes and edges via batchUpdate', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const apiNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const edge = {
      id: 'edge-1',
      source: 'agentspec.llm_node.1',
      target: 'agentspec.api_node.1'
    } as WorkflowEdge;
    const workflow = createMockWorkflow([llmNode, apiNode], [edge]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'clear' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain('2 node(s)');
    expect(result.message).toContain('1 edge(s)');
    expect(dispatch.batchUpdate).toHaveBeenCalledWith({ nodes: [], edges: [] });
  });

  it('succeeds on empty workflow', () => {
    const dispatch = createMockDispatch();
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'clear' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain('0 node(s)');
    expect(result.message).toContain('0 edge(s)');
    expect(dispatch.batchUpdate).toHaveBeenCalledWith({ nodes: [], edges: [] });
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand({ type: 'clear' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });
});

// ============================================================================
// config_open
// ============================================================================

describe('executeCommand — config_open', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node');
  const nodeTypes = [llmMetadata];

  it('calls emitUIAction with open_config when handler provided', () => {
    const dispatch = createMockDispatch();
    const emitUIAction = vi.fn();
    dispatch.emitUIAction = emitUIAction;
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([llmNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'config_open', nodeId: 'llm_node.1' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain('Opened config');
    expect(emitUIAction).toHaveBeenCalledWith({
      type: 'open_config',
      nodeId: 'agentspec.llm_node.1'
    });
    expect(result.uiActionPending).toBeUndefined();
  });

  it('returns uiActionPending when emitUIAction not provided', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([llmNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'config_open', nodeId: 'llm_node.1' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.uiActionPending).toBe(true);
  });

  it('returns NODE_NOT_FOUND for missing node', () => {
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand({ type: 'config_open', nodeId: 'llm_node.99' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_NOT_FOUND');
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand({ type: 'config_open', nodeId: 'llm_node.1' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });
});

// ============================================================================
// select_node
// ============================================================================

describe('executeCommand — select_node', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node');
  const nodeTypes = [llmMetadata];

  it('calls emitUIAction with select_node when handler provided', () => {
    const dispatch = createMockDispatch();
    const emitUIAction = vi.fn();
    dispatch.emitUIAction = emitUIAction;
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([llmNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'select_node', nodeId: 'llm_node.1' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain('Selected');
    expect(emitUIAction).toHaveBeenCalledWith({
      type: 'select_node',
      nodeId: 'agentspec.llm_node.1'
    });
    expect(result.uiActionPending).toBeUndefined();
  });

  it('returns uiActionPending when emitUIAction not provided', () => {
    const dispatch = createMockDispatch();
    const llmNode = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([llmNode]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'select_node', nodeId: 'llm_node.1' }, context);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.uiActionPending).toBe(true);
  });

  it('returns NODE_NOT_FOUND for missing node', () => {
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand({ type: 'select_node', nodeId: 'llm_node.99' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_NOT_FOUND');
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand({ type: 'select_node', nodeId: 'llm_node.1' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });
});

// ============================================================================
// swap_node
// ============================================================================

describe('executeCommand — swap_node', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node', {
    inputs: [{ id: 'prompt', name: 'Prompt', type: 'input', dataType: 'string' }],
    outputs: [
      {
        id: 'llm_output',
        name: 'LLM Output',
        type: 'output',
        dataType: 'string'
      }
    ],
    configSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', default: 'gpt-4' },
        temperature: { type: 'number', default: 0.7 }
      }
    }
  });

  const apiMetadata = createMockMetadata('agentspec.api_node', 'API Node', {
    inputs: [{ id: 'body', name: 'Body', type: 'input', dataType: 'string' }],
    outputs: [{ id: 'response', name: 'Response', type: 'output', dataType: 'string' }],
    configSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', default: 'https://example.com' },
        model: { type: 'string', default: 'default-model' }
      }
    }
  });

  // A type with different ports (number ports won't match string ports)
  const calcMetadata = createMockMetadata('agentspec.calculator', 'Calculator', {
    inputs: [
      { id: 'a', name: 'A', type: 'input', dataType: 'number' },
      { id: 'b', name: 'B', type: 'input', dataType: 'number' }
    ],
    outputs: [{ id: 'result', name: 'Result', type: 'output', dataType: 'number' }],
    configSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', default: 'add' }
      }
    }
  });

  const nodeTypes = [llmMetadata, apiMetadata, calcMetadata];

  it('swaps a node type and dispatches via batchUpdate', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata, {
      data: {
        label: 'LLM Node',
        config: { model: 'gpt-4', temperature: 0.7 },
        metadata: llmMetadata
      }
    });
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'swap_node', nodeId: 'llm_node.1', newTypeId: 'api_node' },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain('Swapped');
    expect(result.message).toContain('llm_node.1');
    expect(result.message).toContain('api_node');

    const data = result.data as import('../../../src/lib/commands/types.js').SwapNodeResultData;
    expect(data.oldNodeId).toBe('llm_node.1');
    expect(data.newType).toBe('api_node');
    expect(dispatch.batchUpdate).toHaveBeenCalled();
  });

  it('uses dispatch.swapNode when available', () => {
    const dispatch = createMockDispatch();
    dispatch.swapNode = vi.fn();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata, {
      data: {
        label: 'LLM Node',
        config: { model: 'gpt-4', temperature: 0.7 },
        metadata: llmMetadata
      }
    });
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'swap_node', nodeId: 'llm_node.1', newTypeId: 'api_node' },
      context
    );

    expect(result.ok).toBe(true);
    expect(dispatch.swapNode).toHaveBeenCalled();
    expect(dispatch.batchUpdate).not.toHaveBeenCalled();
  });

  it('reports dropped edges when ports are incompatible', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata, {
      data: {
        label: 'LLM Node',
        config: { model: 'gpt-4', temperature: 0.7 },
        metadata: llmMetadata
      }
    });
    const otherNode = createMockNode('agentspec.api_node.1', apiMetadata);
    // Edge into llm_node.1's prompt port (string→string) — calculator only has number inputs
    const edge: WorkflowEdge = {
      id: 'edge-1',
      source: 'agentspec.api_node.1',
      target: 'agentspec.llm_node.1',
      sourceHandle: 'agentspec.api_node.1-output-response',
      targetHandle: 'agentspec.llm_node.1-input-prompt'
    } as WorkflowEdge;
    const workflow = createMockWorkflow([node, otherNode], [edge]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'swap_node', nodeId: 'llm_node.1', newTypeId: 'calculator' },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as import('../../../src/lib/commands/types.js').SwapNodeResultData;
    expect(data.droppedEdges).toBeGreaterThan(0);
    expect(data.hasDataLoss).toBe(true);
    expect(result.message).toContain('dropped');
  });

  it('names each dropped edge in the message and result data', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata, {
      data: {
        label: 'LLM Node',
        config: {},
        metadata: llmMetadata
      }
    });
    const otherNode = createMockNode('agentspec.api_node.1', apiMetadata);
    const edge: WorkflowEdge = {
      id: 'edge-1',
      source: 'agentspec.api_node.1',
      target: 'agentspec.llm_node.1',
      sourceHandle: 'agentspec.api_node.1-output-response',
      targetHandle: 'agentspec.llm_node.1-input-prompt'
    } as WorkflowEdge;
    const workflow = createMockWorkflow([node, otherNode], [edge]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'swap_node', nodeId: 'llm_node.1', newTypeId: 'calculator' },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as import('../../../src/lib/commands/types.js').SwapNodeResultData;
    expect(data.droppedEdgeDetails).toHaveLength(1);
    expect(data.droppedEdgeDetails[0]).toBe('api_node.1:response → llm_node.1:prompt');
    expect(result.message).toContain('api_node.1:response → llm_node.1:prompt');
  });

  it('truncates the inline dropped-edge list at 5 but keeps all in result data', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata, {
      data: {
        label: 'LLM Node',
        config: {},
        metadata: llmMetadata
      }
    });
    // 7 string edges into llm_node.1's llm_output — calculator has no string ports
    const sources = Array.from({ length: 7 }, (_, i) =>
      createMockNode(`agentspec.api_node.${i + 1}`, apiMetadata)
    );
    const edges: WorkflowEdge[] = sources.map(
      (src, i) =>
        ({
          id: `edge-${i}`,
          source: 'agentspec.llm_node.1',
          target: src.id,
          sourceHandle: 'agentspec.llm_node.1-output-llm_output',
          targetHandle: `${src.id}-input-body`
        }) as WorkflowEdge
    );
    const workflow = createMockWorkflow([node, ...sources], edges);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'swap_node', nodeId: 'llm_node.1', newTypeId: 'calculator' },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as import('../../../src/lib/commands/types.js').SwapNodeResultData;
    expect(data.droppedEdges).toBe(7);
    expect(data.droppedEdgeDetails).toHaveLength(7);
    expect(result.message).toContain('7 edge(s) dropped');
    expect(result.message).toContain('… and 2 more');
    // Only 5 edges named inline
    const namedCount = (result.message.match(/llm_node\.1:llm_output/g) ?? []).length;
    expect(namedCount).toBe(5);
  });

  it('gives the replacement node a real id so its handles render', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata, {
      data: {
        label: 'LLM Node',
        config: {},
        metadata: llmMetadata
      }
    });
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'swap_node', nodeId: 'llm_node.1', newTypeId: 'api_node' },
      context
    );

    expect(result.ok).toBe(true);
    const update = (dispatch.batchUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const newNode = update.nodes.find(
      (n: WorkflowNode) => n.data.metadata.node_type_id === 'agentspec.api_node'
    );
    expect(newNode).toBeDefined();
    expect(newNode.id).toBeTruthy();
  });

  it('reports config carried over and reset', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata, {
      data: {
        label: 'LLM Node',
        config: { model: 'gpt-4', temperature: 0.7 },
        metadata: llmMetadata
      }
    });
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'swap_node', nodeId: 'llm_node.1', newTypeId: 'api_node' },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as import('../../../src/lib/commands/types.js').SwapNodeResultData;
    // "model" exists in both llm_node and api_node — should be carried over
    expect(data.configCarriedOver).toContain('model');
    // "url" is only in api_node — should be reset
    expect(data.configReset).toContain('url');
  });

  it('returns NODE_NOT_FOUND for missing node', () => {
    const dispatch = createMockDispatch();
    const workflow = createMockWorkflow();
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'swap_node', nodeId: 'llm_node.99', newTypeId: 'api_node' },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_NOT_FOUND');
  });

  it('returns NODE_TYPE_NOT_FOUND for unknown new type', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'swap_node',
        nodeId: 'llm_node.1',
        newTypeId: 'nonexistent_type'
      },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_TYPE_NOT_FOUND');
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand(
      { type: 'swap_node', nodeId: 'llm_node.1', newTypeId: 'api_node' },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });

  it('swaps node with no edges (isolated node)', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata, {
      data: {
        label: 'LLM Node',
        config: { model: 'gpt-4', temperature: 0.7 },
        metadata: llmMetadata
      }
    });
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'swap_node', nodeId: 'llm_node.1', newTypeId: 'api_node' },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as import('../../../src/lib/commands/types.js').SwapNodeResultData;
    expect(data.keptEdges).toBe(0);
    expect(data.droppedEdges).toBe(0);
    expect(data.hasDataLoss).toBe(false);
  });
});

// ============================================================================
// move_node
// ============================================================================

describe('move_node', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node');
  const nodeTypes = [llmMetadata];

  it('moves node to specified position', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      { type: 'move_node', nodeId: 'llm_node.1', position: { x: 500, y: 300 } },
      context
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain('Moved');
    expect(result.message).toContain('500');
    expect(result.message).toContain('300');
    expect(dispatch.updateNode).toHaveBeenCalledWith('agentspec.llm_node.1', {
      position: { x: 500, y: 300 }
    });
  });

  it('supports negative coordinates', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand(
      {
        type: 'move_node',
        nodeId: 'llm_node.1',
        position: { x: -100, y: -200 }
      },
      context
    );

    expect(result.ok).toBe(true);
    expect(dispatch.updateNode).toHaveBeenCalledWith('agentspec.llm_node.1', {
      position: { x: -100, y: -200 }
    });
  });

  it('returns NODE_NOT_FOUND for missing node', () => {
    const workflow = createMockWorkflow([]);
    const context = createMockContext(workflow, nodeTypes);

    const result = executeCommand(
      { type: 'move_node', nodeId: 'llm_node.99', position: { x: 0, y: 0 } },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_NOT_FOUND');
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand(
      { type: 'move_node', nodeId: 'llm_node.1', position: { x: 0, y: 0 } },
      context
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });

  it('resolves short ID to namespaced internal ID', () => {
    const dispatch = createMockDispatch();
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    executeCommand(
      { type: 'move_node', nodeId: 'llm_node.1', position: { x: 200, y: 400 } },
      context
    );

    // Should resolve short ID "llm_node.1" to full "agentspec.llm_node.1"
    expect(dispatch.updateNode).toHaveBeenCalledWith('agentspec.llm_node.1', expect.anything());
  });
});

// ============================================================================
// auto_layout
// ============================================================================

describe('executeCommand — auto_layout', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node');
  const apiMetadata = createMockMetadata('agentspec.api_node', 'API Node');
  const nodeTypes = [llmMetadata, apiMetadata];

  it('applies horizontal layout to nodes', () => {
    const dispatch = createMockDispatch();
    const node1 = createMockNode('agentspec.llm_node.1', llmMetadata, {
      position: { x: 500, y: 200 }
    });
    const node2 = createMockNode('agentspec.api_node.1', apiMetadata, {
      position: { x: 600, y: 300 }
    });
    const edge = {
      id: 'e1',
      source: 'agentspec.llm_node.1',
      target: 'agentspec.api_node.1'
    } as WorkflowEdge;
    const workflow = createMockWorkflow([node1, node2], [edge]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'auto_layout' }, context);

    expect(result.ok).toBe(true);
    expect(result.message).toContain('2 nodes');
    expect(dispatch.batchUpdate).toHaveBeenCalledTimes(1);

    const updatedNodes = (dispatch.batchUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .nodes as WorkflowNode[];
    expect(updatedNodes).toHaveLength(2);
    // Nodes should have different x positions (layered)
    const positions = updatedNodes.map((n) => n.position);
    expect(positions[0].x).not.toBe(positions[1].x);
  });

  it('uses measured dimensions for size-aware layout', () => {
    const dispatch = createMockDispatch();
    const node1 = createMockNode('agentspec.llm_node.1', llmMetadata, {
      position: { x: 0, y: 0 }
    });
    const node2 = createMockNode('agentspec.api_node.1', apiMetadata, {
      position: { x: 100, y: 0 }
    });
    // Simulate measured dimensions (set by @xyflow/svelte after render)
    (node1 as { measured?: { width: number; height: number } }).measured = {
      width: 280,
      height: 200
    };
    (node2 as { measured?: { width: number; height: number } }).measured = {
      width: 220,
      height: 150
    };
    const edge = {
      id: 'e1',
      source: 'agentspec.llm_node.1',
      target: 'agentspec.api_node.1'
    } as WorkflowEdge;
    const workflow = createMockWorkflow([node1, node2], [edge]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'auto_layout' }, context);

    expect(result.ok).toBe(true);
    expect(dispatch.batchUpdate).toHaveBeenCalledTimes(1);

    const updatedNodes = (dispatch.batchUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .nodes as WorkflowNode[];
    const positions = updatedNodes.map((n) => n.position);
    // With node1 width=280 and gap=80, node2 x should be >= 360
    expect(positions[1].x - positions[0].x).toBeGreaterThanOrEqual(280 + 80);
  });

  it('handles empty workflow', () => {
    const dispatch = createMockDispatch();
    const workflow = createMockWorkflow([], []);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'auto_layout' }, context);

    expect(result.ok).toBe(true);
    expect(result.message).toContain('No nodes');
    expect(dispatch.batchUpdate).not.toHaveBeenCalled();
  });

  it('returns NO_WORKFLOW when no workflow loaded', () => {
    const context = createMockContext(null, nodeTypes);

    const result = executeCommand({ type: 'auto_layout' }, context);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NO_WORKFLOW');
  });

  it('handles disconnected nodes', () => {
    const dispatch = createMockDispatch();
    const node1 = createMockNode('agentspec.llm_node.1', llmMetadata, {
      position: { x: 0, y: 0 }
    });
    const node2 = createMockNode('agentspec.api_node.1', apiMetadata, {
      position: { x: 100, y: 0 }
    });
    // No edges — nodes are disconnected
    const workflow = createMockWorkflow([node1, node2], []);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    const result = executeCommand({ type: 'auto_layout' }, context);

    expect(result.ok).toBe(true);
    expect(dispatch.batchUpdate).toHaveBeenCalledTimes(1);

    const updatedNodes = (dispatch.batchUpdate as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .nodes as WorkflowNode[];
    expect(updatedNodes).toHaveLength(2);
  });

  it('uses batchUpdate for single undo', () => {
    const dispatch = createMockDispatch();
    const node1 = createMockNode('agentspec.llm_node.1', llmMetadata);
    const workflow = createMockWorkflow([node1]);
    const context = createMockContext(workflow, nodeTypes, dispatch);

    executeCommand({ type: 'auto_layout' }, context);

    // Should use batchUpdate (not individual updateNode calls) for single undo
    expect(dispatch.batchUpdate).toHaveBeenCalledTimes(1);
    expect(dispatch.updateNode).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Teaching errors (D7) — a failure names the valid alternatives
// ============================================================================

describe('teaching errors', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node', {
    outputs: [{ id: 'text', name: 'Text', type: 'output', dataType: 'string' }]
  });
  const apiMetadata = createMockMetadata('agentspec.api_node', 'API Node', {
    inputs: [{ id: 'body', name: 'Body', type: 'input', dataType: 'string' }]
  });
  const nodeTypes = [llmMetadata, apiMetadata];

  it('an unknown node lists the nodes in the workflow', () => {
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const context = createMockContext(createMockWorkflow([node]), nodeTypes);
    const result = executeCommand({ type: 'delete_node', nodeId: 'nope.9' }, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_NOT_FOUND');
    expect(result.error).toContain('llm_node.1');
  });

  it('an unknown node on an empty canvas points at add_node', () => {
    const context = createMockContext(createMockWorkflow(), nodeTypes);
    const result = executeCommand({ type: 'info', nodeId: 'nope.9' }, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('add_node');
  });

  it('an unknown type names near misses', () => {
    const context = createMockContext(createMockWorkflow(), nodeTypes);
    const result = executeCommand({ type: 'add_node', nodeTypeId: 'llm' }, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_TYPE_NOT_FOUND');
    expect(result.error).toContain('Did you mean: llm_node');
  });

  it('an unknown type with no near miss points at list_types', () => {
    const context = createMockContext(createMockWorkflow(), nodeTypes);
    const result = executeCommand({ type: 'add_node', nodeTypeId: 'zzz' }, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('list_types');
  });

  it('an unknown port lists the ports on that node, both directions', () => {
    const a = createMockNode('agentspec.llm_node.1', llmMetadata);
    const b = createMockNode('agentspec.api_node.1', apiMetadata);
    const context = createMockContext(createMockWorkflow([a, b]), nodeTypes);
    const result = executeCommand(
      {
        type: 'connect',
        sourceNodeId: 'llm_node.1',
        sourcePort: 'output',
        targetNodeId: 'api_node.1',
        targetPort: 'body'
      },
      context
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PORT_NOT_FOUND');
    expect(result.error).toContain("'output' not found on node llm_node.1");
    expect(result.error).toContain('Its outputs: text');
    expect(result.error).toContain('its inputs: none');
  });

  it('a missing edge lists the edges leaving the source node', () => {
    const a = createMockNode('agentspec.llm_node.1', llmMetadata);
    const b = createMockNode('agentspec.api_node.1', apiMetadata);
    const edge = {
      id: 'e1',
      source: 'agentspec.llm_node.1',
      target: 'agentspec.api_node.1',
      sourceHandle: 'agentspec.llm_node.1-output-text',
      targetHandle: 'agentspec.api_node.1-input-body'
    };
    const context = createMockContext(createMockWorkflow([a, b], [edge]), nodeTypes);
    const result = executeCommand(
      {
        type: 'disconnect_ports',
        sourceNodeId: 'llm_node.1',
        sourcePort: 'text',
        targetNodeId: 'api_node.1',
        targetPort: 'nope'
      },
      context
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EDGE_NOT_FOUND');
    expect(result.error).toContain('llm_node.1:text → api_node.1:body');
  });

  it('an unknown config key lists the keys', () => {
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const context = createMockContext(createMockWorkflow([node]), nodeTypes);
    const result = executeCommand(
      { type: 'get_config', nodeId: 'llm_node.1', key: 'nope' },
      context
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CONFIG_KEY_NOT_FOUND');
    expect(result.error).toContain('model');
    expect(result.error).toContain('temperature');
  });
});

// ============================================================================
// describe_type / search_types / get_config without a key
// ============================================================================

describe('executeCommand — describe_type', () => {
  const http = createMockMetadata('http_request', 'HTTP Request', {
    description: 'Fetch a URL',
    category: 'integration',
    tags: ['http', 'fetch'],
    inputs: [
      { id: 'url', name: 'URL', type: 'input', dataType: 'string', required: true },
      { id: 'trigger', name: 'Trigger', type: 'input', dataType: 'trigger' }
    ],
    outputs: [
      { id: 'body', name: 'Body', type: 'output', dataType: 'string', description: 'Response body' }
    ],
    configSchema: {
      type: 'object',
      required: ['method'],
      properties: {
        method: {
          type: 'string',
          title: 'Method',
          enum: ['GET', 'POST'],
          default: 'GET',
          description: 'HTTP verb'
        },
        requiresConfirmation: {
          // fddo serves this reserved key as a JSON Schema type array on purpose.
          type: ['string', 'boolean'] as unknown as 'string',
          default: 'inherit'
        }
      }
    },
    confirmation: { policy: 'ask', source: 'policy', authorControls: ['waive', 'require'] },
    can: { add: true },
    agent: { usage: 'Pair with html_to_markdown to read a page.' }
  } as Partial<NodeMetadata>);
  const nodeTypes = [http];

  it('returns ports, config schema, and the host pass-through fields', () => {
    const context = createMockContext(createMockWorkflow(), nodeTypes);
    const result = executeCommand({ type: 'describe_type', nodeTypeId: 'http_request' }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as import('../../../src/lib/commands/types.js').DescribeTypeResultData;
    expect(data.typeId).toBe('http_request');
    expect(data.description).toBe('Fetch a URL');
    expect(data.tags).toEqual(['http', 'fetch']);
    expect(data.inputs).toEqual([
      { portId: 'url', name: 'URL', dataType: 'string', required: true },
      { portId: 'trigger', name: 'Trigger', dataType: 'trigger' }
    ]);
    expect(data.outputs).toEqual([
      { portId: 'body', name: 'Body', dataType: 'string', description: 'Response body' }
    ]);
    expect(data.config).toEqual([
      {
        key: 'method',
        type: 'string',
        title: 'Method',
        description: 'HTTP verb',
        enum: ['GET', 'POST'],
        default: 'GET',
        required: true
      },
      { key: 'requiresConfirmation', type: ['string', 'boolean'], default: 'inherit' }
    ]);
    expect(data.confirmation).toEqual({
      policy: 'ask',
      source: 'policy',
      authorControls: ['waive', 'require']
    });
    expect(data.can).toEqual({ add: true });
    expect(data.agent).toEqual({ usage: 'Pair with html_to_markdown to read a page.' });
  });

  it('omits the pass-through fields when the host does not publish them', () => {
    const plain = createMockMetadata('agentspec.llm_node', 'LLM Node');
    const context = createMockContext(createMockWorkflow(), [plain]);
    const result = executeCommand({ type: 'describe_type', nodeTypeId: 'llm_node' }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as import('../../../src/lib/commands/types.js').DescribeTypeResultData;
    expect(data).not.toHaveProperty('confirmation');
    expect(data).not.toHaveProperty('can');
    expect(data).not.toHaveProperty('agent');
    expect(data).not.toHaveProperty('description');
    expect(data.config.map((c) => c.key)).toEqual(['model', 'temperature']);
  });

  it('is NODE_TYPE_NOT_FOUND for an unknown type', () => {
    const context = createMockContext(createMockWorkflow(), nodeTypes);
    const result = executeCommand({ type: 'describe_type', nodeTypeId: 'nope' }, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NODE_TYPE_NOT_FOUND');
  });
});

describe('executeCommand — search_types', () => {
  const http = createMockMetadata('http_request', 'HTTP Request', {
    description: 'Fetch a URL over HTTP',
    category: 'integration',
    tags: ['network']
  });
  const md = createMockMetadata('html_to_markdown', 'HTML to Markdown', {
    description: 'Convert HTML',
    category: 'text'
  });
  const nodeTypes = [http, md];

  it('matches id, name, description and tags case-insensitively', () => {
    const context = createMockContext(createMockWorkflow(), nodeTypes);
    const ids = (q: string) => {
      const r = executeCommand({ type: 'search_types', query: q }, context);
      if (!r.ok) throw new Error(r.error);
      return (
        r.data as import('../../../src/lib/commands/types.js').SearchTypesResultData
      ).types.map((t) => t.typeId);
    };
    expect(ids('MARKDOWN')).toEqual(['html_to_markdown']);
    expect(ids('fetch')).toEqual(['http_request']);
    expect(ids('network')).toEqual(['http_request']);
    expect(ids('ht')).toEqual(['http_request', 'html_to_markdown']);
  });

  it('says so when nothing matches, and points at list_types', () => {
    const context = createMockContext(createMockWorkflow(), nodeTypes);
    const result = executeCommand({ type: 'search_types', query: 'zzz' }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as { types: unknown[] }).types).toEqual([]);
    expect(result.message).toContain('list_types');
  });

  it('refuses a blank query instead of dumping the catalog', () => {
    const context = createMockContext(createMockWorkflow(), nodeTypes);
    const result = executeCommand({ type: 'search_types', query: '   ' }, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EMPTY_QUERY');
    expect(result.error).toContain('list_types');
  });
});

describe('executeCommand — list_types carries description and tags', () => {
  it('adds description and tags only when present', () => {
    const withMeta = createMockMetadata('a', 'A', { description: 'Does A', tags: ['x'] });
    const bare = createMockMetadata('b', 'B');
    const context = createMockContext(createMockWorkflow(), [withMeta, bare]);
    const result = executeCommand({ type: 'list_types' }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as ListTypesResultData;
    expect(data.types[0]).toEqual({
      typeId: 'a',
      name: 'A',
      category: 'ai',
      description: 'Does A',
      tags: ['x']
    });
    expect(data.types[1]).toEqual({ typeId: 'b', name: 'B', category: 'ai' });
  });
});

describe('executeCommand — get_config with the schema', () => {
  const llmMetadata = createMockMetadata('agentspec.llm_node', 'LLM Node');

  it('without a key returns every value and the schema', () => {
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const context = createMockContext(createMockWorkflow([node]), [llmMetadata]);
    const result = executeCommand({ type: 'get_config', nodeId: 'llm_node.1' }, context);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as GetConfigResultData;
    if ('key' in data) throw new Error('expected the all-values shape');
    expect(data.values).toEqual({ model: 'gpt-4', temperature: 0.7 });
    expect(data.schema).toEqual([
      { key: 'model', type: 'string', default: 'gpt-4' },
      { key: 'temperature', type: 'number', default: 0.7 }
    ]);
    expect(data).not.toHaveProperty('key');
  });

  it("with a key returns the value and that key's schema entry", () => {
    const node = createMockNode('agentspec.llm_node.1', llmMetadata);
    const context = createMockContext(createMockWorkflow([node]), [llmMetadata]);
    const result = executeCommand(
      { type: 'get_config', nodeId: 'llm_node.1', key: 'model' },
      context
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as GetConfigResultData;
    if (!('key' in data)) throw new Error('expected the single-key shape');
    expect(data.value).toBe('gpt-4');
    expect(data.schema).toEqual({ key: 'model', type: 'string', default: 'gpt-4' });
  });

  it('a declared key with no value yet reads as undefined, not CONFIG_KEY_NOT_FOUND', () => {
    const node = createMockNode('agentspec.llm_node.1', llmMetadata, {
      data: { label: 'LLM', config: {}, metadata: llmMetadata }
    } as Partial<WorkflowNode>);
    const context = createMockContext(createMockWorkflow([node]), [llmMetadata]);
    const result = executeCommand(
      { type: 'get_config', nodeId: 'llm_node.1', key: 'model' },
      context
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as GetConfigResultData;
    if (!('key' in data)) throw new Error('expected the single-key shape');
    expect(data.value).toBeUndefined();
    expect(data.schema).toEqual({ key: 'model', type: 'string', default: 'gpt-4' });
  });
});
