/**
 * Core types for the Workflow Library
 */

import type { Component } from 'svelte';
import type { Node, Edge, XYPosition, ConnectionLineType } from '@xyflow/svelte';
import type { EndpointConfig } from '../config/endpoints.js';
import type { AuthProvider } from './auth.js';

/**
 * Built-in node categories that ship with FlowDrop.
 * These categories have predefined icons, colors, and display names.
 */
export type BuiltinNodeCategory =
  | 'triggers'
  | 'inputs'
  | 'outputs'
  | 'prompts'
  | 'models'
  | 'processing'
  | 'logic'
  | 'data'
  | 'tools'
  | 'helpers'
  | 'vector stores'
  | 'embeddings'
  | 'memories'
  | 'agents'
  | 'ai'
  | 'interrupts'
  | 'bundles';

/**
 * Node category for organizing nodes in the sidebar.
 * Includes all built-in categories plus any custom string.
 * Custom categories can be defined via the `/categories` API endpoint.
 *
 * @example
 * ```typescript
 * // Built-in category
 * const cat: NodeCategory = 'triggers';
 *
 * // Custom category
 * const custom: NodeCategory = 'my-custom-category';
 * ```
 */
export type NodeCategory = BuiltinNodeCategory | (string & Record<never, never>);

/**
 * Built-in workflow format identifiers that ship with FlowDrop.
 */
export type BuiltinWorkflowFormat = 'flowdrop' | 'agentspec';

/**
 * Workflow format identifier.
 * Determines sidebar node filtering and export behavior.
 * Includes built-in formats plus any custom string for third-party adapters.
 */
export type WorkflowFormat = BuiltinWorkflowFormat | (string & Record<never, never>);

/**
 * Default workflow format used when none is specified.
 */
export const DEFAULT_WORKFLOW_FORMAT: WorkflowFormat = 'flowdrop';

/**
 * Category definition with metadata for display and organization.
 * Fetched from the `/categories` API endpoint or provided as defaults.
 */
export interface CategoryDefinition {
  /** Machine name / unique identifier */
  name: string;
  /** Display label shown in UI */
  label: string;
  /** Icon identifier (e.g. 'mdi:brain') */
  icon?: string;
  /** Color token or CSS value (e.g. 'var(--fd-node-purple)') */
  color?: string;
  /** Category description */
  description?: string;
  /** Sort weight for ordering (lower = earlier) */
  weight?: number;
}

/**
 * Port data type configuration
 */
export interface PortDataTypeConfig {
  /** Unique identifier for the data type */
  id: string;
  /** Display name for the data type */
  name: string;
  /** Description of the data type */
  description?: string;
  /** Color for the data type (CSS color value) */
  color: string;
  /** Category grouping for the data type */
  category?: string;
  /** Alternative names/aliases for this data type */
  aliases?: string[];
  /** Whether this data type is enabled */
  enabled?: boolean;
  /**
   * The JSON Schema this lane promises, when a port shape declares one.
   *
   * This is what lets template autocomplete offer `error.message` rather than
   * only `error`: the lane says what fields travel on it, once, for every port
   * that declares the lane. Absent — not empty — when the lane promises
   * nothing beyond its name, so "no promise" stays distinguishable from
   * "an object with no properties".
   *
   * Authoring information only. Nothing validates a value against it, and a
   * port may still carry a NARROWER {@link NodePort.schema} of its own, which
   * wins.
   */
  schema?: PortSchema;
}

/**
 * A JSON Schema as served on a lane entry or a port.
 *
 * Deliberately looser than {@link OutputSchema}: a lane may promise something
 * that is not an object at all (the `messages` lane is a top-level `array`),
 * and a JSON Schema's keyword space is not ours to enumerate — the backend
 * stores it untyped for exactly that reason. Readers take `properties` when
 * there is one and fall back to the port itself when there is not.
 */
export interface PortSchema {
  type?: string;
  title?: string;
  description?: string;
  required?: string[];
  properties?: Record<string, BaseProperty>;
  items?: BaseProperty;
  [key: string]: unknown;
}

/**
 * Port compatibility rule configuration
 * Simple rule: sourceType can connect TO targetType
 */
export interface PortCompatibilityRule {
  /** Source data type ID (what you're connecting FROM) */
  from: string;
  /** Target data type ID (what you're connecting TO) */
  to: string;
  /** Optional description of why this connection is allowed */
  description?: string;
}

/**
 * Complete port configuration system
 */
export interface PortConfig {
  /** Available data types */
  dataTypes: PortDataTypeConfig[];
  /** Compatibility rules between data types */
  compatibilityRules: PortCompatibilityRule[];
  /** Default data type to use when none specified */
  defaultDataType: string;
  /** Version of the port configuration */
  version?: string;
}

/**
 * Node data type - now dynamic based on configuration
 * Will be string literals of available data type IDs
 */
export type NodeDataType = string;

/**
 * Node port configuration
 */
export interface NodePort {
  id: string;
  name: string;
  type: 'input' | 'output' | 'metadata';
  dataType: NodeDataType;
  required?: boolean;
  description?: string;
  defaultValue?: unknown;
  /**
   * Whether this port is exposed when the instance sets no explicit exposure
   * for it. Defaults to `true` (a missing flag reads as exposed). Reserved ports
   * that ship hidden until an author opts in (e.g. the `error` output) carry
   * `false`. The instance's `ports` config can override it per port.
   */
  exposedByDefault?: boolean;
  /**
   * Default sort weight for the port's render position, ascending; ties break
   * on declaration order. Author-declared ports default to `0`. Reserved ports
   * (the `error` output and `trigger`/`tool` control ports) need no value — the
   * library sinks them to the bottom automatically (see
   * `RESERVED_PORT_DISPLAY_ORDER`); set this only to override that. Cosmetic
   * only. The instance's `ports` config order overrides it.
   */
  displayOrder?: number;
  /**
   * Optional JSON Schema describing the structure of data on this port.
   * Used for template variable autocomplete to drill into nested properties.
   *
   * This is the per-port REFINEMENT slot, and it wins over the schema the
   * port's lane declares ({@link PortDataTypeConfig.schema}), which is where a
   * shape's own field list travels. It is left for the narrower thing: a
   * schema that applies to this port on this node in this workflow rather than
   * to the lane in general — a lane promising `object` whose values turn out
   * to carry `{title, description}`. Nothing populates it yet.
   */
  schema?: OutputSchema | InputSchema;
}

