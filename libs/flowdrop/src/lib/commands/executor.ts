/**
 * Command Executor
 *
 * Executes parsed Command objects against a CommandContext,
 * dispatching mutations to the workflow store.
 *
 * @module commands/executor
 */

import type {
  Command,
  CommandContext,
  CommandResult,
  AddNodeResultData,
  GetConfigKeyResultData,
  GetConfigAllResultData,
  SetConfigResultData,
  InfoResultData,
  ListNodesResultData,
  ListEdgesResultData,
  ListTypesResultData,
  SearchTypesResultData,
  DescribeTypeResultData,
  TypeSummary,
  ConfigKeyDescription,
  PortDescription,
  HelpResultData,
  SwapNodeResultData
} from './types.js';
import type { ConfigProperty, ConfigSchema, Branch, DynamicPort } from '../types/index.js';
import type { NodeMetadata, NodePort, WorkflowNode, WorkflowEdge } from '../types/index.js';
import { generateNodeId } from '../utils/nodeIds.js';
import { extractConfigDefaults } from '../utils/nodeIds.js';
import { computeAutoPosition } from './positioner.js';
import { buildHandleId, extractPortId } from '../utils/handleIds.js';
import { applyConnectionStyling } from '../utils/edgeStyling.js';
import { computeSwapPreview, executeSwap } from '../utils/nodeSwap.js';
import { computeAutoLayout, computeBeautifyLayout } from '../adapters/agentspec/autoLayout.js';

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Convert an internal namespaced node ID to a DSL short ID.
 * "agentspec.llm_node.1" → "llm_node.1"
 * "llm_node.1" → "llm_node.1" (no namespace, unchanged)
 */
export function toShortId(internalId: string): string {
  // Node IDs are <namespace>.<typeId>.<number> or <typeId>.<number>
  // The namespace is the first segment if there are 3+ dot-separated parts
  // and the last segment is a number
  const parts = internalId.split('.');
  if (parts.length >= 3) {
    const lastPart = parts[parts.length - 1];
    if (/^\d+$/.test(lastPart)) {
      // Strip the first segment (namespace)
      return parts.slice(1).join('.');
    }
  }
  return internalId;
}

/**
 * Convert a namespaced type ID to a short type ID.
 * "agentspec.llm_node" → "llm_node"
 * "llm_node" → "llm_node" (no namespace, unchanged)
 */
export function toShortTypeId(typeId: string): string {
  const dotIndex = typeId.indexOf('.');
  if (dotIndex !== -1) {
    return typeId.substring(dotIndex + 1);
  }
  return typeId;
}

/**
 * Resolve a DSL short ID (e.g. "llm_node.1") to the actual workflow node.
 * Tries direct match first, then looks for a namespaced match.
 */
export function resolveNode(shortId: string, nodes: WorkflowNode[]): WorkflowNode | undefined {
  // Direct match
  const direct = nodes.find((n) => n.id === shortId);
  if (direct) return direct;

  // Namespaced match: node ID ends with ".<shortId>"
  return nodes.find((n) => n.id.endsWith(`.${shortId}`));
}

// ============================================================================
// Teaching errors (D7 of the browser-agent plan)
// ============================================================================
//
// A failed command names the valid alternatives, because for a browser agent
// the error text is the only channel there is: an unknown node lists the
// nodes, an unknown type points at list_types and names near misses, an
// unknown port lists the node's ports, an unknown config key lists the keys.
// Lists are capped so a large workflow cannot turn one error into a dump.

const MAX_LISTED = 15;

function listCapped(items: string[]): string {
  if (items.length === 0) return 'none';
  const shown = items.slice(0, MAX_LISTED);
  const rest = items.length - shown.length;
  return shown.join(', ') + (rest > 0 ? `, … and ${rest} more` : '');
}

/** Near misses for an unknown id: same prefix, or one contains the other. */
function nearMisses(needle: string, haystack: string[]): string[] {
  const n = needle.toLowerCase();
  const stem = n.split(/[._-]/)[0];
  return haystack
    .filter((h) => {
      const l = h.toLowerCase();
      return l.includes(n) || n.includes(l) || (stem.length >= 3 && l.startsWith(stem));
    })
    .slice(0, 5);
}

function nodeNotFoundMessage(nodeId: string, nodes: WorkflowNode[]): string {
  const ids = nodes.map((n) => toShortId(n.id));
  return nodes.length === 0
    ? `Node not found: ${nodeId}. The workflow has no nodes yet — add_node first.`
    : `Node not found: ${nodeId}. Nodes in this workflow: ${listCapped(ids)}.`;
}

function typeNotFoundMessage(typeId: string, context: CommandContext): string {
  const ids = context.nodeTypes.map((m) => toShortTypeId(m.node_type_id));
  const near = nearMisses(typeId, ids);
  const hint =
    near.length > 0
      ? ` Did you mean: ${near.join(', ')}?`
      : ' Call list_types (or search_types) for the ids this editor accepts.';
  return `Unknown node type: ${typeId}.${hint}`;
}

/** Every port id a node exposes in one direction, static and config-driven. */
function portIds(node: WorkflowNode, direction: 'input' | 'output'): string[] {
  const metadata = node.data?.metadata;
  const config = node.data?.config;
  if (direction === 'output') {
    return [
      ...(metadata?.outputs ?? []).map((p) => p.id),
      ...((config?.branches as Branch[] | undefined) ?? []).map((b) => b.name),
      ...((config?.dynamicOutputs as DynamicPort[] | undefined) ?? []).map((p) => p.name)
    ];
  }
  return [
    ...(metadata?.inputs ?? []).map((p) => p.id),
    ...((config?.dynamicInputs as DynamicPort[] | undefined) ?? []).map((p) => p.name)
  ];
}

function portNotFoundMessage(
  node: WorkflowNode,
  portId: string,
  direction: 'input' | 'output'
): string {
  const short = toShortId(node.id);
  const wanted = portIds(node, direction);
  const other = portIds(node, direction === 'input' ? 'output' : 'input');
  const otherWord = direction === 'input' ? 'outputs' : 'inputs';
  return (
    `Port '${portId}' not found on node ${short}. ` +
    `Its ${direction}s: ${listCapped(wanted)}; its ${otherWord}: ${listCapped(other)}.`
  );
}

