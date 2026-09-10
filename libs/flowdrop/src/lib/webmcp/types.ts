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
import type { FlowDropInstance } from '../stores/instanceContainer.svelte.js';
import type { ApprovalGate } from './gate.js';
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
// Host hooks — the envelope (D6 of the agent-authoring plan)
// ============================================================================

/**
 * Stable codes a host hook (`onSave`, `onRun`, `onRunStatus`) may answer with.
 * They align with fddo's API-8 `error_code` vocabulary where the two meet
 * (`CONFLICT`, `NOT_FOUND`); the rest name what a browser agent must do next.
 *
 * - `FORBIDDEN` — the server refused; the agent should tell the user.
 * - `UNAVAILABLE` — nothing to act on yet (unsaved workflow, no runtime).
 * - `NEEDS_APPROVAL` — a person must approve in the UI first.
 * - `INVALID` — the workflow failed validation; `message` says where.
 * - `CONFLICT` — the server copy changed since it was loaded; reload.
 * - `PENDING` — a run is paused for a person (never for the agent, D8).
 * - `NOT_FOUND` — the run id is unknown.
 */
export type HostCode =
  | 'FORBIDDEN'
  | 'UNAVAILABLE'
  | 'NEEDS_APPROVAL'
  | 'INVALID'
  | 'CONFLICT'
  | 'PENDING'
  | 'NOT_FOUND'
  | (string & Record<never, never>);

/**
 * What every host hook returns. `ok: false` needs a `code`; `ok: true` may
 * still carry one (`PENDING`). `can` lets a host refresh what the user may do
 * after the call — passed through to the agent untouched.
 */
export interface HostEnvelope<T = unknown> {
  ok: boolean;
  code?: HostCode;
  message?: string;
  data?: T;
  can?: Record<string, boolean>;
}

/** What `onRun` reports back once a run is accepted. */
export interface RunStarted {
  /** The id `run_status` polls with. */
  runId: string;
  status?: string;
  queued?: boolean;
}

/** The person-facing pause a paused run is waiting on (D8: no tool answers it). */
export interface RunPending {
  interruptId?: string;
  type?: string;
  nodeId?: string;
  message?: string;
}

