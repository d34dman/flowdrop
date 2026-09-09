/**
 * WebMCP adapter — registration.
 *
 * The only file that touches the runtime (`document.modelContext`, falling
 * back to `navigator.modelContext`). Builds the descriptors, wraps each in an
 * `execute` that validates → maps to commands → gates → runs one
 * `executeBatch` transaction, and registers the lot under one AbortSignal so
 * detaching is a single `abort()`.
 *
 * @module webmcp/register
 */

import type { FlowDropInstance } from '../stores/instanceContainer.svelte.js';
import type { NodeMetadata } from '../types/index.js';
import type { Command, CommandResult } from '../commands/types.js';
import { executeBatch } from '../commands/batch.js';
import { createStoreCommandContext } from '../commands/storeIntegration.svelte.js';
import { isLayoutCommand, isMutatingCommand, isViewCommand } from '../chat/commandClassifier.js';
import { getBehaviorSettings } from '../stores/settingsStore.svelte.js';
import { logger } from '../utils/logger.js';
import { buildToolDescriptors } from './descriptors.js';
import { validateToolArgs } from './validate.js';
import { createApprovalGate, GateBusyError } from './gate.js';
import {
  ToolArgumentError,
  type HostEnvelope,
  type ModelContextLike,
  type RegisteredToolDefinition,
  type RunStatus,
  type ToolDescriptor,
  type ToolInputSchema,
  type ToolResult,
  type WebMCPHandle,
  type WebMCPOptions
} from './types.js';

export const DEFAULT_PREFIX = 'flowdrop';

/** Wording shared with the chat panel's CommandPreview (issue #36). */
const LAYOUT_SKIPPED = 'Skipped — AI layout changes are disabled in Settings';

// ============================================================================
// Runtime detection
// ============================================================================

/**
 * Find the WebMCP runtime on this page, or `null` when the browser has none.
 * Structural: anything with a callable `registerTool` counts.
 */
export function detectModelContext(): ModelContextLike | null {
  if (typeof document === 'undefined') return null;
  const candidates: unknown[] = [
    (document as unknown as { modelContext?: unknown }).modelContext,
    typeof navigator !== 'undefined'
      ? (navigator as unknown as { modelContext?: unknown }).modelContext
      : undefined
  ];
  for (const c of candidates) {
    if (c && typeof (c as ModelContextLike).registerTool === 'function') {
      return c as ModelContextLike;
    }
  }
  return null;
}

// ============================================================================
// Prefix registry (D2) — one registration per prefix per runtime
// ============================================================================

const claimedPrefixes = new WeakMap<object, Set<string>>();

function claimPrefix(runtime: object, prefix: string): void {
  let set = claimedPrefixes.get(runtime);
  if (!set) {
    set = new Set();
    claimedPrefixes.set(runtime, set);
  }
  if (set.has(prefix)) {
    throw new Error(
      `[flowdrop] WebMCP tools with prefix "${prefix}" are already registered on this page. ` +
        `Pass a distinct \`prefix\` for each editor instance.`
    );
  }
  set.add(prefix);
}

function releasePrefix(runtime: object, prefix: string): void {
  claimedPrefixes.get(runtime)?.delete(prefix);
}

// ============================================================================
// Result formatting
// ============================================================================

function text(payload: unknown, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {})
  };
}

function errorResult(
  code: string,
  message: string,
  extra: Record<string, unknown> = {}
): ToolResult {
  return text({ ok: false, code, error: message, ...extra }, true);
}

/**
 * A host envelope as a tool result. `ok: false` is an error result with the
 * host's code; `ok: true` keeps `code` (e.g. `PENDING`) and passes `data` and
 * `can` through untouched — the agent reads them, the adapter never does.
 */