/**
 * One entry in a {@link PortsConfig} direction list: a port id, with display
 * order encoded by its position and an optional exposure override.
 */
export interface PortConfigEntry {
  id: string;
  /**
   * Explicit exposure for this port. Stored only when it diverges from the
   * port's metadata `exposedByDefault`. In v2 exposure is semantic: a
   * not-exposed port is hidden on the canvas, not wireable, and not
   * runtime-overridable.
   */
  exposed?: boolean;
}

/**
 * Per-instance port order + exposure, stored in `data.config.ports`.
 *
 * A per-direction ordered list of the node's ports: array index encodes display
 * order relative to the metadata default, and the optional `exposed` flag
 * overrides the port's `exposedByDefault`. A port the author never touched is
 * absent from the list; an untouched node stores no `ports` key at all. Order
 * is cosmetic (the engine ignores it); exposure is semantic.
 */
export interface PortsConfig {
  inputs?: PortConfigEntry[];
  outputs?: PortConfigEntry[];
}

/**
 * Absolute position of a port handle in canvas space.
 * Used by proximity connect and other features that need port positions.
 */
export interface PortCoordinate {
  /** Absolute X position in canvas space */
  x: number;
  /** Absolute Y position in canvas space */
  y: number;
  /** Handle ID in format: ${nodeId}-${direction}-${portId} */
  handleId: string;
  /** The node this port belongs to */
  nodeId: string;
  /** Port direction */
  direction: 'input' | 'output';
  /** Port data type for compatibility checks */
  dataType: string;
}

/** Map of handle IDs to their absolute canvas coordinates */
export type PortCoordinateMap = Map<string, PortCoordinate>;

/**
 * Dynamic port configuration for user-defined inputs/outputs
 * These are defined in the node's config and allow users to create
 * custom input/output handles at runtime similar to gateway branches
 */
export interface DynamicPort {
  /** Unique identifier for the port (used for handle IDs and connections) */
  name: string;
  /** Display label shown in the UI (optional, defaults to name) */
  label?: string;
  /** Description of what this port accepts/provides */
  description?: string;
  /** Data type for the port (affects color and connection validation) */
  dataType: NodeDataType;
  /** Whether this port is required for execution */
  required?: boolean;
}

/**
 * Branch configuration for gateway nodes
 *
 * Branches define conditional output paths in gateway/switch nodes.
 * Each branch creates an output handle that can be connected to downstream nodes.
 * Branches are stored in `config.branches` array and support dynamic addition/removal
 * through the node configuration panel.
 *
 * @example
 * ```typescript
 * const branches: Branch[] = [
 *   { name: "high", label: "High Priority", condition: "priority > 8" },
 *   { name: "medium", label: "Medium Priority", condition: "priority >= 4" },
 *   { name: "default", label: "Default", isDefault: true }
 * ];
 * ```
 */
export interface Branch {
  /** Unique identifier for the branch (used as handle ID and for connections) */
  name: string;
  /** Display label shown in the UI (optional, defaults to name) */
  label?: string;
  /** Description of when this branch is activated */
  description?: string;
  /** Optional value associated with the branch (e.g., for Switch matching) */
  value?: string;
  /** Optional condition expression for this branch */
  condition?: string;
  /** Whether this is the default/fallback branch */
  isDefault?: boolean;
}

/**
 * Convert a DynamicPort to a NodePort
 * @param port - The dynamic port configuration
 * @param portType - Whether this is an input or output port
 * @returns A NodePort compatible with the rendering system
 */
export function dynamicPortToNodePort(port: DynamicPort, portType: 'input' | 'output'): NodePort {
  return {
    id: port.name,
    name: port.label ?? port.name,
    type: portType,
    dataType: port.dataType,
    required: port.required ?? false,
    description: port.description
  };
}

/**
 * Built-in node types for explicit component rendering.
 * These are the node types that ship with FlowDrop.
 */
export type BuiltinNodeType =
  | 'note'
  | 'simple'
  | 'square'
  | 'atom'
  | 'tool'
  | 'gateway'
  | 'terminal'
  | 'default';

/**
 * Node type for component rendering.
 * Includes built-in types and allows custom registered types.
 *
 * Built-in types: note, simple, square, tool, gateway, terminal, default
 * Custom types: Any string registered via fd.nodes
 *
 * @example
 * ```typescript
 * // Built-in type
 * const type: NodeType = "simple";
 *
 * // Custom registered type
 * const customType: NodeType = "mylib:fancy";
 * ```
 */
export type NodeType = BuiltinNodeType | (string & Record<never, never>);

/**
 * HTTP method types for dynamic schema endpoints
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH';

/**
 * Autocomplete configuration for form fields
 *
 * Defines how autocomplete suggestions are fetched from a callback URL.
 * Supports both "on-type" (debounced search) and "on-focus" (load all options) modes.
 *
 * @example
 * ```typescript
 * const autocompleteConfig: AutocompleteConfig = {
 *   url: "/api/users/search",
 *   queryParam: "q",
 *   minChars: 2,
 *   debounceMs: 300,
 *   fetchOnFocus: true,
 *   labelField: "name",
 *   valueField: "id",
 *   allowFreeText: false
 * };
 * ```
 */
export interface AutocompleteConfig {
  /**
   * The callback URL to fetch autocomplete suggestions from.
   * Can be relative (resolved against API base URL) or absolute.
   */
  url: string;

  /**
   * Query parameter name to pass the search term.
   * @default "q"
   */
  queryParam?: string;

  /**
   * Minimum number of characters before fetching suggestions.
   * Set to 0 to fetch immediately on focus (when fetchOnFocus is true).
   * @default 0
   */
  minChars?: number;

  /**
   * Debounce delay in milliseconds before fetching suggestions.
   * Prevents excessive API calls while typing.
   * @default 300
   */
  debounceMs?: number;

  /**
   * Whether to fetch all options when the field is focused.
   * When true, an empty query is sent on focus to load initial options.
   * @default false
   */
  fetchOnFocus?: boolean;

  /**
   * The field name in the response objects to use as the display label.
   * @default "label"
   */
  labelField?: string;

  /**
   * The field name in the response objects to use as the stored value.
   * @default "value"
   */
  valueField?: string;

  /**
   * Whether to allow values that are not in the suggestions list.
   * When true, users can enter and submit any text.
   * When false, only values from suggestions are accepted.
   * @default false
   */
  allowFreeText?: boolean;