function configKeys(node: WorkflowNode): string[] {
  const schemaKeys = Object.keys(node.data?.metadata?.configSchema?.properties ?? {});
  const valueKeys = Object.keys((node.data?.config as Record<string, unknown> | undefined) ?? {});
  return Array.from(new Set([...schemaKeys, ...valueKeys]));
}

// ============================================================================
// Describing types (shared by list_types, search_types, describe_type, get_config)
// ============================================================================

function typeSummary(m: NodeMetadata): TypeSummary {
  const row: TypeSummary = {
    typeId: toShortTypeId(m.node_type_id),
    name: m.name,
    category: m.category
  };
  if (m.description) row.description = m.description;
  if (m.tags && m.tags.length > 0) row.tags = m.tags;
  return row;
}

function describePort(p: NodePort): PortDescription {
  const out: PortDescription = { portId: p.id, name: p.name, dataType: p.dataType };
  if (p.required) out.required = true;
  if (p.description) out.description = p.description;
  return out;
}

function describeConfigKey(
  key: string,
  property: ConfigProperty | undefined,
  required: boolean
): ConfigKeyDescription {
  const out: ConfigKeyDescription = { key };
  if (property) {
    // Host schemas may declare `type` as a JSON Schema array; keep it as sent.
    const type = property.type as unknown as string | string[] | undefined;
    if (type !== undefined) out.type = type;
    if (property.title) out.title = property.title;
    if (property.description) out.description = property.description;
    if (property.enum && property.enum.length > 0) out.enum = property.enum;
    if (property.default !== undefined) out.default = property.default;
  }
  if (required) out.required = true;
  return out;
}

function describeConfigSchema(schema: ConfigSchema | undefined): ConfigKeyDescription[] {
  if (!schema?.properties) return [];
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties).map(([key, property]) =>
    describeConfigKey(key, property, required.has(key))
  );
}

function describeType(m: NodeMetadata): DescribeTypeResultData {
  const out: DescribeTypeResultData = {
    ...typeSummary(m),
    inputs: (m.inputs ?? []).map(describePort),
    outputs: (m.outputs ?? []).map(describePort),
    config: describeConfigSchema(m.configSchema)
  };
  if (m.confirmation) out.confirmation = m.confirmation;
  if (m.can) out.can = m.can;
  if (m.agent) out.agent = m.agent;
  return out;
}

// ============================================================================
// Command Handlers
// ============================================================================

function executeAddNode(
  command: Extract<Command, { type: 'add_node' }>,
  context: CommandContext
): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  const metadata = context.typeMap.get(command.nodeTypeId);
  if (!metadata) {
    return {
      ok: false,
      error: typeNotFoundMessage(command.nodeTypeId, context),
      code: 'NODE_TYPE_NOT_FOUND'
    };
  }

  const position = command.position ?? computeAutoPosition(workflow.nodes);
  const nodeId = generateNodeId(metadata.node_type_id, workflow.nodes);
  const config = extractConfigDefaults(metadata.configSchema);

  const node: WorkflowNode = {
    id: nodeId,
    type: 'universalNode',
    position,
    deletable: true,
    data: {
      label: metadata.name,
      config,
      metadata
    }
  };

  context.dispatch.addNode(node);

  const shortId = toShortId(nodeId);
  const resultData: AddNodeResultData = {
    nodeId: shortId,
    type: command.nodeTypeId,
    label: metadata.name,
    position
  };

  return {
    ok: true,
    message: `Added ${metadata.name} as ${shortId}`,
    data: resultData
  };
}

function executeDeleteNode(
  command: Extract<Command, { type: 'delete_node' }>,
  context: CommandContext
): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  const node = resolveNode(command.nodeId, workflow.nodes);
  if (!node) {
    return {
      ok: false,
      error: nodeNotFoundMessage(command.nodeId, workflow.nodes),
      code: 'NODE_NOT_FOUND'
    };
  }

  context.dispatch.removeNode(node.id);

  return {
    ok: true,
    message: `Deleted node ${toShortId(node.id)}`
  };
}

function executeRenameNode(
  command: Extract<Command, { type: 'rename_node' }>,
  context: CommandContext
): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  const node = resolveNode(command.nodeId, workflow.nodes);
  if (!node) {
    return {
      ok: false,
      error: nodeNotFoundMessage(command.nodeId, workflow.nodes),
      code: 'NODE_NOT_FOUND'
    };
  }

  context.dispatch.updateNode(node.id, {
    data: { ...node.data, label: command.label }
  });

  return {
    ok: true,
    message: `Renamed ${toShortId(node.id)} to "${command.label}"`
  };
}

/**
 * Parse a raw value string into the appropriate JS type.
 * Priority: quoted string (preserved) > JSON > number > boolean > raw string
 */
function parseConfigValue(raw: string): unknown {
  // Double-quoted string — JSON-unescape so \n, \t, \\ etc. work
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }

  // Single-quoted string — strip quotes (no escape processing)
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1);
  }

  // Try JSON (arrays, objects, null)
  if (raw.startsWith('[') || raw.startsWith('{') || raw === 'null') {
    try {
      return JSON.parse(raw);
    } catch {
      // fall through
    }
  }

  // Number
  if (raw !== '' && !isNaN(Number(raw))) {
    return Number(raw);
  }

  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Raw string
  return raw;
}

/**
 * Validate a parsed config value against a ConfigProperty schema.
 * Returns an array of validation warnings (empty if valid or no schema).
 */
function validateConfigValue(
  key: string,
  value: unknown,
  property: ConfigProperty | undefined
): SetConfigResultData['warnings'] {
  if (!property) return [];

  const warnings: NonNullable<SetConfigResultData['warnings']> = [];

  // Enum validation
  if (property.enum && property.enum.length > 0) {
    if (!property.enum.includes(value)) {
      warnings.push({
        type: 'enum',
        message: `Value ${JSON.stringify(value)} is not in allowed values: ${property.enum.map((v) => JSON.stringify(v)).join(', ')}`,
        allowedValues: property.enum
      });
    }
  }

  // Type validation
  if (property.type) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    // Node config schemas from the backend sometimes declare `type` as a JSON
    // Schema array (e.g. ['string', 'boolean']) rather than a single literal;
    // `ConfigProperty.type` stays a single literal (it drives the schema
    // form elsewhere), so normalise here instead of widening that interface.
    const rawType = property.type as ConfigProperty['type'] | ConfigProperty['type'][];
    const declaredTypes = Array.isArray(rawType) ? rawType : [rawType];
    const expectedTypes: string[] = declaredTypes.map((t) => (t === 'integer' ? 'number' : t));

    // Only warn if there's a genuine mismatch (null/object handled specially)
    if (
      value !== null &&
      !expectedTypes.includes(actualType) &&
      !(expectedTypes.includes('object') && actualType === 'object')
    ) {
      warnings.push({
        type: 'type_mismatch',
        message: `Expected type ${expectedTypes.map((t) => `'${t}'`).join(' or ')} but got '${actualType}'`,
        expectedType: property.type,
        actualType
      });
    }
  }

  return warnings;
}