/** What `onRunStatus` reports. `status` vocabulary is the host's; `paused` is special-cased. */
export interface RunStatus {
  runId: string;
  status:
    | 'pending'
    | 'running'
    | 'paused'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | (string & Record<never, never>);
  startedAt?: string | null;
  finishedAt?: string | null;
  /** Set when `status` is `paused` and a person must act. */
  pending?: RunPending | null;
  /** Why an execution budget paused the run, when it did. */
  pausedReason?: string | null;
  /** The run's output once it has one. Host-shaped. */
  outputs?: unknown;
  /** Per-node status once the host has it. Host-shaped. */
  nodeStatuses?: unknown;
  error?: string;
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
   *
   * May resolve to nothing (saved) or to a {@link HostEnvelope} — e.g.
   * `{ok: false, code: 'CONFLICT'}` when the server copy moved on. A thrown
   * error is reported as `SAVE_FAILED`, except an error whose `errorData.error_code`
   * or `status` says conflict, which is relayed as `CONFLICT`.
   */
  onSave?: () => Promise<void | HostEnvelope>;
  /**
   * Start a run of the workflow being edited, with optional inputs for its
   * interface ports. When supplied, a `run` tool is registered — gated like
   * `save`, and flagged consequential — and `run_status` too when
   * {@link onRunStatus} is also given. The hook answers with an envelope; the
   * tool relays it. `data.runId` is what `run_status` polls with.
   */
  onRun?: (inputs: Record<string, unknown>) => Promise<HostEnvelope<RunStarted>>;
  /**
   * Report a run's status. A read: never gated. `status: 'paused'` is relayed
   * as `code: 'PENDING'` with `pending.nodeId` / `pending.message` — the agent
   * tells the person, and the person acts in the UI (D8).
   */
  onRunStatus?: (runId: string) => Promise<HostEnvelope<RunStatus>>;
  /**
   * Offer "don't ask again for edits in this session" in the confirm dialog.
   * Ticked, later *edits* run without the dialog until the adapter detaches;
   * `save` and `run` always ask. Default true. Irrelevant unless `approval`
   * is `'confirm'`.
   */
  rememberEdits?: boolean;
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

// ============================================================================
// Tool runtime — shared by the registration and the chat panel
// ============================================================================

/** The host hooks behind the `save`, `run` and `run_status` tools. */
export type HostHooks = Pick<WebMCPOptions, 'onSave' | 'onRun' | 'onRunStatus'>;

/**
 * One host tool (`save`, `run`, `run_status`) as the runtime offers it. Like a
 * {@link ToolDescriptor} but without `toCommands`: these tools run a hook,
 * not commands.
 */
export interface HostToolDescriptor {
  verb: 'save' | 'run' | 'run_status';
  description: string;
  inputSchema: ToolInputSchema;
  readOnly: boolean;
  /** Never covered by "don't ask again for edits"; always asks. */
  consequential: boolean;
}

/**
 * What a tool call would do, before it runs — for a transcript or a dialog.
 * Computed the way `runTool` will act: the layout opt-out is already applied
 * and `asks` reflects the gate's current state, so a caller announcing the
 * call announces what actually happens.
 */
export interface ToolPreview {
  /** The commands the call will run; empty for a host tool. */
  commands: Command[];
  /** Layout commands the opt-out will skip (`chatAllowLayoutChanges` off). */
  skipped: Command[];
  /** True when the call passes through the approval gate. */
  mutating: boolean;
  /** True for `save` and `run`. */
  consequential: boolean;
  /**
   * True when the call will wait on the gate's decision — a mutating call
   * the person has not pre-approved, or a consequential one — under a policy
   * that asks at all (`approval: 'auto'` never does).
   */
  asks: boolean;
}

export interface ToolRuntimeOptions {
  instance: FlowDropInstance;
  /** See {@link WebMCPOptions.nodeTypes}. Defaults to the instance's list. */
  nodeTypes?: NodeMetadata[] | (() => NodeMetadata[]);
  /** See {@link WebMCPOptions.onUIAction}. Without it there is no `view` tool. */
  onUIAction?: (action: UIAction) => void;
  /** Host hooks; each present hook adds its tool. */
  hooks?: HostHooks;
  /**
   * An existing gate to ask, e.g. the registration's. When omitted the
   * runtime creates one from `approval`, `container`, `messages` and
   * `rememberEdits` and disposes it with itself.
   */
  gate?: ApprovalGate;
  approval?: WebMCPApproval;
  container?: HTMLElement;
  messages?: MessagesOverride | (() => MessagesOverride);
  rememberEdits?: boolean;
  /**
   * The approval dialog's title for this runtime's calls, given the editor
   * name — who is asking. Defaults to the gate's WebMCP wording. Lets two
   * runtimes share one gate and still say which surface wants the change.
   */
  dialogTitle?: (editorName: string) => string;
}

/**
 * The tool runtime: every editor tool and host tool of one editor instance
 * behind a single `runTool(name, input)`. Built by `createToolRuntime`.
 */
export interface ToolRuntime {
  /** Editor tools (commands), in registration order. */
  readonly descriptors: readonly ToolDescriptor[];
  /** Host tools present for the supplied hooks, in registration order. */
  readonly hostTools: readonly HostToolDescriptor[];
  /** The gate mutating calls pass through. */
  readonly gate: ApprovalGate;
  /**
   * Run a tool by its bare verb (`add_node`, `batch`, `save`, …): validate,
   * map, gate, execute. Never throws for a bad call — argument errors, a
   * rejected dialog, an unknown name all come back as an `isError` result the
   * model can read. Throws only for a bug.
   */
  runTool(name: string, input: unknown): Promise<ToolResult>;
  /**
   * What `runTool(name, input)` would do, without doing it. `null` for an
   * unknown tool or arguments the schema refuses.
   */
  preview(name: string, input: unknown): ToolPreview | null;
  /** True after `dispose()`; every later call answers `DETACHED`. */
  readonly disposed: boolean;
  /** Dismiss any open dialog (as a rejection) and refuse further calls. */
  dispose(): void;
}

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