  /**
   * Whether to allow multiple selections.
   * When true, users can select multiple values displayed as tags.
   * When false, only a single value can be selected.
   * @default false
   */
  multiple?: boolean;

  /**
   * Map of URL query parameter names to sibling form field names.
   * When fetching autocomplete options, the current value of each
   * referenced sibling field is appended as a query parameter.
   *
   * Example: { "account": "account", "project": "project" }
   * If the "account" field currently holds "my-jira", the URL becomes:
   * /api/jira/issue-types?account=my-jira&q=...
   *
   * When a dependency field changes, the component invalidates its cached
   * suggestions and aborts any in-flight fetch. The dependent field's own
   * value is cleared by the parent form (`ConfigForm` / `SchemaForm`) on
   * user-driven edits only — undo/redo, programmatic value replacement, and
   * collaborative edits flow in via props and preserve dependent values.
   * Standalone consumers of `FormAutocomplete` outside a FlowDrop form
   * therefore need to clear dependents themselves.
   */
  params?: Record<string, string>;
}

/**
 * Dynamic schema endpoint configuration
 * Used when the config schema needs to be fetched at runtime from a REST endpoint
 *
 * @example
 * ```typescript
 * const schemaEndpoint: DynamicSchemaEndpoint = {
 *   url: "/api/nodes/{nodeTypeId}/schema",
 *   method: "GET",
 *   headers: { "X-Custom-Header": "value" },
 *   parameterMapping: {
 *     nodeTypeId: "metadata.node_type_id",
 *     instanceId: "id"
 *   }
 * };
 * ```
 */
export interface DynamicSchemaEndpoint {
  /**
   * The URL to fetch the schema from.
   * Supports template variables in curly braces (e.g., "/api/nodes/{nodeTypeId}/schema")
   * Variables are resolved from node metadata, config, or instance data.
   */
  url: string;

  /**
   * HTTP method to use for fetching the schema.
   * @default "GET"
   */
  method?: HttpMethod;

  /**
   * Custom headers to include in the request
   */
  headers?: Record<string, string>;

  /**
   * Maps template variables to their source paths.
   * Keys are variable names used in the URL, values are dot-notation paths
   * to resolve from the node context (e.g., "metadata.node_type_id", "config.apiKey", "id")
   */
  parameterMapping?: Record<string, string>;

  /**
   * Request body for POST/PUT/PATCH methods.
   * Can include template variables like the URL.
   */
  body?: Record<string, unknown>;

  /**
   * Timeout in milliseconds for the schema fetch request
   * @default 10000
   */
  timeout?: number;

  /**
   * Whether to cache the fetched schema per node instance
   * @default true
   */
  cacheSchema?: boolean;

  /**
   * How the fetched schema combines with the node's static schema
   * (the direct `schema` prop or `metadata.configSchema`).
   *
   * - `"replace"` (default): the fetched schema is used as-is and the static
   *   schema is ignored. This is the historical behaviour.
   * - `"merge"`: the fetched schema is layered onto the static schema —
   *   properties are merged (fetched wins per key) and `required` is unioned —
   *   so the endpoint only has to return the fields it actually drives.
   *
   * When there is no static schema to combine with, both strategies behave
   * identically: the fetched schema is the form.
   *
   * @default "replace"
   */
  mergeStrategy?: 'replace' | 'merge';

  /**
   * Restricts the fetched schema to a region of the static schema instead of
   * the whole form. A dot-path of property keys descending through nested
   * object `properties` (e.g. `"advanced"` or `"advanced.retry"`); the fetched
   * schema is spliced in at that location and every other field stays static.
   *
   * Use this to make just one section (or one field) server-driven while
   * authoring the rest of the form locally. `mergeStrategy` then decides whether
   * the fetched schema replaces or merges into the property at that path.
   *
   * When omitted, the fetch applies at the form root (per `mergeStrategy`).
   */
  target?: string;
}

/**
 * External edit link configuration
 * Used when the node configuration should be handled by an external 3rd party form
 *
 * @example
 * ```typescript
 * const editLink: ExternalEditLink = {
 *   url: "https://admin.example.com/nodes/{nodeTypeId}/edit/{instanceId}",
 *   label: "Configure in Admin Panel",
 *   parameterMapping: {
 *     nodeTypeId: "metadata.node_type_id",
 *     instanceId: "id"
 *   },
 *   openInNewTab: true
 * };
 * ```
 */
export interface ExternalEditLink {
  /**
   * The URL to the external edit form.
   * Supports template variables in curly braces (e.g., "/admin/nodes/{nodeTypeId}/edit")
   * Variables are resolved from node metadata, config, or instance data.
   */
  url: string;

  /**
   * Display label for the edit link button
   * @default "Configure Externally"
   */
  label?: string;

  /**
   * Icon to display alongside the label (Iconify icon name)
   * @default "heroicons:arrow-top-right-on-square"
   */
  icon?: string;

  /**
   * Maps template variables to their source paths.
   * Keys are variable names used in the URL, values are dot-notation paths
   * to resolve from the node context (e.g., "metadata.node_type_id", "config.apiKey", "id")
   */
  parameterMapping?: Record<string, string>;

  /**
   * Whether to open the link in a new tab
   * @default true
   */
  openInNewTab?: boolean;

  /**
   * Optional tooltip/description for the link
   */
  description?: string;

  /**
   * Callback URL parameter name for FlowDrop to receive updates
   * If set, the external form should redirect back with config updates
   */
  callbackUrlParam?: string;
}

/**
 * Admin/Edit configuration for nodes with dynamic or external configuration
 * Used when the config schema cannot be determined at workflow load time
 * or when configuration is handled by a 3rd party system.
 *
 * @example
 * ```typescript
 * // Option 1: External edit link only (opens external form in new tab)
 * const configEdit: ConfigEditOptions = {
 *   externalEditLink: {
 *     url: "https://admin.example.com/configure/{nodeId}",
 *     label: "Open Configuration Portal"
 *   }
 * };
 *
 * // Option 2: Dynamic schema (fetches schema from REST endpoint)
 * const configEdit: ConfigEditOptions = {
 *   dynamicSchema: {
 *     url: "/api/nodes/{nodeTypeId}/schema",
 *     method: "GET"
 *   }
 * };
 *
 * // Option 3: Both (user can choose)
 * const configEdit: ConfigEditOptions = {
 *   externalEditLink: {
 *     url: "https://admin.example.com/configure/{nodeId}",
 *     label: "Advanced Configuration"
 *   },
 *   dynamicSchema: {
 *     url: "/api/nodes/{nodeTypeId}/schema"
 *   },
 *   preferDynamicSchema: true
 * };
 * ```
 */