function executeSetConfig(
  command: Extract<Command, { type: 'set_config' }>,
  context: CommandContext
): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  const node = resolveNode(command.nodeId, workflow.nodes);
  if (!node) {
    return {
      ok: false,
      error: nodeNotFoundMessage(command.nodeId, workflow.nodes),
      code: 'NODE_NOT_FOUND'
    };
  }

  const parsedValue = parseConfigValue(command.value);

  // Validate against configSchema if present
  const metadata = node.data.metadata;
  const configSchema = metadata?.configSchema;
  const property = configSchema?.properties?.[command.key];
  const warnings = validateConfigValue(command.key, parsedValue, property) ?? [];

  // A key the schema does not declare is stored anyway — hosts keep config
  // open — but the caller is told, with the keys that do exist, so an agent
  // that misspelt one finds out now rather than at run time. Silent when the
  // node has no schema at all: there is nothing to compare against.
  const declaredKeys = Object.keys(configSchema?.properties ?? {});
  if (!property && declaredKeys.length > 0) {
    warnings.push({
      type: 'unknown_key',
      message: `Key '${command.key}' is not in the config schema of ${toShortId(node.id)}. Declared keys: ${listCapped(declaredKeys)}`,
      knownKeys: declaredKeys
    });
  }

  // In strict mode, validation warnings become errors
  if (command.strict && warnings && warnings.length > 0) {
    const messages = warnings.map((w) => w.message).join('; ');
    return {
      ok: false,
      error: `Config validation failed for ${toShortId(node.id)}:${command.key}: ${messages}`,
      code: 'CONFIG_VALIDATION_ERROR'
    };
  }

  const updatedConfig = { ...node.data.config, [command.key]: parsedValue };

  context.dispatch.updateNode(node.id, {
    data: { ...node.data, config: updatedConfig }
  });

  const resultData: SetConfigResultData = {
    nodeId: toShortId(node.id),
    key: command.key,
    value: parsedValue,
    ...(warnings && warnings.length > 0 ? { warnings } : {})
  };

  const warningMsg =
    warnings && warnings.length > 0
      ? ` (warning: ${warnings.map((w) => w.message).join('; ')})`
      : '';

  return {
    ok: true,
    message: `Set ${toShortId(node.id)}:${command.key} = ${JSON.stringify(parsedValue)}${warningMsg}`,
    data: resultData
  };
}

function executeGetConfig(
  command: Extract<Command, { type: 'get_config' }>,
  context: CommandContext
): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  const node = resolveNode(command.nodeId, workflow.nodes);
  if (!node) {
    return {
      ok: false,
      error: nodeNotFoundMessage(command.nodeId, workflow.nodes),
      code: 'NODE_NOT_FOUND'
    };
  }

  const config = (node.data.config as Record<string, unknown> | undefined) ?? {};
  const schema = node.data.metadata?.configSchema;
  const shortId = toShortId(node.id);

  // No key: every value, and the schema that explains them.
  if (command.key === undefined) {
    const resultData: GetConfigAllResultData = {
      nodeId: shortId,
      values: config,
      schema: describeConfigSchema(schema)
    };
    const keys = Object.keys(config);
    return {
      ok: true,
      message:
        keys.length === 0
          ? `${shortId} has no config values set`
          : `${shortId} config: ${keys.map((k) => `${k} = ${JSON.stringify(config[k])}`).join(', ')}`,
      data: resultData
    };
  }

  const property = schema?.properties?.[command.key];
  if (!(command.key in config) && !property) {
    return {
      ok: false,
      error: `Config key not found: ${command.key} on ${shortId}. Keys: ${listCapped(configKeys(node))}.`,
      code: 'CONFIG_KEY_NOT_FOUND'
    };
  }

  const required = new Set(schema?.required ?? []).has(command.key);
  const resultData: GetConfigKeyResultData = {
    nodeId: shortId,
    key: command.key,
    value: config[command.key],
    ...(property ? { schema: describeConfigKey(command.key, property, required) } : {})
  };

  return {
    ok: true,
    message: `${shortId}:${command.key} = ${JSON.stringify(config[command.key])}`,
    data: resultData
  };
}

function executeInfo(
  command: Extract<Command, { type: 'info' }>,
  context: CommandContext
): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  const node = resolveNode(command.nodeId, workflow.nodes);
  if (!node) {
    return {
      ok: false,
      error: nodeNotFoundMessage(command.nodeId, workflow.nodes),
      code: 'NODE_NOT_FOUND'
    };
  }

  const metadata = node.data.metadata;
  const shortId = toShortId(node.id);

  const inputs = (metadata?.inputs ?? []).map((p) => ({
    portId: p.id,
    name: p.name,
    dataType: p.dataType
  }));

  const staticOutputs = (metadata?.outputs ?? []).map((p) => ({
    portId: p.id,
    name: p.name,
    dataType: p.dataType
  }));

  // Gateway nodes expose dynamic branch ports from config.branches
  const branchOutputs: typeof staticOutputs =
    metadata?.type === 'gateway'
      ? ((node.data.config?.branches as Branch[] | undefined) ?? []).map((b) => ({
          portId: b.name,
          name: b.name,
          dataType: 'trigger'
        }))
      : [];

  const outputs = [...staticOutputs, ...branchOutputs];

  // Build connected edges info
  const connectedEdges: InfoResultData['connectedEdges'] = [];
  for (const edge of workflow.edges) {
    if (edge.source === node.id) {
      connectedEdges.push({
        edgeId: edge.id,
        direction: 'outgoing',
        remoteNodeId: toShortId(edge.target),
        remotePort: extractPortId(edge.targetHandle) ?? '',
        localPort: extractPortId(edge.sourceHandle) ?? ''
      });
    } else if (edge.target === node.id) {
      connectedEdges.push({
        edgeId: edge.id,
        direction: 'incoming',
        remoteNodeId: toShortId(edge.source),
        remotePort: extractPortId(edge.sourceHandle) ?? '',
        localPort: extractPortId(edge.targetHandle) ?? ''
      });
    }
  }

  const resultData: InfoResultData = {
    nodeId: shortId,
    label: node.data.label ?? metadata?.name ?? '',
    type: metadata?.node_type_id ? toShortTypeId(metadata.node_type_id) : '',
    position: node.position,
    config: (node.data.config as Record<string, unknown>) ?? {},
    inputs,
    outputs,
    connectedEdges
  };

  return {
    ok: true,
    message: `Info for ${shortId}`,
    data: resultData
  };
}

