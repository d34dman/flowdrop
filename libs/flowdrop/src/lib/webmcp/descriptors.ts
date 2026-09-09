/**
 * WebMCP adapter — tool descriptors.
 *
 * Maps the command union to `{verb, description, inputSchema, readOnly,
 * toCommands}` records. Transport-free: no DOM, no Svelte, nothing from the
 * runtime — so the same records can back a server-side MCP endpoint later.
 *
 * The schemas are written by hand next to the interfaces they mirror
 * (`commands/types.ts`). Each exposed command is one record in `COMMANDS`:
 * its description, its input schema, how validated arguments become the
 * command, and how the command reads back to a human in the confirm dialog.
 * The coverage test in `tests/unit/webmcp` asserts every literal of the
 * `Command` union is either exposed here or on the explicit exclusion list,
 * and that every exposed record carries all four parts, so a new DSL verb
 * cannot slip through unclassified or half-described.
 *
 * @module webmcp/descriptors
 */

import type { Command } from '../commands/types.js';
import { isMutatingCommand, VIEW_COMMAND_TYPES } from '../chat/commandClassifier.js';
import {
  ToolArgumentError,
  type ToolDescriptor,
  type ToolInputSchema,
  type ToolSchemaProperty
} from './types.js';
import { validateToolArgs } from './validate.js';

export { validateToolArgs };

// ============================================================================
// What is exposed
// ============================================================================

/** Command types exposed as one tool each (verb === command type). */
export const EXPOSED_COMMAND_TYPES = [
  'add_node',
  'delete_node',
  'rename_node',
  'move_node',
  'swap_node',
  'set_config',
  'get_config',
  'connect',
  'disconnect_ports',
  'disconnect_node',
  'list_nodes',
  'list_edges',
  'list_types',
  'describe_type',
  'search_types',
  'info',
  'undo',
  'redo',
  'auto_layout',
  'beautify_layout'
] as const satisfies readonly Command['type'][];

/**
 * Command types folded into the single `view` tool (its `action` enum). The
 * list itself lives in the command classifier, next to `isViewCommand`, so
 * the chat panel and this adapter cannot disagree about what a view command is.
 */
export { VIEW_COMMAND_TYPES };

/**
 * Command types deliberately not exposed.
 * - `clear` wipes the whole workflow; an agent can delete nodes one by one and
 *   each deletion is gated.
 * - `help` describes the text DSL; the tool schemas are the help.
 */
export const EXCLUDED_COMMAND_TYPES = [
  'clear',
  'help'
] as const satisfies readonly Command['type'][];

/** Extra tool verbs that are not command types. */
export const COMPOSITE_VERBS = ['view', 'batch'] as const;

// ============================================================================
// Schema fragments
// ============================================================================

const NODE_ID_DESCRIPTION =
  'Node id in short form, e.g. "http_request.1" — the `nodeId` values returned by list_nodes and add_node. Full ids are accepted too.';

/**
 * The recommended call order, appended to every tool that changes the
 * workflow. For a browser agent the tool descriptions are the whole manual,
 * so the manual says how the tools fit together.
 */
const CALL_ORDER =
  ' Call describe_type before adding or configuring a type you have not seen; group several changes in one batch; save when done.';

const nodeId = (description = NODE_ID_DESCRIPTION): ToolSchemaProperty => ({
  type: 'string',
  description
});

const position: ToolSchemaProperty = {
  type: 'object',
  description: 'Canvas position in pixels.',
  properties: {
    x: { type: 'number', description: 'Horizontal position.' },
    y: { type: 'number', description: 'Vertical position.' }
  },
  required: ['x', 'y'],
  additionalProperties: false
};

const port = (which: string): ToolSchemaProperty => ({
  type: 'string',
  description: `${which} port id, as listed under inputs/outputs by the info tool.`
});

const configValue: ToolSchemaProperty = {
  description:
    'The new value. Strings are stored verbatim; numbers, booleans, arrays and objects are stored typed.',
  anyOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'object' },
    { type: 'array' }
  ]
};

const object = (
  properties: Record<string, ToolSchemaProperty>,
  required: readonly string[] = []
): ToolInputSchema => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
  additionalProperties: false
});

const EMPTY = object({});

// ============================================================================
// Argument → Command
// ============================================================================

type Args = Record<string, unknown>;
type Pos = { x: number; y: number };

/**
 * `SetConfigCommand.value` is the DSL's raw token: the executor parses it with
 * the same rules the text DSL uses (`"…"` → string, bare `12` → number, `true`
 * → boolean, `{…}`/`[…]` → JSON). JSON-encoding every typed argument routes
 * each shape to the right rule, and keeps a string like `"true"` a string.
 */