export interface ConfigEditOptions {
  /**
   * External link configuration for 3rd party form
   * When configured, shows a link/button to open external configuration
   */
  externalEditLink?: ExternalEditLink;

  /**
   * Dynamic schema endpoint configuration
   * When configured, fetches the config schema from the specified endpoint
   */
  dynamicSchema?: DynamicSchemaEndpoint;

  /**
   * When both externalEditLink and dynamicSchema are configured,
   * determines which to use by default
   * @default false (prefer external link)
   */
  preferDynamicSchema?: boolean;

  /**
   * Show a "Refresh Schema" button when using dynamic schema
   * Allows users to manually refresh the schema
   * @default true
   */
  showRefreshButton?: boolean;

  /**
   * Message to display when schema is being loaded
   * @default "Loading configuration options..."
   */
  loadingMessage?: string;

  /**
   * Message to display when schema fetch fails
   * @default "Failed to load configuration. Use external editor instead."
   */
  errorMessage?: string;
}

/**
 * UI-related extension settings for nodes
 * Used to control visual behavior in the workflow editor
 */
/**
 * Display/behavior config for minimalist "atom" nodes (Constant, Cast, …).
 * Lives under `extensions.ui.atom`. The atom renderer reads it to decide what to
 * show, and `getAllPorts` reads `valueTypeKey` to drive the bound output port's
 * dataType from config so connection validation stays correct.
 */
export interface AtomUIConfig {
  /** Config key whose value becomes the node body. Falls back to `data.label`. */
  valueKey?: string;
  /**
   * Config key holding the selected value's type (a port dataType id).
   * The bound output port adopts this dataType.
   */
  valueTypeKey?: string;
  /** Output port id driven by `valueTypeKey`. Defaults to the first output port. */
  outputPortId?: string;
  /** Body shape. `'pill'` (default) is fully rounded; `'rectangle'` is lightly rounded. */
  shape?: 'pill' | 'rectangle';
  /**
   * Dimmed affordance rendered before the body (e.g. `'→ '` to mark a transform).
   * Stays visible while the body value ellipsizes. Hidden in the empty state.
   */
  prefix?: string;
  /** Text shown (dimmed) when the resolved body value is empty/unset. */
  placeholder?: string;
  /** Max body width in px before the label ellipsizes. */
  maxWidth?: number;
}

export interface NodeUIExtensions {
  /** Display/behavior config for minimalist atom nodes (Constant, Cast, …) */
  atom?: AtomUIConfig;
  /** Custom styles or theme overrides */
  style?: Record<string, unknown>;
  /** Any other UI-specific settings */
  [key: string]: unknown;
}

/**
 * Custom extension properties for 3rd party integrations
 * Allows storing additional configuration and UI state data
 *
 * @example
 * ```typescript
 * const extensions: NodeExtensions = {
 *   ui: {
 *     style: { opacity: 0.8 }
 *   },
 *   "myapp:analytics": {
 *     trackUsage: true,
 *     customField: "value"
 *   }
 * };
 * ```
 */
export interface NodeExtensions {
  /**
   * UI-related settings for the node
   * Used to control visual behavior in the workflow editor
   */
  ui?: NodeUIExtensions;
  /**
   * Per-instance admin/edit configuration override
   * Allows overriding the node type's configEdit settings for specific instances
   */
  configEdit?: ConfigEditOptions;
  /**
   * Set when this node was created by swapping another node.
   * Stores the immediate predecessor only — not a full chain.
   * Sequential swaps (A→B→C) each store only their direct predecessor.
   */
  swap?: { previousNodeId: string };
  /**
   * Namespaced extension data from 3rd party integrations
   * Use your package/organization name as the key (e.g., "myapp", "acme:analyzer")
   */
  [namespace: string]: unknown;
}

/**
 * Node configuration metadata
 */
export interface NodeMetadata {
  /** The node type entity id — the runtime's resolution anchor. */
  node_type_id: string;
  name: string;
  type?: NodeType;
  /**
   * Array of supported node types that this node can be rendered as.
   * If not specified, defaults to the single 'type' field or 'default'.
   * This allows nodes to support multiple rendering modes (e.g., both 'simple' and 'default').
   * Can include both built-in types and custom registered types.
   */
  supportedTypes?: NodeType[];
  description: string;
  category: NodeCategory;
  version: string;
  icon?: string;
  color?: string;
  /** Badge label displayed in the node header (e.g., "TOOL", "API", "LLM"). Overridable per-instance via config.instanceBadge. */
  badge?: string;
  /** Port dataType to expose on tool nodes. Defaults to 'tool'. Set to another type (e.g., 'trigger') to show that port instead. */
  portDataType?: string;
  inputs: NodePort[];
  outputs: NodePort[];
  configSchema?: ConfigSchema;
  /**
   * Optional UI Schema that controls how configSchema fields are
   * arranged, grouped, and displayed in the configuration form.
   *
   * When not provided, fields render in flat order (backward compatible).
   * Uses JSON Forms-inspired format with VerticalLayout, Group, and Control elements.
   *
   * @see UISchemaElement for the element type definitions
   * @see https://jsonforms.io/docs/uischema
   */
  uiSchema?: import('./uischema.js').UISchemaElement;
  /** Default configuration values for this node type */
  config?: Record<string, unknown>;
  tags?: string[];
  /** Workflow formats this node is compatible with. Omit = universal (all formats). */
  formats?: WorkflowFormat[];
  /**
   * Admin/Edit configuration for nodes with dynamic or external configuration.
   * Used when the config schema cannot be determined at workflow load time
   * or when configuration is handled by a 3rd party system.
   *
   * Supports two options:
   * 1. External edit link - Opens a 3rd party form in a new tab
   * 2. Dynamic schema - Fetches the config schema from a REST endpoint
   *
   * @example
   * ```typescript
   * configEdit: {
   *   externalEditLink: {
   *     url: "https://admin.example.com/nodes/{nodeTypeId}/configure",
   *     label: "Configure in Admin Portal"
   *   },
   *   dynamicSchema: {
   *     url: "/api/nodes/{nodeTypeId}/schema",
   *     method: "GET"
   *   }
   * }
   * ```
   */
  configEdit?: ConfigEditOptions;
  /**
   * Custom extension properties for 3rd party integrations
   * Allows storing additional configuration and UI state data at the node type level
   */
  extensions?: NodeExtensions;
  /**
   * The host's confirmation policy for instances of this type, when the host
   * publishes one: whether a run pauses for a person before this node acts.
   * Surfaced to browser agents by `describe_type`; the library never reads it.
   */
  confirmation?: NodeConfirmation;
  /**
   * What the current user may do with this type, computed by the host and
   * passed through untouched. `add: false` means `add_node` will be refused
   * server-side; the tools pre-empt with `FORBIDDEN`.
   */
  can?: Record<string, boolean>;
  /**
   * Guidance the host writes for agents reading this type — usage notes,
   * example configurations, types it is usually wired to. Surfaced verbatim by
   * `describe_type`; the library never interprets it.
   */
  agent?: NodeAgentGuidance;
}