// ============================================================================
// Connection Operations
// ============================================================================

/**
 * Find a port in a node's metadata by port ID, checking both inputs and outputs.
 * Returns the port and its direction.
 */
function findPort(
  node: WorkflowNode,
  portId: string,
  preferDirection?: 'output' | 'input'
): {
  port: { id: string; name: string; dataType: string };
  direction: 'input' | 'output';
} | null {
  const metadata = node.data?.metadata;
  const config = node.data?.config;
  if (!metadata && !config) return null;

  // Resolve an output port from static metadata or config-driven ports. The
  // latter are not in metadata.outputs: gateway branches live in config.branches
  // and user-defined handles live in config.dynamicOutputs (both keyed by name).
  const resolveOutput = (): { id: string; name: string; dataType: string } | null => {
    const meta = metadata?.outputs?.find((p) => p.id === portId);
    if (meta) return meta;
    const branch = (config?.branches as Branch[] | undefined)?.find((b) => b.name === portId);
    if (branch) return { id: portId, name: branch.label ?? portId, dataType: 'trigger' };
    const dynamic = (config?.dynamicOutputs as DynamicPort[] | undefined)?.find(
      (p) => p.name === portId
    );
    if (dynamic) return { id: portId, name: dynamic.label ?? portId, dataType: dynamic.dataType };
    return null;
  };

  // Resolve an input port from static metadata or config.dynamicInputs.
  const resolveInput = (): { id: string; name: string; dataType: string } | null => {
    const meta = metadata?.inputs?.find((p) => p.id === portId);
    if (meta) return meta;
    const dynamic = (config?.dynamicInputs as DynamicPort[] | undefined)?.find(
      (p) => p.name === portId
    );
    if (dynamic) return { id: portId, name: dynamic.label ?? portId, dataType: dynamic.dataType };
    return null;
  };

  const outputPort = resolveOutput();
  const inputPort = resolveInput();

  if (preferDirection === 'input') {
    if (inputPort) return { port: inputPort, direction: 'input' };
    if (outputPort) return { port: outputPort, direction: 'output' };
  } else {
    // Default and explicit 'output' both prefer the output port first.
    if (outputPort) return { port: outputPort, direction: 'output' };
    if (inputPort) return { port: inputPort, direction: 'input' };
  }

  return null;
}

function executeConnect(
  command: Extract<Command, { type: 'connect' }>,
  context: CommandContext
): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  // Resolve both nodes
  const sourceNode = resolveNode(command.sourceNodeId, workflow.nodes);
  if (!sourceNode) {
    return {
      ok: false,
      error: nodeNotFoundMessage(command.sourceNodeId, workflow.nodes),
      code: 'NODE_NOT_FOUND'
    };
  }

  const targetNode = resolveNode(command.targetNodeId, workflow.nodes);
  if (!targetNode) {
    return {
      ok: false,
      error: nodeNotFoundMessage(command.targetNodeId, workflow.nodes),
      code: 'NODE_NOT_FOUND'
    };
  }

  // Look up ports in metadata to determine direction.
  // Since connections always flow output → input, prefer the output port on the
  // source node and the input port on the target node when the same port name
  // exists in both directions on a node.
  const sourcePortInfo = findPort(sourceNode, command.sourcePort, 'output');
  if (!sourcePortInfo) {
    return {
      ok: false,
      error: portNotFoundMessage(sourceNode, command.sourcePort, 'output'),
      code: 'PORT_NOT_FOUND'
    };
  }

  const targetPortInfo = findPort(targetNode, command.targetPort, 'input');
  if (!targetPortInfo) {
    return {
      ok: false,
      error: portNotFoundMessage(targetNode, command.targetPort, 'input'),
      code: 'PORT_NOT_FOUND'
    };
  }

  // Validate directions: source port must be output, target port must be input
  if (sourcePortInfo.direction !== 'output' || targetPortInfo.direction !== 'input') {
    // Check if they're reversed
    if (sourcePortInfo.direction === 'input' && targetPortInfo.direction === 'output') {
      return {
        ok: false,
        error: `Connection direction reversed: '${command.sourcePort}' is an input on ${toShortId(sourceNode.id)} and '${command.targetPort}' is an output on ${toShortId(targetNode.id)}. Swap source and target.`,
        code: 'INVALID_CONNECTION'
      };
    }
    // One of them is the wrong direction
    if (sourcePortInfo.direction !== 'output') {
      return {
        ok: false,
        error: `Port '${command.sourcePort}' on ${toShortId(sourceNode.id)} is an input, not an output (per node metadata)`,
        code: 'INVALID_CONNECTION'
      };
    }
    return {
      ok: false,
      error: `Port '${command.targetPort}' on ${toShortId(targetNode.id)} is an output, not an input (per node metadata)`,
      code: 'INVALID_CONNECTION'
    };
  }

  // Build handle IDs
  const sourceHandle = buildHandleId(sourceNode.id, 'output', command.sourcePort);
  const targetHandle = buildHandleId(targetNode.id, 'input', command.targetPort);

  // Generate edge ID
  const edgeId = `${sourceNode.id}-${sourceHandle}-${targetNode.id}-${targetHandle}`;

  // Idempotency guard: re-applying the same connection (e.g. a second
  // AI-assistant Apply that re-emits an existing edge) must not append a
  // duplicate. Two edges sharing an id crash the canvas with Svelte's
  // `each_key_duplicate`. Treat an existing identical connection as a no-op.
  const alreadyConnected = workflow.edges.some(
    (e) =>
      e.id === edgeId ||
      (e.source === sourceNode.id &&
        e.target === targetNode.id &&
        e.sourceHandle === sourceHandle &&
        e.targetHandle === targetHandle)
  );
  if (alreadyConnected) {
    return {
      ok: true,
      message: `Already connected ${toShortId(sourceNode.id)}:${command.sourcePort} → ${toShortId(targetNode.id)}:${command.targetPort}`
    };
  }

  // Build edge
  const edge: WorkflowEdge = {
    id: edgeId,
    source: sourceNode.id,
    target: targetNode.id,
    sourceHandle,
    targetHandle
  };

  // Apply styling
  applyConnectionStyling(edge, sourceNode, targetNode);

  // Dispatch
  context.dispatch.addEdge(edge);

  return {
    ok: true,
    message: `Connected ${toShortId(sourceNode.id)}:${command.sourcePort} → ${toShortId(targetNode.id)}:${command.targetPort}`
  };
}