function envelopeResult(envelope: HostEnvelope, fallbackMessage: string): ToolResult {
  const message = envelope.message ?? fallbackMessage;
  if (!envelope.ok) {
    return errorResult(envelope.code ?? 'FAILED', message, {
      ...(envelope.data !== undefined ? { data: envelope.data } : {}),
      ...(envelope.can ? { can: envelope.can } : {})
    });
  }
  return text({
    ok: true,
    ...(envelope.code ? { code: envelope.code } : {}),
    message,
    ...(envelope.data !== undefined ? { data: envelope.data } : {}),
    ...(envelope.can ? { can: envelope.can } : {})
  });
}

/**
 * Whether a thrown save error is the server saying the copy moved on. The
 * library's `ApiError` carries the parsed body as `errorData` (fddo publishes
 * `error_code: 'CONFLICT'` with a 409); a bare 409 counts too.
 */
function isConflictError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: unknown; errorData?: { error_code?: unknown } };
  return e.errorData?.error_code === 'CONFLICT' || e.status === 409;
}

function stripResult(result: CommandResult): Record<string, unknown> {
  if (result.ok) {
    const out: Record<string, unknown> = { ok: true, message: result.message };
    if (result.data !== undefined) out.data = result.data;
    if (result.uiActionPending) out.uiActionPending = true;
    return out;
  }
  return { ok: false, code: result.code, error: result.error };
}

/**
 * The gate exists because any agent on the page can alter the user's
 * document. A command that only moves the view — selection, a panel, the
 * viewport — alters nothing the user would need to undo, so it runs unasked;
 * `undo` and `redo` change the document and stay gated. A batch is gated as a
 * whole when any of its items is.
 */
function needsApproval(commands: Command[]): boolean {
  return commands.some((c) => isMutatingCommand(c.type) && !isViewCommand(c.type));
}

// ============================================================================
// attach
// ============================================================================

/**
 * Register the editor's commands as WebMCP tools for `instance`.
 *
 * Returns `null` — with no console output — when the page has no WebMCP
 * runtime, so hosts can call it unconditionally. Throws when the prefix is
 * already registered on this runtime (two editors on one page need distinct
 * prefixes).
 *
 * Registration settles asynchronously: `handle.tools` lists the tools the
 * runtime has accepted so far and `handle.ready` resolves when every
 * registration has settled. The registration is torn down by
 * `handle.detach()` or automatically when `instance.destroy()` runs.
 */