/**
 * A host's confirmation policy for a node type (see `NodeMetadata.confirmation`).
 */
export interface NodeConfirmation {
  /** `ask` — a run pauses for approval before the node acts; `skip` — it does not. */
  policy: 'ask' | 'skip';
  /** Where the policy came from: set on the type, or derived from the plugin. */
  source?: 'policy' | 'plugin' | string;
  /** Controls the instance author may exercise (e.g. `waive`, `require`). */
  authorControls?: string[];
  /** Controls a runtime input may exercise. */
  dynamicControls?: string[];
}

/** Host-written guidance for agents (see `NodeMetadata.agent`). */
export interface NodeAgentGuidance {
  usage?: string;
  examples?: string[];
  pairsWith?: string[];
}

/**
 * Common base interface for all schema properties
 */
export interface BaseProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'integer' | 'mixed' | 'float';
  description?: string;
  title?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  items?: BaseProperty;
  properties?: Record<string, BaseProperty>;
  [key: string]: unknown; // Allow additional JSON Schema properties
}

/**
 * Common base interface for all schemas
 */
export interface BaseSchema {
  type: 'object';
  properties: Record<string, BaseProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Configuration schema property with specific attributes
 */
export interface ConfigProperty extends BaseProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'integer';
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  multiple?: boolean; // For enum fields, allows multiple selection via checkboxes
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: 'multiline' | 'hidden' | string; // Special formats: multiline for textarea, hidden to hide field
  items?: ConfigProperty;
  properties?: Record<string, ConfigProperty>;
  [key: string]: unknown; // Allow additional JSON Schema properties
}

/**
 * Configuration schema interface
 */
export interface ConfigSchema extends BaseSchema {
  properties: Record<string, ConfigProperty>;
}

/**
 * Input schema property with specific attributes
 */
export interface InputProperty extends BaseProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'integer' | 'mixed';
  title?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: 'multiline' | string;
  items?: InputProperty;
  properties?: Record<string, InputProperty>;
  [key: string]: unknown;
}

/**
 * Input schema interface
 */
export interface InputSchema extends BaseSchema {
  properties: Record<string, InputProperty>;
}

/**
 * Output schema property with specific attributes
 */
export interface OutputProperty extends BaseProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'integer' | 'mixed' | 'float';
  description: string; // Required for outputs
  title?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  items?: OutputProperty;
  properties?: Record<string, OutputProperty>;
  [key: string]: unknown;
}

/**
 * Output schema interface
 */
export interface OutputSchema extends BaseSchema {
  properties: Record<string, OutputProperty>;
}

/**
 * Primitive types for template variables
 */
export type TemplateVariableType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'integer'
  | 'mixed'
  | 'float';

/**
 * Represents a variable available for template interpolation.
 * Used by the template editor for autocomplete suggestions.
 *
 * Supports hierarchical drilling:
 * - Objects have `properties` for dot notation (e.g., `user.name`)
 * - Arrays have `items` for index access (e.g., `items[0].name`)
 *
 * @example
 * ```typescript
 * const userVariable: TemplateVariable = {
 *   name: "user",
 *   label: "User Data",
 *   type: "object",
 *   properties: {
 *     name: { name: "name", type: "string", label: "User Name" },
 *     email: { name: "email", type: "string", label: "Email Address" },
 *     address: {
 *       name: "address",
 *       type: "object",
 *       label: "Address",
 *       properties: {
 *         city: { name: "city", type: "string", label: "City" },
 *         country: { name: "country", type: "string", label: "Country" }
 *       }
 *     }
 *   }
 * };
 * ```
 */
export interface TemplateVariable {
  /** Variable name (used in template as {{ name }}) */
  name: string;
  /** Display label for the variable in autocomplete dropdown */
  label?: string;
  /** Description shown in autocomplete tooltip */
  description?: string;
  /** Data type of the variable */
  type: TemplateVariableType;
  /** For objects: child properties accessible via dot notation */
  properties?: Record<string, TemplateVariable>;
  /** For arrays: schema of array items accessible via index notation */
  items?: TemplateVariable;
  /** Source port ID this variable comes from */
  sourcePort?: string;
  /** Source node ID */
  sourceNode?: string;
}

/**
 * Schema passed to template editor for autocomplete functionality.
 * Contains all available variables derived from connected upstream nodes.
 *
 * @example
 * ```typescript
 * const variableSchema: VariableSchema = {
 *   variables: {
 *     user: { name: "user", type: "object", properties: { ... } },
 *     items: { name: "items", type: "array", items: { ... } },
 *     config: { name: "config", type: "object", properties: { ... } }
 *   }
 * };
 * ```
 */
export interface VariableSchema {
  /** Map of available variables keyed by variable name */
  variables: Record<string, TemplateVariable>;
}

/**
 * Configuration for template variable autocomplete.
 * Used in template fields to control which variables are available
 * and how they are derived.
 *
 * Supports three modes:
 * 1. **Schema-only** (existing): Variables from static schema and/or upstream ports
 * 2. **API-only** (new): Variables fetched from backend endpoint
 * 3. **Hybrid** (new): Merge API variables with static schema/ports
 *
 * @example
 * ```json
 * {
 *   "type": "string",
 *   "format": "template",
 *   "variables": {
 *     "ports": ["data", "context"],
 *     "includePortName": true
 *   }
 * }
 * ```
 *
 * @example API Mode
 * ```json
 * {
 *   "type": "string",
 *   "format": "template",
 *   "variables": {
 *     "api": {
 *       "endpoint": {
 *         "url": "/api/variables/{workflowId}/{nodeId}"
 *       }
 *     }
 *   }
 * }
 * ```
 */