function executeDisconnectPorts(
  command: Extract<Command, { type: 'disconnect_ports' }>,
  context: CommandContext
): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  // Resolve both nodes
  const sourceNode = resolveNode(command.sourceNodeId, workflow.nodes);
  if (!sourceNode) {
    return {
      ok: false,
      error: nodeNotFoundMessage(command.sourceNodeId, workflow.nodes),
      code: 'NODE_NOT_FOUND'
    };
  }

  const targetNode = resolveNode(command.targetNodeId, workflow.nodes);
  if (!targetNode) {
    return {
      ok: false,
      error: nodeNotFoundMessage(command.targetNodeId, workflow.nodes),
      code: 'NODE_NOT_FOUND'
    };
  }

  // Find the matching edge by checking source/target node IDs and port IDs
  const edge = workflow.edges.find((e) => {
    if (e.source !== sourceNode.id || e.target !== targetNode.id) return false;
    const sourcePort = extractPortId(e.sourceHandle);
    const targetPort = extractPortId(e.targetHandle);
    return sourcePort === command.sourcePort && targetPort === command.targetPort;
  });

  if (!edge) {
    const outgoing = workflow.edges
      .filter((e) => e.source === sourceNode.id)
      .map(
        (e) =>
          `${toShortId(e.source)}:${extractPortId(e.sourceHandle) ?? '?'} → ${toShortId(e.target)}:${extractPortId(e.targetHandle) ?? '?'}`
      );
    return {
      ok: false,
      error:
        `No edge found from ${toShortId(sourceNode.id)}:${command.sourcePort} to ${toShortId(targetNode.id)}:${command.targetPort}. ` +
        `Edges leaving ${toShortId(sourceNode.id)}: ${listCapped(outgoing)}.`,
      code: 'EDGE_NOT_FOUND'
    };
  }

  context.dispatch.removeEdge(edge.id);

  return {
    ok: true,
    message: `Disconnected ${toShortId(sourceNode.id)}:${command.sourcePort} from ${toShortId(targetNode.id)}:${command.targetPort}`
  };
}

function executeDisconnectNode(
  command: Extract<Command, { type: 'disconnect_node' }>,
  context: CommandContext
): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  const node = resolveNode(command.nodeId, workflow.nodes);
  if (!node) {
    return {
      ok: false,
      error: nodeNotFoundMessage(command.nodeId, workflow.nodes),
      code: 'NODE_NOT_FOUND'
    };
  }

  // Find all edges connected to this node
  const connectedEdges = workflow.edges.filter((e) => e.source === node.id || e.target === node.id);

  for (const edge of connectedEdges) {
    context.dispatch.removeEdge(edge.id);
  }

  return {
    ok: true,
    message: `Disconnected ${connectedEdges.length} edge(s) from ${toShortId(node.id)}`
  };
}

// ============================================================================
// List & Help Operations
// ============================================================================

function executeListNodes(context: CommandContext): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  const nodes = workflow.nodes.map((n) => ({
    nodeId: toShortId(n.id),
    label: n.data.label ?? n.data.metadata?.name ?? '',
    type: n.data.metadata?.node_type_id ? toShortTypeId(n.data.metadata.node_type_id) : ''
  }));

  const resultData: ListNodesResultData = { nodes };

  return {
    ok: true,
    message:
      nodes.length === 0
        ? 'No nodes in workflow'
        : `${nodes.length} node(s): ${nodes.map((n) => n.nodeId).join(', ')}`,
    data: resultData
  };
}

function executeListEdges(context: CommandContext): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  const edges = workflow.edges.map((e) => ({
    edgeId: e.id,
    sourceNodeId: toShortId(e.source),
    sourcePort: extractPortId(e.sourceHandle) ?? '',
    targetNodeId: toShortId(e.target),
    targetPort: extractPortId(e.targetHandle) ?? ''
  }));

  const resultData: ListEdgesResultData = { edges };

  return {
    ok: true,
    message: edges.length === 0 ? 'No edges in workflow' : `${edges.length} edge(s)`,
    data: resultData
  };
}

function executeListTypes(context: CommandContext): CommandResult {
  const types = context.nodeTypes.map(typeSummary);

  const resultData: ListTypesResultData = { types };

  return {
    ok: true,
    message: `${types.length} type(s) available`,
    data: resultData
  };
}

function executeSearchTypes(
  command: Extract<Command, { type: 'search_types' }>,
  context: CommandContext
): CommandResult {
  const query = command.query.trim().toLowerCase();
  if (!query) {
    return {
      ok: false,
      error: 'search_types needs text to look for. For the whole catalog call list_types.',
      code: 'EMPTY_QUERY'
    };
  }
  const matches = context.nodeTypes.filter((m) => {
    const fields = [
      toShortTypeId(m.node_type_id),
      m.node_type_id,
      m.name,
      m.description ?? '',
      ...(m.tags ?? [])
    ];
    return fields.some((f) => f.toLowerCase().includes(query));
  });
  const types = matches.map(typeSummary);

  const resultData: SearchTypesResultData = { query: command.query, types };

  return {
    ok: true,
    message:
      types.length === 0
        ? `No node type matches "${command.query}" — try list_types for the full catalog`
        : `${types.length} type(s) match "${command.query}": ${listCapped(types.map((t) => t.typeId))}`,
    data: resultData
  };
}

