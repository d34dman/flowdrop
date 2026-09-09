/**
 * WebMCP adapter — types.
 *
 * The editor's typed command union (`commands/types.ts`) exposed as WebMCP
 * "editor tools" that a browser-resident agent can discover and call. These
 * are tools *for editing a workflow in the browser*; they are unrelated to the
 * tools a running workflow hands to an LLM node.
 *
 * Spec pinned 2026-09-02 (webmachinelearning/webmcp): `document.modelContext`
 * with `registerTool(tool, { signal, exposedTo })`, `execute(input, { signal })`
 * returning a promise, `annotations.readOnlyHint`, and a `toolchange` event.
 * The adapter feature-detects against {@link ModelContextLike} — the minimal
 * structural shape it needs — and pins nothing else.
 *
 * @module webmcp/types
 */

import type { Command, UIAction } from '../commands/types.js';
import type { NodeMetadata } from '../types/index.js';
import type { MessagesOverride } from '../messages/types.js';

// ============================================================================
// JSON Schema (the subset the descriptors use)
// ============================================================================

/** One property of a tool's input schema. */
export interface ToolSchemaProperty {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: readonly string[];
  properties?: Record<string, ToolSchemaProperty>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: ToolSchemaProperty;
  /** `value` in `set_config` accepts several primitive shapes. */
  anyOf?: readonly ToolSchemaProperty[];
  minimum?: number;
  maximum?: number;
}

/** A tool's input schema: always an object with `additionalProperties: false`. */
export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, ToolSchemaProperty>;
  required?: readonly string[];
  additionalProperties: false;
}

// ============================================================================
// Descriptors (transport-free)
// ============================================================================

/**
 * One editor tool, before registration. Pure data plus a pure mapping from
 * validated arguments to the commands it runs — no DOM, no Svelte, so the same
 * records can back a server-side MCP transport later.
 */
export interface ToolDescriptor {
  /** Verb part of the tool name; registered as `${prefix}_${verb}`. */
  verb: string;
  description: string;
  inputSchema: ToolInputSchema;
  /** True when every command the tool can produce is read-only. */
  readOnly: boolean;
  /**
   * Map already-validated arguments to the commands to execute. Throws a
   * {@link ToolArgumentError} for anything the schema validator cannot express.
   */
  toCommands(args: Record<string, unknown>): Command[];
}

/** Thrown by {@link ToolDescriptor.toCommands} and the argument validator. */
export class ToolArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolArgumentError';
  }
}

// ============================================================================
// WebMCP runtime (structural)
// ============================================================================

/** What `execute` receives from the runtime. */
export interface ToolExecuteOptions {
  signal?: AbortSignal;
}

/** The result shape we return: MCP-style content blocks with JSON in `text`. */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  /** Mirrors MCP: set when the call failed. */
  isError?: boolean;
}

/** A tool as handed to `registerTool`. */
export interface RegisteredToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
    /**
     * Spec added 2026-09-03: "executing the tool will result in consequential
     * actions that are significant, real-world, or non-reversible."
     */
    consequentialHint?: boolean;
  };
  execute(input: unknown, options?: ToolExecuteOptions): Promise<ToolResult>;
}

/** Options accepted by `registerTool`. Only `signal` is ever passed. */
export interface RegisterToolOptions {
  signal?: AbortSignal;
  exposedTo?: string[];
}

/**
 * The minimal structural type the adapter feature-detects against.
 * `document.modelContext` (spec) and the earlier `navigator.modelContext`
 * both satisfy it; so does the fake used in tests.
 */
export interface ModelContextLike {
  registerTool(tool: RegisteredToolDefinition, options?: RegisterToolOptions): unknown;
  /** Pre-spec runtimes only; called when present, never relied upon. */
  unregisterTool?(name: string): unknown;
}

// ============================================================================
// Options and handle
// ============================================================================

/** Context passed to a custom {@link WebMCPApproval} callback alongside the commands. */
export interface WebMCPApprovalRequest {
  /** The tool being called, without prefix: `add_node`, `batch`, `save`, … */
  tool: string;
}

/**
 * Approval policy for mutating tools.
 *
 * - `'confirm'` (default): a confirm dialog rendered inside the page.
 * - `'auto'`: run without asking. Only for hosts that already trust every
 *   agent on the page (kiosks, tests).
 * - A callback receiving the commands about to run and the request they came
 *   from; resolve `true` to run. For `save`, `commands` is empty and
 *   `request.tool === 'save'` — there is no command to describe, only the
 *   act of persisting.
 */
export type WebMCPApproval =
  | 'confirm'
  | 'auto'
  | ((commands: Command[], request: WebMCPApprovalRequest) => Promise<boolean>);

export interface WebMCPOptions {
  /**
   * Node type definitions the tools resolve `add_node` and `list_types`
   * against, as an array or a getter that returns the current list. Defaults
   * to the instance's own list (`instance.nodeTypes`), which the editor fills
   * as its fetch lands — pass this only when the host knows better.
   */
  nodeTypes?: NodeMetadata[] | (() => NodeMetadata[]);
  /** Tool name prefix. Default `flowdrop`. Must be unique per document. */
  prefix?: string;
  /** Approval policy for mutating tools. Default `'confirm'`. */
  approval?: WebMCPApproval;
  /**
   * Handler for `view` actions (select node, open config, canvas viewport).
   * When omitted the `view` tool is not registered at all — there is nothing
   * it could do.
   */
  onUIAction?: (action: UIAction) => void;
  /**
   * Persist the workflow (the editor's Save). When supplied, a `save` tool
   * is registered; it is gated like a change because a save cannot be
   * undone from the editor. When omitted the tool is not registered —
   * there is nothing it could do.
   */
  onSave?: () => Promise<void>;
  /** Where the built-in confirm dialog mounts. Default `document.body`. */
  container?: HTMLElement;
  /**
   * Strings for the built-in confirm dialog, in the shape of the library's
   * `messages` prop: a partial override of the defaults, or a getter for one
   * when an i18n library drives the locale. English when omitted.
   */
  messages?: MessagesOverride | (() => MessagesOverride);
  /**
   * Runtime override. Default: `document.modelContext`, then
   * `navigator.modelContext`. Tests pass a fake here.
   */
  modelContext?: ModelContextLike;
}

/**
 * The `webmcp` mount option of `mountFlowDropApp`. Node types default to the
 * mount's `nodes` option or the ones the editor fetches; there is no UI-action
 * handler on this path, so the `view` tool is not registered.
 */
export type WebMCPMountOptions = Omit<
  WebMCPOptions,
  'nodeTypes' | 'onUIAction' | 'modelContext'
> & {
  nodeTypes?: WebMCPOptions['nodeTypes'];
};

/** Returned by `attachWebMCP`. */
export interface WebMCPHandle {
  /**
   * Fully qualified names of the tools the runtime accepted. Registration is
   * asynchronous in the spec, so this fills in as registrations settle; a
   * tool the runtime refused is warned about once and never listed. Await
   * {@link ready} for the final list.
   */
  readonly tools: readonly string[];
  /** Resolves once every registration has settled — accepted or refused. */
  readonly ready: Promise<void>;
  /** False after `detach()` (or after the instance was destroyed). */
  readonly attached: boolean;
  /** Abort the registration, remove the tools, free the prefix. Idempotent. */
  detach(): void;
}