export interface TemplateVariablesConfig {
  /**
   * Specifies which input port IDs should provide variables for autocomplete.
   * Only connections to these ports will provide variables.
   *
   * - If not specified, all input ports with connections are used.
   * - If specified as an empty array, no variables will be derived from ports.
   */
  ports?: string[];

  /**
   * Pre-defined variable schema to use instead of (or in addition to) deriving from ports.
   * Useful for providing static variables or overriding derived ones.
   */
  schema?: VariableSchema;

  /**
   * Whether to include the port name as a prefix for variables.
   * When true, variables are named like `data.user` instead of just `user`.
   * Useful when multiple ports might have overlapping variable names.
   * @default false
   */
  includePortName?: boolean;

  /**
   * Whether to show available variables as clickable hints below the editor.
   * @default true
   */
  showHints?: boolean;

  /**
   * API mode configuration for fetching variables from backend endpoint.
   * When configured, variables will be fetched from the specified endpoint
   * and can be merged with static schema and/or port-derived variables.
   */
  api?: ApiVariablesConfig;
}

/**
 * Configuration for API-based variable fetching.
 * Enables dynamic variable suggestions from backend endpoints.
 *
 * @example
 * ```typescript
 * const apiConfig: ApiVariablesConfig = {
 *   endpoint: {
 *     url: "/api/variables/{workflowId}/{nodeId}",
 *     method: "GET"
 *   },
 *   cacheTtl: 300000,
 *   mergeWithSchema: true,
 *   fallbackOnError: true
 * };
 * ```
 */
export interface ApiVariablesConfig {
  /**
   * Endpoint configuration for fetching variable schema
   */
  endpoint: ApiVariablesEndpoint;

  /**
   * Cache TTL in milliseconds.
   * Variables are cached to prevent excessive API calls during editing.
   * @default 300000 (5 minutes)
   */
  cacheTtl?: number;

  /**
   * Whether to merge API variables with static schema.
   * When true, variables from both API and schema are combined.
   * @default true
   */
  mergeWithSchema?: boolean;

  /**
   * Whether to merge API variables with port-derived variables.
   * When true, variables from both API and ports are combined.
   * @default false
   */
  mergeWithPorts?: boolean;

  /**
   * Whether to fallback to schema/ports on API error.
   * When true, gracefully degrades to static variables if API fails.
   * When false, shows error message to user.
   * @default true
   */
  fallbackOnError?: boolean;
}

/**
 * Endpoint configuration for fetching variable schemas from backend API.
 * Supports template variables in URL (e.g., {workflowId}, {nodeId})
 * which are resolved at runtime from node context.
 *
 * @example GET Request
 * ```typescript
 * const endpoint: ApiVariablesEndpoint = {
 *   url: "/api/variables/{workflowId}/{nodeId}",
 *   method: "GET"
 * };
 * ```
 *
 * @example POST Request with Body
 * ```typescript
 * const endpoint: ApiVariablesEndpoint = {
 *   url: "/api/variables",
 *   method: "POST",
 *   body: {
 *     workflowId: "{workflowId}",
 *     nodeId: "{nodeId}"
 *   }
 * };
 * ```
 */
export interface ApiVariablesEndpoint {
  /**
   * URL to fetch variables from.
   * Supports template placeholders:
   * - `{workflowId}` - Resolved from workflow ID
   * - `{nodeId}` - Resolved from node instance ID
   *
   * @example "/api/variables/{workflowId}/{nodeId}"
   * @example "https://api.example.com/variables?workflow={workflowId}&node={nodeId}"
   */
  url: string;

  /**
   * HTTP method for the request.
   * @default "GET"
   */
  method?: HttpMethod;

  /**
   * Custom headers to include in the request.
   * Note: Authentication headers are automatically added via AuthProvider.
   */
  headers?: Record<string, string>;

  /**
   * Request body for POST/PUT/PATCH methods.
   * Supports template variables like the URL.
   */
  body?: Record<string, unknown>;

  /**
   * Request timeout in milliseconds.
   * @default 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Whether to cache the fetched schema.
   * When false, schema is fetched on every editor load.
   * @default true
   */
  cacheEnabled?: boolean;
}

/**
 * Union type for all schema types
 */
export type Schema = ConfigSchema | InputSchema | OutputSchema;

/**
 * Union type for all property types
 */
export type Property = ConfigProperty | InputProperty | OutputProperty;

/**
 * Schema type discriminator
 */
export type SchemaType = 'config' | 'input' | 'output';

/**
 * Utility type to get the appropriate property type based on schema type
 */
export type SchemaProperty<T extends SchemaType> = T extends 'config'
  ? ConfigProperty
  : T extends 'input'
    ? InputProperty
    : T extends 'output'
      ? OutputProperty
      : never;

/**
 * Utility type to get the appropriate schema type based on schema type
 */
export type SchemaTypeMap<T extends SchemaType> = T extends 'config'
  ? ConfigSchema
  : T extends 'input'
    ? InputSchema
    : T extends 'output'
      ? OutputSchema
      : never;

/**
 * Node configuration values
 *
 * Key-value pairs of user-entered configuration values based on the node's configSchema.
 * This is where all node-specific settings are stored, including:
 *
 * **Standard Properties:**
 * - Any property defined in the node's `configSchema` (e.g., model, temperature, apiKey)
 *
 * **Special Properties (Dynamic Ports):**
 * - `dynamicInputs`: Array of DynamicPort for user-defined input handles
 * - `dynamicOutputs`: Array of DynamicPort for user-defined output handles
 * - `branches`: Array of Branch for gateway node conditional output paths
 *
 * The backend uses this object to:
 * - Store and retrieve node configuration
 * - Pass configuration values to node processors during execution
 * - Persist node state across sessions
 *
 * @example
 * ```typescript
 * const config: ConfigValues = {
 *   // Standard configuration from configSchema
 *   model: "gpt-4o-mini",
 *   temperature: 0.7,
 *   maxTokens: 1000,
 *
 *   // Dynamic input ports
 *   dynamicInputs: [
 *     { name: "extra_data", label: "Extra Data", dataType: "json" }
 *   ],
 *
 *   // Gateway branches
 *   branches: [
 *     { name: "success", label: "Success", condition: "status === 200" },
 *     { name: "error", label: "Error", isDefault: true }
 *   ]
 * };
 * ```
 */