function executeDescribeType(
  command: Extract<Command, { type: 'describe_type' }>,
  context: CommandContext
): CommandResult {
  const metadata = context.typeMap.get(command.nodeTypeId);
  if (!metadata) {
    return {
      ok: false,
      error: typeNotFoundMessage(command.nodeTypeId, context),
      code: 'NODE_TYPE_NOT_FOUND'
    };
  }

  const resultData = describeType(metadata);

  return {
    ok: true,
    message: `${resultData.typeId}: ${resultData.inputs.length} input(s), ${resultData.outputs.length} output(s), ${resultData.config.length} config key(s)`,
    data: resultData
  };
}

/** All command help entries */
export const COMMAND_HELP: Array<{
  name: string;
  syntax: string;
  description: string;
}> = [
  {
    name: 'add',
    syntax: 'add <type> [at <x>,<y>]',
    description: 'Add a new node of the specified type'
  },
  {
    name: 'delete',
    syntax: 'delete <nodeId>',
    description: 'Delete a node and its connections'
  },
  {
    name: 'rename',
    syntax: 'rename <nodeId> <label>',
    description: "Rename a node's display label"
  },
  {
    name: 'set',
    syntax: 'set <nodeId>:<key> <value>',
    description: 'Set a config value on a node'
  },
  {
    name: 'get',
    syntax: 'get <nodeId>[:<key>]',
    description: 'Get a config value from a node, or every value plus the schema'
  },
  {
    name: 'connect',
    syntax: 'connect <nid>:<port> to <nid>:<port>',
    description: 'Connect two node ports'
  },
  {
    name: 'disconnect',
    syntax: 'disconnect <nid>:<port> from <nid>:<port>',
    description: 'Disconnect two node ports'
  },
  {
    name: 'disconnect',
    syntax: 'disconnect <nodeId>',
    description: 'Disconnect all edges from a node'
  },
  {
    name: 'list',
    syntax: 'list nodes|edges|types',
    description: 'List workflow nodes, edges, or available types'
  },
  {
    name: 'describe',
    syntax: 'describe <type>',
    description: 'Show the ports, config schema and defaults of a node type'
  },
  {
    name: 'search',
    syntax: 'search <text>',
    description: 'Find node types by id, name, description or tag'
  },
  {
    name: 'info',
    syntax: 'info <nodeId>',
    description: 'Show detailed info about a node'
  },
  {
    name: 'config',
    syntax: 'config <nodeId>',
    description: 'Open the config panel for a node'
  },
  {
    name: 'select',
    syntax: 'select <nodeId>',
    description: 'Select a node on the canvas'
  },
  {
    name: 'swap',
    syntax: 'swap <nodeId> with <type>',
    description: "Replace a node's type, preserving connections"
  },
  {
    name: 'move',
    syntax: 'move <nodeId> to <x>,<y>',
    description: 'Move a node to a position'
  },
  {
    name: 'layout',
    syntax: 'layout auto [--direction horizontal|vertical]',
    description: 'Auto-arrange all nodes'
  },
  {
    name: 'layout',
    syntax: 'layout beautify',
    description: 'Normalize spacing while preserving node arrangement'
  },
  { name: 'undo', syntax: 'undo', description: 'Undo the last action' },
  { name: 'redo', syntax: 'redo', description: 'Redo the last undone action' },
  {
    name: 'help',
    syntax: 'help [<command>]',
    description: 'Show help for all or a specific command'
  },
  { name: 'clear', syntax: 'clear', description: 'Remove all nodes and edges' },
  {
    name: 'canvas',
    syntax: 'canvas fitview',
    description: 'Fit all nodes into the viewport'
  },
  {
    name: 'canvas',
    syntax: 'canvas zoom in',
    description: 'Zoom in on the canvas'
  },
  {
    name: 'canvas',
    syntax: 'canvas zoom out',
    description: 'Zoom out on the canvas'
  },
  {
    name: 'canvas',
    syntax: 'canvas zoom <level>',
    description: 'Set zoom to a specific level (e.g. 1.5)'
  },
  {
    name: 'canvas',
    syntax: 'canvas pan <x>,<y>',
    description: 'Pan the canvas to center on a position'
  },
  {
    name: 'canvas',
    syntax: 'canvas reset',
    description: 'Reset viewport to default position and zoom'
  }
];

function executeHelp(command: Extract<Command, { type: 'help' }>): CommandResult {
  let commands: HelpResultData['commands'];

  if (command.command) {
    commands = COMMAND_HELP.filter((h) => h.name === command.command);
    if (commands.length === 0) {
      commands = COMMAND_HELP; // Unknown command name — show all
    }
  } else {
    commands = COMMAND_HELP;
  }

  const resultData: HelpResultData = { commands };

  const message = commands.map((c) => `  ${c.syntax} — ${c.description}`).join('\n');

  return {
    ok: true,
    message: command.command
      ? `Help for '${command.command}':\n${message}`
      : `Available commands:\n${message}`,
    data: resultData
  };
}

// ============================================================================
// Undo, Redo, Clear, Config, Select
// ============================================================================

function executeUndo(context: CommandContext): CommandResult {
  const success = context.dispatch.undo();
  if (!success) {
    return {
      ok: false,
      error: 'Nothing to undo',
      code: 'UNDO_UNAVAILABLE'
    };
  }
  return { ok: true, message: 'Undone' };
}

function executeRedo(context: CommandContext): CommandResult {
  const success = context.dispatch.redo();
  if (!success) {
    return {
      ok: false,
      error: 'Nothing to redo',
      code: 'REDO_UNAVAILABLE'
    };
  }
  return { ok: true, message: 'Redone' };
}

function executeClear(context: CommandContext): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  const nodeCount = workflow.nodes.length;
  const edgeCount = workflow.edges.length;

  context.dispatch.batchUpdate({ nodes: [], edges: [] });

  return {
    ok: true,
    message: `Cleared ${nodeCount} node(s) and ${edgeCount} edge(s)`
  };
}

function executeConfigOpen(
  command: Extract<Command, { type: 'config_open' }>,
  context: CommandContext
): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  const node = resolveNode(command.nodeId, workflow.nodes);
  if (!node) {
    return {
      ok: false,
      error: nodeNotFoundMessage(command.nodeId, workflow.nodes),
      code: 'NODE_NOT_FOUND'
    };
  }

  if (context.dispatch.emitUIAction) {
    context.dispatch.emitUIAction({ type: 'open_config', nodeId: node.id });
    return {
      ok: true,
      message: `Opened config for ${toShortId(node.id)}`
    };
  }

  return {
    ok: true,
    message: `Config open requested for ${toShortId(node.id)} (no UI handler)`,
    uiActionPending: true
  };
}