function encodeConfigValue(value: unknown): string {
  return JSON.stringify(value);
}

type ExposedType = (typeof EXPOSED_COMMAND_TYPES)[number];

/** Everything the adapter knows about one exposed command. */
interface CommandRecord<K extends ExposedType> {
  /** What the tool does, for the agent. */
  description: string;
  /** The tool's input schema; `build` receives arguments validated against it. */
  inputSchema: ToolInputSchema;
  /** Validated arguments → the command. */
  build: (args: Args) => Extract<Command, { type: K }>;
  /** The command → one line for the person about to approve it. */
  summarize: (command: Extract<Command, { type: K }>) => string;
}

const q = (v: unknown): string => JSON.stringify(v);
const at = (p: Pos): string => `(${p.x}, ${p.y})`;

const PORT_PAIR = object(
  {
    sourceNodeId: nodeId('Node the edge starts at.'),
    sourcePort: port('Output'),
    targetNodeId: nodeId('Node the edge ends at.'),
    targetPort: port('Input')
  },
  ['sourceNodeId', 'sourcePort', 'targetNodeId', 'targetPort']
);

/** One record per exposed command, keyed by command type. */
const COMMANDS: { [K in ExposedType]: CommandRecord<K> } = {
  add_node: {
    description:
      "Add a node of the given type to the workflow. Returns the new node id; the node starts with the type's default config." +
      CALL_ORDER,
    inputSchema: object(
      {
        nodeTypeId: {
          type: 'string',
          description:
            'Node type id as returned by list_types / search_types (`typeId`), e.g. "http_request". Unknown ids fail and name near misses.'
        },
        position: {
          ...position,
          description: 'Optional canvas position; auto-placed when omitted.'
        }
      },
      ['nodeTypeId']
    ),
    build: (a) => ({
      type: 'add_node',
      nodeTypeId: a.nodeTypeId as string,
      ...(a.position ? { position: a.position as Pos } : {})
    }),
    summarize: (c) => `Add node ${c.nodeTypeId}${c.position ? ` at ${at(c.position)}` : ''}`
  },
  delete_node: {
    description: 'Delete a node and every edge attached to it.' + CALL_ORDER,
    inputSchema: object({ nodeId: nodeId() }, ['nodeId']),
    build: (a) => ({ type: 'delete_node', nodeId: a.nodeId as string }),
    summarize: (c) => `Delete node ${c.nodeId}`
  },
  rename_node: {
    description: 'Change the display label of a node.' + CALL_ORDER,
    inputSchema: object(
      { nodeId: nodeId(), label: { type: 'string', description: 'New display label.' } },
      ['nodeId', 'label']
    ),
    build: (a) => ({ type: 'rename_node', nodeId: a.nodeId as string, label: a.label as string }),
    summarize: (c) => `Rename ${c.nodeId} to ${q(c.label)}`
  },
  move_node: {
    description: 'Move a node to a canvas position.' + CALL_ORDER,
    inputSchema: object({ nodeId: nodeId(), position }, ['nodeId', 'position']),
    build: (a) => ({ type: 'move_node', nodeId: a.nodeId as string, position: a.position as Pos }),
    summarize: (c) => `Move ${c.nodeId} to ${at(c.position)}`
  },
  swap_node: {
    description:
      'Replace a node with one of another type, keeping compatible connections and config. Reports what was dropped.' +
      CALL_ORDER,
    inputSchema: object(
      {
        nodeId: nodeId('Node to replace.'),
        newTypeId: {
          type: 'string',
          description:
            'Replacement node type id (see list_types / describe_type). Compatible ports and config carry over.'
        }
      },
      ['nodeId', 'newTypeId']
    ),
    build: (a) => ({
      type: 'swap_node',
      nodeId: a.nodeId as string,
      newTypeId: a.newTypeId as string
    }),
    summarize: (c) => `Swap ${c.nodeId} for a ${c.newTypeId}`
  },
  set_config: {
    description:
      'Set one configuration value on a node. A value outside the enum, of the wrong type, or under a key the schema does not declare is stored with a warning that names the allowed values / keys — fatal only when strict.' +
      CALL_ORDER,
    inputSchema: object(
      {
        nodeId: nodeId(),
        key: {
          type: 'string',
          description:
            'Config key, as listed under `config` by describe_type (with type, enum and default) or get_config.'
        },
        value: configValue,
        strict: {
          type: 'boolean',
          description: 'When true, a value the schema rejects fails the call instead of warning.'
        }
      },
      ['nodeId', 'key', 'value']
    ),
    build: (a) => ({
      type: 'set_config',
      nodeId: a.nodeId as string,
      key: a.key as string,
      value: encodeConfigValue(a.value),
      ...(a.strict !== undefined ? { strict: a.strict as boolean } : {})
    }),
    summarize: (c) => `Set ${c.nodeId}.${c.key} = ${c.value}`
  },
  get_config: {
    description:
      'Read configuration from a node. With `key`: that value and its schema entry (type, enum, default). Without: every current value under `values` plus the whole config schema.',
    inputSchema: object(
      {
        nodeId: nodeId(),
        key: {
          type: 'string',
          description: 'Config key to read; omit for all values and the schema.'
        }
      },
      ['nodeId']
    ),
    build: (a) => ({
      type: 'get_config',
      nodeId: a.nodeId as string,
      ...(a.key !== undefined ? { key: a.key as string } : {})
    }),
    summarize: (c) =>
      c.key !== undefined ? `Read ${c.nodeId}.${c.key}` : `Read config of ${c.nodeId}`
  },
  connect: {
    description:
      'Connect an output port of one node to an input port of another. An unknown port fails and lists the ports on both sides; the existing edge is kept when the connection is already there.' +
      CALL_ORDER,
    inputSchema: PORT_PAIR,
    build: (a) => ({
      type: 'connect',
      sourceNodeId: a.sourceNodeId as string,
      sourcePort: a.sourcePort as string,
      targetNodeId: a.targetNodeId as string,
      targetPort: a.targetPort as string
    }),
    summarize: (c) =>
      `Connect ${c.sourceNodeId}:${c.sourcePort} → ${c.targetNodeId}:${c.targetPort}`
  },
  disconnect_ports: {
    description: 'Remove the edge between two specific ports.' + CALL_ORDER,
    inputSchema: PORT_PAIR,
    build: (a) => ({
      type: 'disconnect_ports',
      sourceNodeId: a.sourceNodeId as string,
      sourcePort: a.sourcePort as string,
      targetNodeId: a.targetNodeId as string,
      targetPort: a.targetPort as string
    }),
    summarize: (c) =>
      `Disconnect ${c.sourceNodeId}:${c.sourcePort} → ${c.targetNodeId}:${c.targetPort}`
  },
  disconnect_node: {
    description: 'Remove every edge attached to a node.' + CALL_ORDER,
    inputSchema: object({ nodeId: nodeId() }, ['nodeId']),
    build: (a) => ({ type: 'disconnect_node', nodeId: a.nodeId as string }),
    summarize: (c) => `Disconnect every edge of ${c.nodeId}`
  },
  list_nodes: {
    description: 'List the nodes in the workflow with their ids, labels and types.',
    inputSchema: EMPTY,
    build: () => ({ type: 'list_nodes' }),
    summarize: () => 'List nodes'
  },
  list_edges: {
    description: 'List the edges in the workflow with source/target node ids and ports.',
    inputSchema: EMPTY,
    build: () => ({ type: 'list_edges' }),
    summarize: () => 'List edges'
  },
  list_types: {
    description:
      'List every node type that can be added: `typeId`, name, category, description, tags. A type not in this list is unavailable in this editor. Use search_types to narrow, describe_type for ports and config.',
    inputSchema: EMPTY,
    build: () => ({ type: 'list_types' }),
    summarize: () => 'List node types'
  },
  describe_type: {
    description:
      'Describe one node type before using it: input and output ports (id, data type, required), config keys (type, enum, default, description), and — when the host publishes them — the confirmation policy (`ask` means a run pauses for a person at this node), what you may do with it (`can`) and host guidance (`agent`). Call this before add_node and set_config.',
    inputSchema: object(
      {
        nodeTypeId: {
          type: 'string',
          description:
            'Node type id (`typeId` from list_types / search_types), e.g. "http_request".'
        }
      },
      ['nodeTypeId']
    ),
    build: (a) => ({ type: 'describe_type', nodeTypeId: a.nodeTypeId as string }),
    summarize: (c) => `Describe type ${c.nodeTypeId}`
  },
  search_types: {
    description:
      'Find node types by a case-insensitive substring of their id, name, description or tags, e.g. "markdown" or "http". Returns the same rows as list_types.',
    inputSchema: object({ query: { type: 'string', description: 'Text to look for.' } }, ['query']),
    build: (a) => ({ type: 'search_types', query: a.query as string }),
    summarize: (c) => `Search types for ${q(c.query)}`
  },
  info: {
    description:
      "Describe one node instance: type, position, current config values, input and output ports, and connected edges. For the type's schema and defaults use describe_type.",
    inputSchema: object({ nodeId: nodeId() }, ['nodeId']),
    build: (a) => ({ type: 'info', nodeId: a.nodeId as string }),
    summarize: (c) => `Describe ${c.nodeId}`
  },
  undo: {
    description:
      'Undo the last change. Each tool call that changed the workflow is one undo step; a save cannot be undone.',
    inputSchema: EMPTY,
    build: () => ({ type: 'undo' }),
    summarize: () => 'Undo'
  },
  redo: {
    description: 'Redo the last undone change.',
    inputSchema: EMPTY,
    build: () => ({ type: 'redo' }),
    summarize: () => 'Redo'
  },
  auto_layout: {
    description: 'Re-arrange all nodes automatically. Moves existing nodes.' + CALL_ORDER,
    inputSchema: object({
      direction: {
        type: 'string',
        enum: ['horizontal', 'vertical'],
        description: 'Flow direction. Default horizontal.'
      }
    }),
    build: (a) => ({
      type: 'auto_layout',
      ...(a.direction ? { direction: a.direction as 'horizontal' | 'vertical' } : {})
    }),
    summarize: (c) => `Auto-layout (${c.direction ?? 'horizontal'})`
  },
  beautify_layout: {
    description: 'Tidy the layout of all nodes. Moves existing nodes.' + CALL_ORDER,
    inputSchema: EMPTY,
    build: () => ({ type: 'beautify_layout' }),
    summarize: () => 'Beautify layout'
  }
};

