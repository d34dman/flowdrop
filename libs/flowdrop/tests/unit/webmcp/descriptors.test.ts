/**
 * WebMCP descriptors — coverage of the Command union, schema validation, and
 * the argument → Command mapping compared against the text DSL parser.
 */

import { describe, it, expect } from 'vitest';
import {
  buildToolDescriptors,
  validateToolArgs,
  describeCommand,
  commandRecord,
  EXPOSED_COMMAND_TYPES,
  VIEW_COMMAND_TYPES,
  EXCLUDED_COMMAND_TYPES,
  COMPOSITE_VERBS
} from '../../../src/lib/webmcp/descriptors.js';
import { ToolArgumentError } from '../../../src/lib/webmcp/types.js';
import type { ToolSchemaProperty } from '../../../src/lib/webmcp/types.js';
import { VALIDATOR_KEYWORDS } from '../../../src/lib/webmcp/validate.js';
import { parseCommand } from '../../../src/lib/commands/parser.js';
import { executeCommand } from '../../../src/lib/commands/executor.js';
import { buildTypeMap } from '../../../src/lib/commands/types.js';
import type { Command, CommandContext, CommandDispatch } from '../../../src/lib/commands/types.js';
import type { NodeMetadata, Workflow, WorkflowNode } from '../../../src/lib/types/index.js';
import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// D8 — every literal in the union is classified
// ---------------------------------------------------------------------------

/**
 * Exhaustive by construction: adding a verb to `Command` without listing it
 * here is a compile error, and listing it here without exposing or excluding
 * it fails the test below.
 */
const ALL_COMMAND_TYPES: Record<Command['type'], true> = {
  add_node: true,
  delete_node: true,
  rename_node: true,
  set_config: true,
  get_config: true,
  connect: true,
  disconnect_ports: true,
  disconnect_node: true,
  list_nodes: true,
  list_edges: true,
  list_types: true,
  describe_type: true,
  search_types: true,
  info: true,
  undo: true,
  redo: true,
  config_open: true,
  select_node: true,
  help: true,
  clear: true,
  swap_node: true,
  move_node: true,
  auto_layout: true,
  beautify_layout: true,
  canvas_fit_view: true,
  canvas_zoom_in: true,
  canvas_zoom_out: true,
  canvas_zoom_to: true,
  canvas_pan_to: true,
  canvas_reset_view: true
};