function executeSelectNode(
  command: Extract<Command, { type: 'select_node' }>,
  context: CommandContext
): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  const node = resolveNode(command.nodeId, workflow.nodes);
  if (!node) {
    return {
      ok: false,
      error: nodeNotFoundMessage(command.nodeId, workflow.nodes),
      code: 'NODE_NOT_FOUND'
    };
  }

  if (context.dispatch.emitUIAction) {
    context.dispatch.emitUIAction({ type: 'select_node', nodeId: node.id });
    return {
      ok: true,
      message: `Selected ${toShortId(node.id)}`
    };
  }

  return {
    ok: true,
    message: `Select requested for ${toShortId(node.id)} (no UI handler)`,
    uiActionPending: true
  };
}

function executeSwapNode(
  command: Extract<Command, { type: 'swap_node' }>,
  context: CommandContext
): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  const node = resolveNode(command.nodeId, workflow.nodes);
  if (!node) {
    return {
      ok: false,
      error: nodeNotFoundMessage(command.nodeId, workflow.nodes),
      code: 'NODE_NOT_FOUND'
    };
  }

  const newMetadata = context.typeMap.get(command.newTypeId);
  if (!newMetadata) {
    return {
      ok: false,
      error: typeNotFoundMessage(command.newTypeId, context),
      code: 'NODE_TYPE_NOT_FOUND'
    };
  }

  const preview = computeSwapPreview(node, newMetadata, workflow.edges, workflow.nodes);

  const swapResult = executeSwap(node, newMetadata, preview, workflow.nodes, workflow.edges);

  if (context.dispatch.swapNode) {
    context.dispatch.swapNode({
      nodes: swapResult.updatedNodes,
      edges: swapResult.updatedEdges,
      oldNodeId: node.id,
      newNodeId: preview.newNodeId,
      portMappings: preview.portMappings
    });
  } else {
    context.dispatch.batchUpdate({
      nodes: swapResult.updatedNodes,
      edges: swapResult.updatedEdges
    });
  }

  // Name each dropped edge so the user can see exactly what was lost
  const droppedEdgeDetails = preview.droppedEdges.map(({ edge }) => {
    const sourcePort = extractPortId(edge.sourceHandle ?? undefined) ?? '?';
    const targetPort = extractPortId(edge.targetHandle ?? undefined) ?? '?';
    return `${toShortId(edge.source)}:${sourcePort} → ${toShortId(edge.target)}:${targetPort}`;
  });

  const resultData: SwapNodeResultData = {
    oldNodeId: toShortId(node.id),
    newNodeId: toShortId(preview.newNodeId),
    newType: command.newTypeId,
    keptEdges: preview.keptEdges.length,
    droppedEdges: preview.droppedEdges.length,
    droppedEdgeDetails,
    hasDataLoss: preview.hasDataLoss,
    configCarriedOver: preview.configCarriedOver,
    configReset: preview.configReset
  };

  // Cap the inline list — a badly mismatched swap can drop dozens of edges,
  // and the full list is always available in resultData.droppedEdgeDetails
  const MAX_NAMED_DROPPED_EDGES = 5;
  const namedDropped = droppedEdgeDetails.slice(0, MAX_NAMED_DROPPED_EDGES);
  const unnamedCount = droppedEdgeDetails.length - namedDropped.length;
  const droppedMsg =
    preview.droppedEdges.length > 0
      ? ` (${preview.droppedEdges.length} edge(s) dropped: ${namedDropped.join(', ')}${
          unnamedCount > 0 ? `, … and ${unnamedCount} more` : ''
        })`
      : '';

  return {
    ok: true,
    message: `Swapped ${toShortId(node.id)} → ${toShortId(preview.newNodeId)} (${command.newTypeId})${droppedMsg}`,
    data: resultData
  };
}

function executeMoveNode(
  command: Extract<Command, { type: 'move_node' }>,
  context: CommandContext
): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  const node = resolveNode(command.nodeId, workflow.nodes);
  if (!node) {
    return {
      ok: false,
      error: nodeNotFoundMessage(command.nodeId, workflow.nodes),
      code: 'NODE_NOT_FOUND'
    };
  }

  context.dispatch.updateNode(node.id, {
    position: command.position
  });

  return {
    ok: true,
    message: `Moved ${toShortId(node.id)} to (${command.position.x}, ${command.position.y})`
  };
}

function executeAutoLayout(
  command: Extract<Command, { type: 'auto_layout' }>,
  context: CommandContext
): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  if (workflow.nodes.length === 0) {
    return { ok: true, message: 'No nodes to layout' };
  }

  const isVertical = command.direction === 'vertical';

  // Filter out loopback edges (loop_back port) — they go backwards and
  // would reverse the layout direction if included.
  const layoutEdges = workflow.edges.filter(
    (e) => !(e.targetHandle ?? '').includes('-input-loop_back')
  );

  // Determine start node via in-degree: a node with no incoming edges
  // (from non-loopback edges) is a root. Fall back to leftmost position.
  const inDegree = new Map<string, number>();
  for (const n of workflow.nodes) inDegree.set(n.id, 0);
  for (const e of layoutEdges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }
  const startNode =
    workflow.nodes.find((n) => (inDegree.get(n.id) ?? 0) === 0)?.id ??
    workflow.nodes.reduce((leftmost, n) => (n.position.x < leftmost.position.x ? n : leftmost)).id;

  const flow = {
    component_type: 'flow' as const,
    name: 'layout',
    start_node: startNode,
    nodes: workflow.nodes.map((n) => ({
      component_type: 'start_node' as const,
      name: n.id
    })),
    control_flow_connections: layoutEdges.map((e) => ({
      name: e.id,
      from_node: e.source,
      to_node: e.target
    }))
  };

  // Collect measured node dimensions when available
  const nodeDimensions = new Map<string, { width: number; height: number }>();
  for (const n of workflow.nodes) {
    const w = n.measured?.width ?? (n as { width?: number }).width;
    const h = n.measured?.height ?? (n as { height?: number }).height;
    if (w != null && h != null) {
      nodeDimensions.set(n.id, { width: w, height: h });
    }
  }

  const positions = computeAutoLayout(
    flow,
    {},
    nodeDimensions.size > 0 ? nodeDimensions : undefined
  );

  // Apply positions — swap x/y for vertical layout
  const updatedNodes = workflow.nodes.map((n) => {
    const pos = positions.get(n.id);
    if (!pos) return n;
    return {
      ...n,
      position: isVertical ? { x: pos.y, y: pos.x } : pos
    };
  });

  context.dispatch.batchUpdate({ nodes: updatedNodes });

  const direction = command.direction ?? 'horizontal';
  return {
    ok: true,
    message: `Auto-layout applied to ${workflow.nodes.length} nodes (${direction})`
  };
}