/** The record for one exposed command — for tests that check its shape. */
export function commandRecord(type: ExposedType): {
  description: string;
  inputSchema: ToolInputSchema;
  build: (args: Args) => Command;
  summarize: (command: Command) => string;
} {
  return COMMANDS[type] as unknown as ReturnType<typeof commandRecord>;
}

// ============================================================================
// view + batch
// ============================================================================

const VIEW_ACTIONS = [
  'select_node',
  'open_config',
  'fit_view',
  'zoom_in',
  'zoom_out',
  'zoom_to',
  'pan_to',
  'reset_view'
] as const;

type ViewAction = (typeof VIEW_ACTIONS)[number];

const VIEW_TO_COMMAND: Record<ViewAction, (typeof VIEW_COMMAND_TYPES)[number]> = {
  select_node: 'select_node',
  open_config: 'config_open',
  fit_view: 'canvas_fit_view',
  zoom_in: 'canvas_zoom_in',
  zoom_out: 'canvas_zoom_out',
  zoom_to: 'canvas_zoom_to',
  pan_to: 'canvas_pan_to',
  reset_view: 'canvas_reset_view'
};

const VIEW_SCHEMA: ToolInputSchema = object(
  {
    action: {
      type: 'string',
      enum: VIEW_ACTIONS,
      description:
        'select_node / open_config need nodeId; zoom_to needs level; pan_to needs position; the rest take nothing else.'
    },
    nodeId: nodeId('Node for select_node and open_config.'),
    level: {
      type: 'number',
      description: 'Zoom level for zoom_to (1 = 100%).',
      minimum: 0.1,
      maximum: 4
    },
    position: { ...position, description: 'Canvas position for pan_to.' }
  },
  ['action']
);