export interface ConfigValues {
  /** Dynamic input ports for user-defined input handles */
  dynamicInputs?: DynamicPort[];
  /** Dynamic output ports for user-defined output handles */
  dynamicOutputs?: DynamicPort[];
  /** Branches for gateway node conditional output paths */
  branches?: Branch[];
  /** Any other configuration properties defined in configSchema */
  [key: string]: unknown;
}

/**
 * Extended node type for workflows
 *
 * Represents a node instance in a workflow, containing position, display data,
 * configuration values, and metadata from the node type definition.
 */
export interface WorkflowNode extends Node {
  id: string;
  type: string;
  position: XYPosition;
  deletable?: boolean;
  data: {
    /** Display label for the node instance */
    label: string;
    /**
     * Node configuration values
     *
     * Contains all user-configured settings for this node instance based on the
     * node type's configSchema. This includes standard properties defined in the
     * schema as well as special dynamic port configurations.
     *
     * The backend uses this object to:
     * - Store and retrieve node configuration
     * - Pass configuration values to node processors during execution
     * - Persist node state across sessions
     *
     * @see ConfigValues for detailed documentation of available properties
     */
    config: ConfigValues;
    /** Node type metadata (inputs, outputs, configSchema, etc.) */
    metadata: NodeMetadata;
    /** Whether the node is currently processing/executing */
    isProcessing?: boolean;
    /** Error message if the node execution failed */
    error?: string;
    /** Node execution tracking information */
    executionInfo?: NodeExecutionInfo;
    /**
     * Per-instance extension properties for 3rd party integrations
     * Overrides or extends the node type extensions defined in metadata.extensions
     * Use for instance-specific UI states or custom data
     */
    extensions?: NodeExtensions;
  };
}

/**
 * Edge category types based on source port data type or target handle
 * Used for visual styling of edges on the canvas
 * - trigger: For control flow connections (dataType: "trigger")
 * - tool: Dashed amber line for tool connections (dataType: "tool")
 * - loopback: Dashed gray line for loop iteration (targets loop_back port)
 * - data: Normal gray line for all other data connections
 */
export type EdgeCategory = 'trigger' | 'tool' | 'loopback' | 'data';

/**
 * Extended edge type for workflows
 */
export interface WorkflowEdge extends Edge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: ConnectionLineType;
  selectable?: boolean;
  deletable?: boolean;
  data?: {
    label?: string;
    condition?: string;
    /** Edge metadata for API and persistence */
    metadata?: {
      /** Edge type for styling ("tool" or "data") */
      edgeType?: EdgeCategory;
      /** Data type of the source output port (e.g., "tool", "string", "number") */
      sourcePortDataType?: string;
    };
    targetNodeType?: string;
    targetCategory?: string;
  };
}

/**
 * A resolved pointer to one inner node port. Mirrors the handle-id triple in
 * `utils/handleIds.ts` without depending on its string encoding.
 */
export interface PortBinding {
  nodeId: string;
  portId: string;
}

/**
 * A single port's JSON Schema fragment as it rides a workflow's contract.
 *
 * Derived from {@link InputProperty} rather than restated, so the fragment
 * vocabulary has one definition; every key is optional because an interface
 * entry states its own annotations one level up and the server strips them
 * from the fragment on the way out.
 */
export type WorkflowInterfaceSchema = Partial<InputProperty>;

/**
 * One entry in a workflow's public contract. Owns its own identity: `id` is
 * stable and workflow-scoped, independent of whichever inner port it currently
 * binds to, so swapping or renaming a node does not silently break callers.
 *
 * On export toward a server manifest the entry's `id` maps to the manifest's
 * `name` — the server's wire identity. Renaming an `id` is therefore a breaking
 * change for callers, not a cosmetic one.
 */
export interface WorkflowInterfaceEntry {
  /** Stable public name. Unique within its direction. */
  id: string;
  /** Display label for callers and UI. Defaults to `id` when absent. */
  name?: string;
  description?: string;
  dataType: NodeDataType;
  /** Inputs only; ignored on outputs. */
  required?: boolean;
  defaultValue?: unknown;
  /**
   * Example values a caller could supply — author metadata for docs and launch
   * forms, mirroring the server manifest's `examples`. Inputs only; ignored on
   * outputs. Never validated against `schema`.
   */
  examples?: unknown[];
  /**
   * The port's JSON Schema fragment — the shape of the value, as opposed to
   * `dataType`, which is the lane it travels in. These are two vocabularies
   * that overlap on `string`/`number`/`boolean`/`array` and diverge exactly
   * where it matters: a `messages` port is an `array`, an `error` port is an
   * `object`, and a named shape is whatever its schema says.
   *
   * A single PROPERTY fragment, not an object schema — this was typed
   * `InputSchema | OutputSchema` (a whole `{properties: {...}}` object) while
   * nothing populated it, which would have been wrong the moment something
   * did. Every key is optional because the server strips what the entry
   * already states: no `title`/`description`/`examples`/`required`, and no
   * lane, since that is `dataType`.
   *
   * Absent when the bound port declares no structural contract at all.
   */
  schema?: WorkflowInterfaceSchema;
  /**
   * Inner ports this entry maps to. Every entry — input or output — must
   * resolve to exactly one binding; more than one is reported as `over-bound`.
   * (The list shape is kept so input fan-out can become additive later.) An
   * empty list is a valid *draft* state, reported as `unbound`.
   */
  bindings: PortBinding[];
  /**
   * Opaque consumer metadata. The library never reads or interprets this — it
   * round-trips verbatim. Servers use it to say what "external" means for them
   * (`{"http": {"in": "query"}}`, `{"mcp": {"toolParam": true}}`, …).
   * Keys under the `fd.` prefix are reserved for future library use.
   */
  meta?: Record<string, unknown>;
}

/** A workflow's public contract. Array order is the caller-facing order. */
export interface WorkflowInterface {
  inputs?: WorkflowInterfaceEntry[];
  outputs?: WorkflowInterfaceEntry[];
}