describe('D8 coverage', () => {
  it('every Command literal is exposed, folded into view, or explicitly excluded', () => {
    const classified = new Set<string>([
      ...EXPOSED_COMMAND_TYPES,
      ...VIEW_COMMAND_TYPES,
      ...EXCLUDED_COMMAND_TYPES
    ]);
    for (const type of Object.keys(ALL_COMMAND_TYPES)) {
      expect(classified.has(type), `${type} is unclassified`).toBe(true);
    }
    // And nothing is in two lists.
    expect(classified.size).toBe(
      EXPOSED_COMMAND_TYPES.length + VIEW_COMMAND_TYPES.length + EXCLUDED_COMMAND_TYPES.length
    );
  });

  it('never exposes clear or help', () => {
    const verbs = buildToolDescriptors().map((d) => d.verb);
    expect(verbs).not.toContain('clear');
    expect(verbs).not.toContain('help');
  });

  it('builds one tool per exposed type plus view and batch', () => {
    const verbs = buildToolDescriptors().map((d) => d.verb);
    expect(verbs).toEqual([...EXPOSED_COMMAND_TYPES, ...COMPOSITE_VERBS]);
  });

  it('omits view when asked', () => {
    const verbs = buildToolDescriptors({ view: false }).map((d) => d.verb);
    expect(verbs).not.toContain('view');
    expect(verbs).toContain('batch');
  });

  it('marks exactly the classifier read-only set as readOnly', () => {
    const readOnly = buildToolDescriptors()
      .filter((d) => d.readOnly)
      .map((d) => d.verb)
      .sort();
    expect(readOnly).toEqual([
      'describe_type',
      'get_config',
      'info',
      'list_edges',
      'list_nodes',
      'list_types',
      'search_types'
    ]);
  });

  it('every exposed command has a description, a schema, a builder and a summary', () => {
    for (const type of EXPOSED_COMMAND_TYPES) {
      const record = commandRecord(type);
      expect(record.description.length, `${type} description`).toBeGreaterThan(10);
      expect(record.inputSchema.type, `${type} schema`).toBe('object');
      expect(typeof record.build, `${type} build`).toBe('function');
      expect(typeof record.summarize, `${type} summarize`).toBe('function');
    }
  });

  it('every schema keyword in use is one the validator handles', () => {
    const seen = new Set<string>();
    const walk = (schema: ToolSchemaProperty): void => {
      for (const key of Object.keys(schema)) seen.add(key);
      for (const p of Object.values(schema.properties ?? {})) walk(p);
      if (schema.items) walk(schema.items);
      for (const alt of schema.anyOf ?? []) walk(alt);
    };
    for (const d of buildToolDescriptors()) walk(d.inputSchema);
    for (const key of seen) {
      expect(VALIDATOR_KEYWORDS.has(key as keyof ToolSchemaProperty), `${key} is unhandled`).toBe(
        true
      );
    }
  });

  it('every schema forbids additional properties', () => {
    for (const d of buildToolDescriptors()) {
      expect(d.inputSchema.type).toBe('object');
      expect(d.inputSchema.additionalProperties).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const byVerb = (verb: string) => {
  const d = buildToolDescriptors().find((x) => x.verb === verb);
  if (!d) throw new Error(`no descriptor ${verb}`);
  return d;
};

const run = (verb: string, input: unknown): Command[] => {
  const d = byVerb(verb);
  return d.toCommands(validateToolArgs(d.inputSchema, input));
};

describe('validateToolArgs', () => {
  it('rejects a missing required field', () => {
    expect(() => run('add_node', {})).toThrow(ToolArgumentError);
    expect(() => run('add_node', {})).toThrow(/nodeTypeId is required/);
  });

  it('rejects unknown properties', () => {
    expect(() => run('list_nodes', { foo: 1 })).toThrow(/foo: unknown property/);
  });

  it('rejects a wrong type', () => {
    expect(() => run('rename_node', { nodeId: 'a.1', label: 42 })).toThrow(
      /label: expected string, got number/
    );
  });

  it('rejects a bad enum value', () => {
    expect(() => run('auto_layout', { direction: 'diagonal' })).toThrow(
      /direction: expected one of/
    );
  });

  it('validates nested position objects', () => {
    expect(() => run('move_node', { nodeId: 'a.1', position: { x: 1 } })).toThrow(
      /position.y is required/
    );
    expect(() => run('move_node', { nodeId: 'a.1', position: { x: 1, y: 'two' } })).toThrow(
      /position.y: expected number/
    );
  });

  it('treats null/undefined input as an empty object', () => {
    expect(run('list_nodes', undefined)).toEqual([{ type: 'list_nodes' }]);
    expect(run('undo', null)).toEqual([{ type: 'undo' }]);
  });

  it('rejects non-object input', () => {
    expect(() => run('list_nodes', 'x')).toThrow(/arguments must be an object/);
  });

  it('set_config accepts every primitive shape and rejects null', () => {
    for (const value of ['a', 1, true, { a: 1 }, [1]]) {
      expect(() => run('set_config', { nodeId: 'a.1', key: 'k', value })).not.toThrow();
    }
    expect(() => run('set_config', { nodeId: 'a.1', key: 'k', value: null })).toThrow(
      /value: expected one of/
    );
  });
});

// ---------------------------------------------------------------------------
// view + batch mapping
// ---------------------------------------------------------------------------

describe('view tool', () => {
  it('maps actions to the UI commands', () => {
    expect(run('view', { action: 'select_node', nodeId: 'a.1' })).toEqual([
      { type: 'select_node', nodeId: 'a.1' }
    ]);
    expect(run('view', { action: 'open_config', nodeId: 'a.1' })).toEqual([
      { type: 'config_open', nodeId: 'a.1' }
    ]);
    expect(run('view', { action: 'fit_view' })).toEqual([{ type: 'canvas_fit_view' }]);
    expect(run('view', { action: 'zoom_to', level: 1.5 })).toEqual([
      { type: 'canvas_zoom_to', level: 1.5 }
    ]);
    expect(run('view', { action: 'pan_to', position: { x: 1, y: 2 } })).toEqual([
      { type: 'canvas_pan_to', position: { x: 1, y: 2 } }
    ]);
    expect(run('view', { action: 'reset_view' })).toEqual([{ type: 'canvas_reset_view' }]);
  });

  it('requires the action-specific argument', () => {
    expect(() => run('view', { action: 'select_node' })).toThrow(/nodeId is required for action/);
    expect(() => run('view', { action: 'zoom_to' })).toThrow(/level is required/);
  });
});

describe('batch tool', () => {
  it('maps each item through its own tool schema', () => {
    const commands = run('batch', {
      commands: [
        { type: 'add_node', nodeTypeId: 'llm_node' },
        { type: 'set_config', nodeId: 'llm_node.1', key: 'model', value: 'gpt-4' },
        { type: 'view', action: 'fit_view' }
      ]
    });
    expect(commands).toEqual([
      { type: 'add_node', nodeTypeId: 'llm_node' },
      { type: 'set_config', nodeId: 'llm_node.1', key: 'model', value: '"gpt-4"' },
      { type: 'canvas_fit_view' }
    ]);
  });

  it('reports the failing item by index', () => {
    expect(() =>
      run('batch', { commands: [{ type: 'add_node', nodeTypeId: 'x' }, { type: 'connect' }] })
    ).toThrow(/commands\[1\] \(connect\): sourceNodeId is required/);
  });

  it('refuses unknown, excluded and empty items', () => {
    expect(() => run('batch', { commands: [] })).toThrow(/must not be empty/);
    expect(() => run('batch', { commands: [{ type: 'clear' }] })).toThrow(/type: expected one of/);
    expect(() => run('batch', { commands: [{ type: 'nope' }] })).toThrow(/type: expected one of/);
  });

  it('refuses view items when view is disabled', () => {
    const d = buildToolDescriptors({ view: false }).find((x) => x.verb === 'batch')!;
    expect(() =>
      d.toCommands(
        validateToolArgs(d.inputSchema, { commands: [{ type: 'view', action: 'fit_view' }] })
      )
    ).toThrow(/view is not available/);
  });
});

// ---------------------------------------------------------------------------
// Round trip against the text DSL: same CommandResult for the same intent
// ---------------------------------------------------------------------------

function meta(id: string, name: string, overrides?: Partial<NodeMetadata>): NodeMetadata {
  return {
    node_type_id: id,
    name,
    category: 'ai',
    inputs: [],
    outputs: [],
    configSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', default: 'gpt-4' },
        temperature: { type: 'number', default: 0.7 },
        stream: { type: 'boolean', default: false }
      }
    },
    ...overrides
  } as NodeMetadata;
}

const llm = meta('agentspec.llm_node', 'LLM Node', {
  inputs: [{ id: 'prompt', name: 'Prompt', type: 'input', dataType: 'string' }],
  outputs: [{ id: 'text', name: 'Text', type: 'output', dataType: 'string' }]
});
const api = meta('agentspec.api_node', 'API Node', {
  inputs: [{ id: 'body', name: 'Body', type: 'input', dataType: 'string' }],
  outputs: [{ id: 'response', name: 'Response', type: 'output', dataType: 'string' }]
});
const nodeTypes = [llm, api];

function node(id: string, m: NodeMetadata): WorkflowNode {
  return {
    id,
    type: 'universalNode',
    position: { x: 100, y: 100 },
    deletable: true,
    data: { label: m.name, config: { model: 'gpt-4' }, metadata: m }
  } as WorkflowNode;
}

function context(): { ctx: CommandContext; dispatch: CommandDispatch } {
  const wf: Workflow = {
    id: 'wf',
    name: 'Round trip',
    nodes: [node('agentspec.llm_node.1', llm), node('agentspec.api_node.1', api)],
    edges: []
  } as Workflow;
  const dispatch: CommandDispatch = {
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
    cancelTransaction: vi.fn(),
    emitUIAction: vi.fn()
  };
  return {
    ctx: { getWorkflow: () => wf, nodeTypes, typeMap: buildTypeMap(nodeTypes), dispatch },
    dispatch
  };
}

/** Text DSL line ↔ tool call pairs that must produce identical results. */
const PAIRS: Array<{ dsl: string; verb: string; args: Record<string, unknown> }> = [
  { dsl: 'add llm_node', verb: 'add_node', args: { nodeTypeId: 'llm_node' } },
  { dsl: 'delete llm_node.1', verb: 'delete_node', args: { nodeId: 'llm_node.1' } },
  { dsl: 'describe llm_node', verb: 'describe_type', args: { nodeTypeId: 'llm_node' } },
  { dsl: 'search llm', verb: 'search_types', args: { query: 'llm' } },
  { dsl: 'get llm_node.1', verb: 'get_config', args: { nodeId: 'llm_node.1' } },
  {
    dsl: 'rename llm_node.1 Summariser',
    verb: 'rename_node',
    args: { nodeId: 'llm_node.1', label: 'Summariser' }
  },
  {
    dsl: 'set llm_node.1:model "gpt-4o"',
    verb: 'set_config',
    args: { nodeId: 'llm_node.1', key: 'model', value: 'gpt-4o' }
  },
  {
    dsl: 'set llm_node.1:temperature 0.2',
    verb: 'set_config',
    args: { nodeId: 'llm_node.1', key: 'temperature', value: 0.2 }
  },
  {
    dsl: 'set llm_node.1:stream true',
    verb: 'set_config',
    args: { nodeId: 'llm_node.1', key: 'stream', value: true }
  },
  { dsl: 'get llm_node.1:model', verb: 'get_config', args: { nodeId: 'llm_node.1', key: 'model' } },
  {
    dsl: 'connect llm_node.1:text to api_node.1:body',
    verb: 'connect',
    args: {
      sourceNodeId: 'llm_node.1',
      sourcePort: 'text',
      targetNodeId: 'api_node.1',
      targetPort: 'body'
    }
  },
  { dsl: 'disconnect api_node.1', verb: 'disconnect_node', args: { nodeId: 'api_node.1' } },
  { dsl: 'list nodes', verb: 'list_nodes', args: {} },
  { dsl: 'list edges', verb: 'list_edges', args: {} },
  { dsl: 'list types', verb: 'list_types', args: {} },
  { dsl: 'info llm_node.1', verb: 'info', args: { nodeId: 'llm_node.1' } },
  { dsl: 'undo', verb: 'undo', args: {} },
  { dsl: 'redo', verb: 'redo', args: {} },
  {
    dsl: 'move llm_node.1 to 300,400',
    verb: 'move_node',
    args: { nodeId: 'llm_node.1', position: { x: 300, y: 400 } }
  },
  {
    dsl: 'swap llm_node.1 with api_node',
    verb: 'swap_node',
    args: { nodeId: 'llm_node.1', newTypeId: 'api_node' }
  },
  { dsl: 'layout auto --direction vertical', verb: 'auto_layout', args: { direction: 'vertical' } },
  { dsl: 'layout beautify', verb: 'beautify_layout', args: {} },
  { dsl: 'select llm_node.1', verb: 'view', args: { action: 'select_node', nodeId: 'llm_node.1' } },
  { dsl: 'config llm_node.1', verb: 'view', args: { action: 'open_config', nodeId: 'llm_node.1' } },
  { dsl: 'canvas fitview', verb: 'view', args: { action: 'fit_view' } },
  { dsl: 'canvas zoom 1.5', verb: 'view', args: { action: 'zoom_to', level: 1.5 } }
];

describe('round trip: tool call ≡ DSL line', () => {
  it.each(PAIRS)('$verb ≡ "$dsl"', ({ dsl, verb, args }) => {
    const parsed = parseCommand(dsl);
    expect(parsed.ok, `DSL did not parse: ${dsl}`).toBe(true);
    if (!parsed.ok) return;

    const [command] = run(verb, args);

    expect(command).toEqual(parsed.command);

    const a = executeCommand(parsed.command, context().ctx);
    const b = executeCommand(command, context().ctx);
    expect(b).toEqual(a);
  });
});

describe('describeCommand', () => {
  it('names every exposed command for a human', () => {
    for (const d of buildToolDescriptors()) {
      if (d.verb === 'batch') continue;
      const sample: Record<string, Record<string, unknown>> = {
        add_node: { nodeTypeId: 'llm_node' },
        delete_node: { nodeId: 'a.1' },
        rename_node: { nodeId: 'a.1', label: 'x' },
        move_node: { nodeId: 'a.1', position: { x: 1, y: 2 } },
        swap_node: { nodeId: 'a.1', newTypeId: 'b' },
        set_config: { nodeId: 'a.1', key: 'k', value: 1 },
        get_config: { nodeId: 'a.1', key: 'k' },
        connect: { sourceNodeId: 'a.1', sourcePort: 'o', targetNodeId: 'b.1', targetPort: 'i' },
        disconnect_ports: {
          sourceNodeId: 'a.1',
          sourcePort: 'o',
          targetNodeId: 'b.1',
          targetPort: 'i'
        },
        disconnect_node: { nodeId: 'a.1' },
        info: { nodeId: 'a.1' },
        describe_type: { nodeTypeId: 'a' },
        search_types: { query: 'a' },
        auto_layout: {},
        view: { action: 'fit_view' }
      };
      const [cmd] = d.toCommands(validateToolArgs(d.inputSchema, sample[d.verb] ?? {}));
      expect(describeCommand(cmd).length).toBeGreaterThan(0);
    }
  });
});