function buildViewCommand(args: Args): Command {
  const action = args.action as ViewAction;
  const requireArg = (key: string): void => {
    if (args[key] === undefined)
      throw new ToolArgumentError(`${key} is required for action "${action}"`);
  };
  switch (action) {
    case 'select_node':
      requireArg('nodeId');
      return { type: 'select_node', nodeId: args.nodeId as string };
    case 'open_config':
      requireArg('nodeId');
      return { type: 'config_open', nodeId: args.nodeId as string };
    case 'zoom_to':
      requireArg('level');
      return { type: 'canvas_zoom_to', level: args.level as number };
    case 'pan_to':
      requireArg('position');
      return { type: 'canvas_pan_to', position: args.position as Pos };
    default:
      return { type: VIEW_TO_COMMAND[action] } as Command;
  }
}

const BATCH_ITEM_TYPES: readonly string[] = [...EXPOSED_COMMAND_TYPES, 'view'];

const BATCH_SCHEMA: ToolInputSchema = object(
  {
    commands: {
      type: 'array',
      description:
        'Commands to run in order. Each item is the argument object of one tool plus a `type` naming that tool (without the prefix), e.g. {"type":"add_node","nodeTypeId":"http_request"}. Read-only items are allowed but pointless here.',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: BATCH_ITEM_TYPES, description: 'Tool verb.' }
        },
        required: ['type'],
        additionalProperties: true
      }
    }
  },
  ['commands']
);