export function attachWebMCP(
  instance: FlowDropInstance,
  options: WebMCPOptions = {}
): WebMCPHandle | null {
  const detected = options.modelContext ?? detectModelContext();
  if (!detected) return null;
  const runtime: ModelContextLike = detected;

  const prefix = options.prefix ?? DEFAULT_PREFIX;
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix)) {
    throw new Error(`[flowdrop] Invalid WebMCP prefix "${prefix}"`);
  }
  claimPrefix(runtime, prefix);

  const nodeTypes = (): NodeMetadata[] => {
    const source = options.nodeTypes;
    if (source === undefined) return instance.nodeTypes.current;
    return typeof source === 'function' ? source() : source;
  };

  const editorName = (): string => instance.workflow.current?.name ?? instance.id;

  const gate = createApprovalGate(options.approval ?? 'confirm', {
    container: options.container,
    editorName,
    messages: options.messages,
    rememberEdits: options.rememberEdits
  });

  const controller = new AbortController();
  const descriptors = buildToolDescriptors({ view: Boolean(options.onUIAction) });
  const names: string[] = [];
  let attached = true;

  // ---- execute ------------------------------------------------------------

  async function run(descriptor: ToolDescriptor, input: unknown): Promise<ToolResult> {
    if (!attached) return errorResult('DETACHED', 'This editor is no longer available');

    let commands: Command[];
    try {
      commands = descriptor.toCommands(validateToolArgs(descriptor.inputSchema, input));
    } catch (err) {
      if (err instanceof ToolArgumentError) return errorResult('INVALID_ARGUMENTS', err.message);
      throw err;
    }

    // D4: honour the layout opt-out with the chat panel's wording. A skip is
    // not a failure; the rest of a batch still applies.
    const skipped: Command[] = [];
    if (!getBehaviorSettings().chatAllowLayoutChanges) {
      commands = commands.filter((c) => {
        if (isLayoutCommand(c.type)) {
          skipped.push(c);
          return false;
        }
        return true;
      });
    }
    if (commands.length === 0) {
      return text({
        ok: true,
        results: [],
        skipped: skipped.map((c) => ({ type: c.type, reason: LAYOUT_SKIPPED })),
        completedCount: 0,
        totalCount: 0
      });
    }

    const context = createStoreCommandContext(nodeTypes(), options.onUIAction, instance);
    if (!context) return errorResult('NO_WORKFLOW', 'No workflow is loaded in this editor');

    // D3: reads and view changes run; document changes wait for the gate.
    if (needsApproval(commands)) {
      let approved: boolean;
      try {
        approved = await gate.request(commands, { tool: descriptor.verb });
      } catch (err) {
        if (err instanceof GateBusyError) return errorResult('BUSY', err.message);
        throw err;
      }
      if (!approved) return errorResult('REJECTED', 'The user rejected the change');
      if (!attached) return errorResult('DETACHED', 'This editor is no longer available');
    }

    // Every call is one transaction and one undo step, like the chat panel.
    const batch = executeBatch(commands, context);

    if (commands.length === 1 && descriptor.verb !== 'batch' && skipped.length === 0) {
      const only = batch.results[0];
      return text(stripResult(only), !only.ok);
    }
    return text(
      {
        ok: batch.ok,
        results: batch.results.map(stripResult),
        ...(skipped.length > 0
          ? { skipped: skipped.map((c) => ({ type: c.type, reason: LAYOUT_SKIPPED })) }
          : {}),
        completedCount: batch.completedCount,
        totalCount: batch.totalCount,
        ...(batch.ok ? {} : { error: batch.error, rolledBack: true })
      },
      !batch.ok
    );
  }

  // ---- host tools: save, run, run_status --------------------------------

  const EMPTY_SCHEMA: ToolInputSchema = {
    type: 'object',
    properties: {},
    additionalProperties: false
  };

  const RUN_SCHEMA: ToolInputSchema = {
    type: 'object',
    properties: {
      inputs: {
        type: 'object',
        description:
          "Values for the workflow's interface input ports, keyed by port name. Omit for a workflow with no inputs."
      }
    },
    additionalProperties: false
  };

  const RUN_STATUS_SCHEMA: ToolInputSchema = {
    type: 'object',
    properties: {
      runId: { type: 'string', description: 'The `runId` returned by run.' }
    },
    required: ['runId'],
    additionalProperties: false
  };

  /**
   * The host's word on what the user may do with the workflow, when the
   * payload it loaded carried one. `undefined` means the host said nothing —
   * proceed and let the server decide (D3: the server is the authority; the
   * client only pre-empts).
   */
  function workflowCan(key: string): boolean | undefined {
    return instance.workflow.current?.can?.[key];
  }

  function validateOrError(
    schema: ToolInputSchema,
    input: unknown
  ): Record<string, unknown> | ToolResult {
    try {
      return validateToolArgs(schema, input);
    } catch (err) {
      if (err instanceof ToolArgumentError) return errorResult('INVALID_ARGUMENTS', err.message);
      throw err;
    }
  }

  const isToolResult = (v: unknown): v is ToolResult =>
    typeof v === 'object' && v !== null && 'content' in (v as Record<string, unknown>);

  /** The gate, for a host tool with no commands of its own. */
  async function askHostGate(tool: 'save' | 'run'): Promise<ToolResult | null> {
    let approved: boolean;
    try {
      approved = await gate.request([], { tool });
    } catch (err) {
      if (err instanceof GateBusyError) return errorResult('BUSY', err.message);
      throw err;
    }
    if (!approved) return errorResult('REJECTED', 'The user rejected the change');
    if (!attached) return errorResult('DETACHED', 'This editor is no longer available');
    return null;
  }

  /**
   * `save` persists the workflow via the host's `onSave`. It has no commands
   * of its own — nothing for `executeBatch` to run — so it is gated directly
   * rather than going through `run()`'s command pipeline.
   */
  async function runSave(input: unknown): Promise<ToolResult> {
    if (!attached) return errorResult('DETACHED', 'This editor is no longer available');
    const args = validateOrError(EMPTY_SCHEMA, input);
    if (isToolResult(args)) return args;

    if (!instance.workflow.current) {
      return errorResult('NO_WORKFLOW', 'No workflow is loaded in this editor');
    }
    if (workflowCan('save') === false) {
      return errorResult('FORBIDDEN', 'Saving this workflow is not permitted');
    }

    const refused = await askHostGate('save');
    if (refused) return refused;

    let envelope: void | HostEnvelope;
    try {
      // Non-null: runSave is only wired up as a tool when options.onSave is set.
      envelope = await options.onSave!();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return isConflictError(err)
        ? errorResult(
            'CONFLICT',
            `${message}. The workflow changed on the server since it was loaded; reload the page before saving.`
          )
        : errorResult('SAVE_FAILED', message);
    }
    if (envelope) return envelopeResult(envelope, 'Workflow saved');
    return text({ ok: true, message: 'Workflow saved' });
  }

  /** `run` starts a run through the host's `onRun`; gated like `save`. */
  async function runRun(input: unknown): Promise<ToolResult> {
    if (!attached) return errorResult('DETACHED', 'This editor is no longer available');
    const args = validateOrError(RUN_SCHEMA, input);
    if (isToolResult(args)) return args;

    if (!instance.workflow.current) {
      return errorResult('NO_WORKFLOW', 'No workflow is loaded in this editor');
    }
    if (workflowCan('run') === false) {
      return errorResult('FORBIDDEN', 'Running this workflow is not permitted');
    }

    const refused = await askHostGate('run');
    if (refused) return refused;

    let envelope: HostEnvelope;
    try {
      envelope = await options.onRun!((args.inputs as Record<string, unknown> | undefined) ?? {});
    } catch (err) {
      return errorResult('RUN_FAILED', err instanceof Error ? err.message : String(err));
    }
    return envelopeResult(envelope, 'Run started');
  }

  /**
   * `run_status` is a read: never gated. A paused run comes back `ok` with
   * `code: 'PENDING'` and the pause's node and message — a person must act in
   * the UI; no tool answers an interrupt (D8).
   */
  async function runRunStatus(input: unknown): Promise<ToolResult> {
    if (!attached) return errorResult('DETACHED', 'This editor is no longer available');
    const args = validateOrError(RUN_STATUS_SCHEMA, input);
    if (isToolResult(args)) return args;

    let envelope: HostEnvelope<RunStatus>;
    try {
      envelope = await options.onRunStatus!(args.runId as string);
    } catch (err) {
      return errorResult('STATUS_FAILED', err instanceof Error ? err.message : String(err));
    }
    if (envelope.ok && envelope.data?.status === 'paused' && !envelope.code) {
      const p = envelope.data.pending;
      const where = p?.nodeId ? ` at node ${p.nodeId}` : '';
      const why = p?.message
        ? `: ${p.message}`
        : envelope.data.pausedReason
          ? ` (${envelope.data.pausedReason})`
          : '';
      return envelopeResult(
        {
          ...envelope,
          code: 'PENDING',
          message:
            envelope.message ??
            `Run ${envelope.data.runId} is paused${where}${why}. A person must act in the editor; tell the user and poll run_status again.`
        },
        'Run paused'
      );
    }
    return envelopeResult(
      envelope,
      envelope.data ? `Run ${envelope.data.runId}: ${envelope.data.status}` : 'Run status'
    );
  }

  // ---- register -----------------------------------------------------------

  const nameSuffix = ` Editor: "${editorName()}".`;

  async function registerRaw(tool: RegisteredToolDefinition): Promise<void> {
    try {
      // The spec returns a promise that rejects when the runtime refuses the
      // tool; pre-spec runtimes return nothing, which `await` takes as accepted.
      await runtime.registerTool(tool, { signal: controller.signal });
    } catch (err) {
      logger.warn(
        `WebMCP: the runtime refused tool "${tool.name}":`,
        err instanceof Error ? err.message : err
      );
      return;
    }
    if (attached) names.push(tool.name);
  }

  function register(descriptor: ToolDescriptor): Promise<void> {
    return registerRaw({
      name: `${prefix}_${descriptor.verb}`,
      description: descriptor.description + nameSuffix,
      inputSchema: descriptor.inputSchema,
      annotations: { readOnlyHint: descriptor.readOnly },
      execute: (input) => run(descriptor, input)
    });
  }

  const toolRegistrations = descriptors.map(register);
  if (options.onSave) {
    toolRegistrations.push(
      registerRaw({
        name: `${prefix}_save`,
        description:
          'Save the workflow to the server. Nothing an agent changes is persisted until ' +
          'this runs or the person clicks Save. Asks for approval; cannot be undone from ' +
          'the editor. Fails with FORBIDDEN when the user may not save, CONFLICT when the ' +
          'server copy changed since it was loaded (reload the page), INVALID when the ' +
          'server rejected the workflow — the message says which node or port.' +
          nameSuffix,
        inputSchema: EMPTY_SCHEMA,
        annotations: { readOnlyHint: false, consequentialHint: true },
        execute: (input) => runSave(input)
      })
    );
  }
  if (options.onRun) {
    toolRegistrations.push(
      registerRaw({
        name: `${prefix}_run`,
        description:
          'Run the saved workflow on the server with optional inputs for its interface ports. ' +
          'Save first: unsaved changes are not part of the run. Asks for approval. Returns a ' +
          '`runId`' +
          (options.onRunStatus ? ' to poll with run_status.' : '.') +
          ' Fails with FORBIDDEN when the user may not run, UNAVAILABLE when the workflow is not saved yet, ' +
          'INVALID when the server rejected the workflow.' +
          nameSuffix,
        inputSchema: RUN_SCHEMA,
        annotations: { readOnlyHint: false, consequentialHint: true },
        execute: (input) => runRun(input)
      })
    );
    if (options.onRunStatus) {
      toolRegistrations.push(
        registerRaw({
          name: `${prefix}_run_status`,
          description:
            'Report the status of a run started with run: pending, running, paused, completed, failed or cancelled, ' +
            'with outputs once it completed. A paused run answers code PENDING with the node and message it waits on — ' +
            'a person must act in the editor; tell the user, then poll again. Read-only.' +
            nameSuffix,
          inputSchema: RUN_STATUS_SCHEMA,
          annotations: { readOnlyHint: true },
          execute: (input) => runRunStatus(input)
        })
      );
    }
  }

  const ready = Promise.all(toolRegistrations).then(() => undefined);

  // ---- detach -------------------------------------------------------------

  function detach(): void {
    if (!attached) return;
    attached = false;
    unsubscribeDestroy();
    gate.dispose();
    controller.abort();
    if (typeof runtime.unregisterTool === 'function') {
      for (const name of names) {
        try {
          runtime.unregisterTool(name);
        } catch {
          // Pre-spec runtime quirks are not ours to surface.
        }
      }
    }
    releasePrefix(runtime, prefix);
  }

  // Detach when the instance goes away.
  const unsubscribeDestroy = instance.onDestroy(detach);

  return {
    get tools() {
      return names;
    },
    ready,
    get attached() {
      return attached;
    },
    detach
  };
}