function executeBeautifyLayout(
  _command: Extract<Command, { type: 'beautify_layout' }>,
  context: CommandContext
): CommandResult {
  const workflow = context.getWorkflow();
  if (!workflow) {
    return { ok: false, error: 'No workflow loaded', code: 'NO_WORKFLOW' };
  }

  if (workflow.nodes.length === 0) {
    return { ok: true, message: 'No nodes to beautify' };
  }

  // Collect current positions
  const currentPositions = new Map<string, { x: number; y: number }>();
  for (const n of workflow.nodes) {
    currentPositions.set(n.id, { x: n.position.x, y: n.position.y });
  }

  // Collect measured node dimensions when available
  const nodeDimensions = new Map<string, { width: number; height: number }>();
  for (const n of workflow.nodes) {
    const w = n.measured?.width ?? (n as { width?: number }).width;
    const h = n.measured?.height ?? (n as { height?: number }).height;
    if (w != null && h != null) {
      nodeDimensions.set(n.id, { width: w, height: h });
    }
  }

  const positions = computeBeautifyLayout(
    currentPositions,
    {},
    nodeDimensions.size > 0 ? nodeDimensions : undefined
  );

  // Apply positions
  const updatedNodes = workflow.nodes.map((n) => {
    const pos = positions.get(n.id);
    if (!pos) return n;
    return { ...n, position: pos };
  });

  context.dispatch.batchUpdate({ nodes: updatedNodes });

  return {
    ok: true,
    message: `Beautified layout for ${workflow.nodes.length} nodes`
  };
}

// ============================================================================
// Canvas Viewport Commands
// ============================================================================

function emitCanvasAction(
  context: CommandContext,
  action: Parameters<NonNullable<typeof context.dispatch.emitUIAction>>[0],
  successMessage: string
): CommandResult {
  if (context.dispatch.emitUIAction) {
    context.dispatch.emitUIAction(action);
    return { ok: true, message: successMessage };
  }
  return {
    ok: true,
    message: `${successMessage} (no UI handler)`,
    uiActionPending: true
  };
}

function executeCanvasFitView(context: CommandContext): CommandResult {
  return emitCanvasAction(context, { type: 'canvas_fit_view' }, 'Fit view applied');
}

function executeCanvasZoomIn(context: CommandContext): CommandResult {
  return emitCanvasAction(context, { type: 'canvas_zoom_in' }, 'Zoomed in');
}

function executeCanvasZoomOut(context: CommandContext): CommandResult {
  return emitCanvasAction(context, { type: 'canvas_zoom_out' }, 'Zoomed out');
}

function executeCanvasZoomTo(
  command: Extract<Command, { type: 'canvas_zoom_to' }>,
  context: CommandContext
): CommandResult {
  return emitCanvasAction(
    context,
    { type: 'canvas_zoom_to', level: command.level },
    `Zoom set to ${command.level}`
  );
}

function executeCanvasPanTo(
  command: Extract<Command, { type: 'canvas_pan_to' }>,
  context: CommandContext
): CommandResult {
  return emitCanvasAction(
    context,
    { type: 'canvas_pan_to', position: command.position },
    `Panned to (${command.position.x}, ${command.position.y})`
  );
}

function executeCanvasResetView(context: CommandContext): CommandResult {
  return emitCanvasAction(context, { type: 'canvas_reset_view' }, 'Viewport reset');
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Execute a parsed command against a workflow context.
 */
export function executeCommand(command: Command, context: CommandContext): CommandResult {
  switch (command.type) {
    case 'add_node':
      return executeAddNode(command, context);
    case 'delete_node':
      return executeDeleteNode(command, context);
    case 'rename_node':
      return executeRenameNode(command, context);
    case 'set_config':
      return executeSetConfig(command, context);
    case 'get_config':
      return executeGetConfig(command, context);
    case 'info':
      return executeInfo(command, context);
    case 'connect':
      return executeConnect(command, context);
    case 'disconnect_ports':
      return executeDisconnectPorts(command, context);
    case 'disconnect_node':
      return executeDisconnectNode(command, context);
    case 'list_nodes':
      return executeListNodes(context);
    case 'list_edges':
      return executeListEdges(context);
    case 'list_types':
      return executeListTypes(context);
    case 'describe_type':
      return executeDescribeType(command, context);
    case 'search_types':
      return executeSearchTypes(command, context);
    case 'help':
      return executeHelp(command);
    case 'undo':
      return executeUndo(context);
    case 'redo':
      return executeRedo(context);
    case 'clear':
      return executeClear(context);
    case 'config_open':
      return executeConfigOpen(command, context);
    case 'select_node':
      return executeSelectNode(command, context);
    case 'swap_node':
      return executeSwapNode(command, context);
    case 'move_node':
      return executeMoveNode(command, context);
    case 'auto_layout':
      return executeAutoLayout(command, context);
    case 'beautify_layout':
      return executeBeautifyLayout(command, context);
    case 'canvas_fit_view':
      return executeCanvasFitView(context);
    case 'canvas_zoom_in':
      return executeCanvasZoomIn(context);
    case 'canvas_zoom_out':
      return executeCanvasZoomOut(context);
    case 'canvas_zoom_to':
      return executeCanvasZoomTo(command, context);
    case 'canvas_pan_to':
      return executeCanvasPanTo(command, context);
    case 'canvas_reset_view':
      return executeCanvasResetView(context);
    default: {
      const _exhaustive: never = command;
      return {
        ok: false,
        error: `Command not yet implemented: ${(_exhaustive as Command).type}`,
        code: 'UNKNOWN_COMMAND'
      };
    }
  }
}