/**
 * Complete workflow definition
 */
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  metadata: {
    /** Workflow schema format version — identifies the document format, not the workflow's own revision. */
    schemaVersion: string;
    createdAt: string;
    updatedAt: string;
    author?: string;
    tags?: string[];
    versionId?: string;
    updateNumber?: number;
    /** Workflow format. Determines sidebar filtering and export behavior. */
    format?: WorkflowFormat;
  };
  /** Custom workflow-level configuration values, populated via workflowSettingsSchema. */
  config?: Record<string, unknown>;
  /** Public contract for callers. Absent = the workflow declares no interface. */
  interface?: WorkflowInterface;
  /**
   * What the current user may do with this workflow, computed by the host and
   * passed through untouched (`save`, `run`, …). The browser-agent tools
   * pre-empt with `FORBIDDEN` when a key is `false`; the server stays the
   * authority either way.
   */
  can?: Record<string, boolean>;
  /**
   * The revision the editor loaded, as the host stamps it. Sent back on save
   * so the server can refuse a stale write with `CONFLICT`.
   */
  revision?: string | number;
}

/**
 * API response types
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export type NodesResponse = ApiResponse<NodeMetadata[]>;
export type WorkflowResponse = ApiResponse<Workflow>;
export type WorkflowsResponse = ApiResponse<Workflow[]>;

/**
 * Node execution status enum
 */
export type NodeExecutionStatus =
  | 'idle'
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped'
  | 'paused'
  | 'interrupted';

export interface KanbanColumnDef {
  key: string;
  label: string;
  statuses: NodeExecutionStatus[];
  icon?: string;
  color?: string;
}

/** Props passed to every pipeline view component, built-in or custom. */
export interface PipelineViewProps {
  pipelineId: string | null;
  workflow: Workflow;
  endpointConfig: EndpointConfig;
  /** Auth provider for building authenticated API clients in custom views. */
  authProvider?: AuthProvider;
  refreshTrigger?: number;
}

/** A custom view injected into the PipelinePanel view switcher. */
export interface PipelineViewDef {
  /** Unique key — must not clash with built-ins: 'graph' | 'kanban' | 'table' */
  key: string;
  /** Label shown in the toggle button tooltip */
  label: string;
  /** Iconify icon name, e.g. 'mdi:chart-bar' */
  icon: string;
  /** Svelte component that receives PipelineViewProps */
  component: Component<PipelineViewProps>;
}

/**
 * One job execution of a node within a pipeline run.
 *
 * Loop-orchestrated workflows create one job per iteration for the same
 * node (labels carry an iteration suffix, e.g. "Invoke tool #2"), so a node
 * can have several of these per run.
 */
export interface NodeJobExecution {
  /** Job entity ID */
  id?: string;
  /** Job label, carries the iteration suffix (e.g. "Invoke tool #2") */
  label?: string;
  /** Job status */
  status: NodeExecutionStatus;
  /** ISO timestamp the job started, if it ran */
  started?: string;
  /** ISO timestamp the job completed, if it finished */
  completed?: string;
  /** Execution duration in milliseconds, if the job ran to completion */
  executionTime?: number;
  /** Precise execution duration in microseconds, when the backend provides it */
  executionTimeUs?: number;
  /** Error message if the job failed */
  error?: string;
}

/**
 * Node execution tracking information
 */
export interface NodeExecutionInfo {
  /** Current execution status */
  status: NodeExecutionStatus;
  /** Total number of times this node has been executed */
  executionCount: number;
  /** Last execution timestamp */
  lastExecuted?: string;
  /** Last execution duration in milliseconds */
  lastExecutionDuration?: number;
  /** Precise last execution duration in microseconds, when the backend provides it */
  lastExecutionDurationUs?: number;
  /** Last error message if execution failed */
  lastError?: string;
  /** Whether the node is currently being executed */
  isExecuting: boolean;
  /** Execution output data (e.g., active branches for gateway nodes) */
  output?: Record<string, unknown>;
  /** Per-job execution history (loop iterations), in pipeline order */
  jobs?: NodeJobExecution[];
}

/**
 * Workflow execution status
 */
export type ExecutionStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused'
  | 'interrupted';

/**
 * Workflow execution result
 */
export interface ExecutionResult {
  id: string;
  workflowId: string;
  status: ExecutionStatus;
  startTime: string;
  endTime?: string;
  results?: Record<string, unknown>;
  error?: string;
  logs?: string[];
}

/**
 * Library configuration
 */
export interface FlowDropConfig {
  endpointConfig?: EndpointConfig;
  theme?: 'light' | 'dark' | 'auto';
  enableDebug?: boolean;
  autoSave?: boolean;
  autoSaveInterval?: number;
  maxUndoSteps?: number;
  nodeSpacing?: number;
  gridSize?: number;
}

/**
 * Event types for the workflow editor
 */
export interface WorkflowEvents {
  nodeAdded: { node: WorkflowNode };
  nodeRemoved: { nodeId: string };
  nodeUpdated: { node: WorkflowNode };
  edgeAdded: { edge: WorkflowEdge };
  edgeRemoved: { edgeId: string };
  workflowSaved: { workflow: Workflow };
  workflowLoaded: { workflow: Workflow };
  executionStarted: { workflowId: string };
  executionCompleted: { result: ExecutionResult };
  executionFailed: { error: string };
}

// Re-export auth types for convenience
export type { AuthProvider, StaticAuthConfig, CallbackAuthConfig } from './auth.js';
export { StaticAuthProvider, CallbackAuthProvider, NoAuthProvider } from './auth.js';

// Re-export settings types
export type {
  FlowDropSettings,
  ThemeSettings,
  EditorSettings,
  UISettings,
  BehaviorSettings,
  ApiSettings,
  ThemePreference,
  ResolvedTheme,
  SettingsCategory,
  PartialSettings,
  SyncStatus,
  SettingsStoreState,
  SettingsChangeEvent,
  SettingsChangeCallback
} from './settings.js';
export {
  DEFAULT_SETTINGS,
  DEFAULT_THEME_SETTINGS,
  DEFAULT_EDITOR_SETTINGS,
  DEFAULT_UI_SETTINGS,
  DEFAULT_BEHAVIOR_SETTINGS,
  DEFAULT_API_SETTINGS,
  SETTINGS_CATEGORIES,
  SETTINGS_CATEGORY_LABELS,
  SETTINGS_CATEGORY_ICONS,
  SETTINGS_STORAGE_KEY
} from './settings.js';

// UISchema types for form layout control
export type {
  UISchemaElementType,
  UISchemaElementBase,
  UISchemaControl,
  UISchemaVerticalLayout,
  UISchemaGroup,
  UISchemaElement
} from './uischema.js';

export { isUISchemaControl, isUISchemaVerticalLayout, isUISchemaGroup } from './uischema.js';