/** Build the command(s) for one tool verb from validated args. */
function commandsForVerb(verb: string, args: Args, viewEnabled: boolean): Command[] {
  if (verb === 'view') {
    if (!viewEnabled) throw new ToolArgumentError('view is not available in this editor');
    return [buildViewCommand(validateToolArgs(VIEW_SCHEMA, args))];
  }
  if ((EXPOSED_COMMAND_TYPES as readonly string[]).includes(verb)) {
    const record = COMMANDS[verb as ExposedType];
    return [record.build(validateToolArgs(record.inputSchema, args))];
  }
  throw new ToolArgumentError(`unknown command type "${verb}"`);
}

function buildBatchCommands(args: Args, viewEnabled: boolean): Command[] {
  const items = args.commands as Args[];
  if (items.length === 0) throw new ToolArgumentError('commands must not be empty');
  return items.flatMap((item, i) => {
    const { type, ...rest } = item;
    try {
      return commandsForVerb(type as string, rest, viewEnabled);
    } catch (err) {
      if (err instanceof ToolArgumentError) {
        throw new ToolArgumentError(`commands[${i}] (${String(type)}): ${err.message}`);
      }
      throw err;
    }
  });
}

// ============================================================================
// Public API
// ============================================================================

export interface BuildDescriptorsOptions {
  /** Register the `view` tool. Default true. */
  view?: boolean;
}

/**
 * Build the descriptor list. Pure; call it as often as you like.
 */
export function buildToolDescriptors(options: BuildDescriptorsOptions = {}): ToolDescriptor[] {
  const viewEnabled = options.view ?? true;

  const singles: ToolDescriptor[] = EXPOSED_COMMAND_TYPES.map((type) => {
    const record = COMMANDS[type];
    return {
      verb: type,
      description: record.description,
      inputSchema: record.inputSchema,
      readOnly: !isMutatingCommand(type),
      toCommands: (args) => [record.build(args)]
    };
  });

  const view: ToolDescriptor[] = viewEnabled
    ? [
        {
          verb: 'view',
          description:
            'Drive the editor view: select a node, open its config panel, or move the canvas viewport (fit, zoom, pan, reset). Changes nothing in the workflow.',
          inputSchema: VIEW_SCHEMA,
          // Classified as the chat panel classifies them: not in the read-only
          // set, so they pass through the gate.
          readOnly: false,
          toCommands: (args) => [buildViewCommand(args)]
        }
      ]
    : [];

  const batch: ToolDescriptor = {
    verb: 'batch',
    description:
      'Run several commands as one transaction: all succeed or none apply, one approval covers them all, and one undo reverts them all. Prefer this over many single calls when building a flow — describe the types first, batch the adds, connects and set_configs, then save.',
    inputSchema: BATCH_SCHEMA,
    readOnly: false,
    toCommands: (args) => buildBatchCommands(args, viewEnabled)
  };

  return [...singles, ...view, batch];
}

// ============================================================================
// Human-readable summaries (for the confirm dialog)
// ============================================================================

type ViewCommandType = (typeof VIEW_COMMAND_TYPES)[number];
type ExcludedCommandType = (typeof EXCLUDED_COMMAND_TYPES)[number];

/**
 * Summaries for the commands that are not one tool each: the view actions
 * (folded into `view`) and the two excluded verbs, which can still appear in
 * a command list a host asks the gate about.
 */
const OTHER_SUMMARIES: {
  [K in ViewCommandType | ExcludedCommandType]: (command: Extract<Command, { type: K }>) => string;
} = {
  select_node: (c) => `Select ${c.nodeId}`,
  config_open: (c) => `Open config of ${c.nodeId}`,
  canvas_fit_view: () => 'Fit view',
  canvas_zoom_in: () => 'Zoom in',
  canvas_zoom_out: () => 'Zoom out',
  canvas_zoom_to: (c) => `Zoom to ${c.level}`,
  canvas_pan_to: (c) => `Pan to ${at(c.position)}`,
  canvas_reset_view: () => 'Reset view',
  clear: () => 'Clear the workflow',
  help: () => 'Help'
};

/** One line describing a command for a human about to approve it. */
export function describeCommand(command: Command): string {
  const type = command.type;
  if (type in COMMANDS) {
    return (COMMANDS[type as ExposedType].summarize as (c: Command) => string)(command);
  }
  return (OTHER_SUMMARIES[type as keyof typeof OTHER_SUMMARIES] as (c: Command) => string)(command);
}
