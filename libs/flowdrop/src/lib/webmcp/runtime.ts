/**
 * WebMCP adapter — the tool runtime.
 *
 * One place that turns a tool name and its arguments into an effect on the
 * editor: validate → map to commands → honour the layout opt-out → ask the
 * gate → run one `executeBatch` transaction → strip the result. The three
 * host tools (`save`, `run`, `run_status`) live here too, behind the hooks
 * the host supplied.
 *
 * Two callers share it. The WebMCP registration (`register.ts`) wraps
 * `runTool` in each tool's `execute`; the chat panel's turn driver calls it
 * for the tool calls the assistant makes. Both therefore go through the same
 * validation, the same consent dialog, the same teaching errors and the same
 * undo step — the point of the shared runtime is that there is no second,
 * weaker path to the user's document.
 *
 * @module webmcp/runtime
 */

import type { NodeMetadata } from '../types/index.js';
import type { Command, CommandResult, UIAction } from '../commands/types.js';
import { executeBatch } from '../commands/batch.js';
import { createStoreCommandContext } from '../commands/storeIntegration.svelte.js';
import { isLayoutCommand, isMutatingCommand, isViewCommand } from '../chat/commandClassifier.js';
import { getBehaviorSettings } from '../stores/settingsStore.svelte.js';
import { errorDetails } from '../api/enhanced-client.js';
import { buildToolDescriptors } from './descriptors.js';
import { validateToolArgs } from './validate.js';
import { createApprovalGate, GateBusyError, type ApprovalGate } from './gate.js';
import {
  ToolArgumentError,
  type HostEnvelope,
  type HostHooks,
  type HostToolDescriptor,
  type RunStatus,
  type ToolDescriptor,
  type ToolInputSchema,
  type ToolPreview,
  type ToolResult,
  type ToolRuntime,
  type ToolRuntimeOptions
} from './types.js';

/** Wording shared with the chat panel's CommandPreview (issue #36). */
const LAYOUT_SKIPPED = 'Skipped — AI layout changes are disabled in Settings';

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

/**
 * The error as one line of text for an agent. An `ApiError` keeps the
 * server's reasons apart from its headline (`details`); a text channel has
 * no list to render them in, so they are joined back on here.
 */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const reasons = errorDetails(err);
  return reasons.length ? `${err.message}: ${reasons.join('; ')}` : err.message;
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

/**
 * D4: the layout opt-out. Layout commands rewrite every node's position, so
 * with `chatAllowLayoutChanges` off they are skipped, not run — a skip is not
 * a failure and the rest of a batch still applies. `preview` and `runTool`
 * both go through here so what is announced is what happens.
 */
function applyLayoutOptOut(commands: Command[]): { commands: Command[]; skipped: Command[] } {
  if (getBehaviorSettings().chatAllowLayoutChanges) return { commands, skipped: [] };
  const skipped: Command[] = [];
  const kept = commands.filter((c) => {
    if (isLayoutCommand(c.type)) {
      skipped.push(c);
      return false;
    }
    return true;
  });
  return { commands: kept, skipped };
}

// ============================================================================
// Host tool schemas and descriptions
// ============================================================================

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
 * The host tools a set of hooks makes available, in registration order.
 * `save` needs `onSave`; `run` needs `onRun`; `run_status` needs both `onRun`
 * and `onRunStatus` (a status tool without a way to start a run has nothing
 * to report on).
 */
export function buildHostToolDescriptors(hooks: HostHooks): HostToolDescriptor[] {
  const out: HostToolDescriptor[] = [];
  if (hooks.onSave) {
    out.push({
      verb: 'save',
      description:
        'Save the workflow to the server. Nothing an agent changes is persisted until ' +
        'this runs or the person clicks Save. Asks for approval; cannot be undone from ' +
        'the editor. Fails with FORBIDDEN when the user may not save, CONFLICT when the ' +
        'server copy changed since it was loaded (reload the page), INVALID when the ' +
        'server rejected the workflow — the message says which node or port.',
      inputSchema: EMPTY_SCHEMA,
      readOnly: false,
      consequential: true
    });
  }
  if (hooks.onRun) {
    out.push({
      verb: 'run',
      description:
        'Run the saved workflow on the server with optional inputs for its interface ports. ' +
        'Save first: unsaved changes are not part of the run. Asks for approval. Returns a ' +
        '`runId`' +
        (hooks.onRunStatus ? ' to poll with run_status.' : '.') +
        ' Fails with FORBIDDEN when the user may not run, UNAVAILABLE when the workflow is not saved yet, ' +
        'INVALID when the server rejected the workflow.',
      inputSchema: RUN_SCHEMA,
      readOnly: false,
      consequential: true
    });
    if (hooks.onRunStatus) {
      out.push({
        verb: 'run_status',
        description:
          'Report the status of a run started with run: pending, running, paused, completed, failed or cancelled, ' +
          'with outputs once it completed. A paused run answers code PENDING with the node and message it waits on — ' +
          'a person must act in the editor; tell the user, then poll again. Read-only.',
        inputSchema: RUN_STATUS_SCHEMA,
        readOnly: true,
        consequential: false
      });
    }
  }
  return out;
}

// ============================================================================
// createToolRuntime
// ============================================================================

/**
 * Build the runtime for one editor instance. Pure of the WebMCP API: it
 * touches no `document.modelContext`, so it serves the chat panel as well as
 * the registration. Dispose it when the caller goes away; a disposed runtime
 * answers every call with `DETACHED`.
 */
export function createToolRuntime(options: ToolRuntimeOptions): ToolRuntime {
  const { instance } = options;
  const hooks: HostHooks = options.hooks ?? {};
  let disposed = false;

  const nodeTypes = (): NodeMetadata[] => {
    const source = options.nodeTypes;
    if (source === undefined) return instance.nodeTypes.current;
    return typeof source === 'function' ? source() : source;
  };

  const editorName = (): string => instance.workflow.current?.name ?? instance.id;

  const gate: ApprovalGate =
    options.gate ??
    createApprovalGate(options.approval ?? 'confirm', {
      container: options.container,
      editorName,
      messages: options.messages,
      rememberEdits: options.rememberEdits
    });
  const ownsGate = !options.gate;
  // With a supplied gate the policy is its owner's; assume it asks.
  const gateAsks = Boolean(options.gate) || (options.approval ?? 'confirm') !== 'auto';
  const gateRequest = (tool: string) => {
    const title = options.dialogTitle?.(editorName());
    return title === undefined ? { tool } : { tool, title };
  };

  const onUIAction: ((action: UIAction) => void) | undefined = options.onUIAction;
  const descriptors = buildToolDescriptors({ view: Boolean(onUIAction) });
  const hostTools = buildHostToolDescriptors(hooks);
  const byVerb = new Map<string, ToolDescriptor>(descriptors.map((d) => [d.verb, d]));
  const hostByVerb = new Map<string, HostToolDescriptor>(hostTools.map((d) => [d.verb, d]));

  const detached = (): ToolResult => errorResult('DETACHED', 'This editor is no longer available');

  // ---- editor tools -------------------------------------------------------

  function toCommands(
    descriptor: ToolDescriptor,
    input: unknown
  ): { commands: Command[] } | { error: ToolResult } {
    try {
      return { commands: descriptor.toCommands(validateToolArgs(descriptor.inputSchema, input)) };
    } catch (err) {
      if (err instanceof ToolArgumentError) {
        return { error: errorResult('INVALID_ARGUMENTS', err.message) };
      }
      throw err;
    }
  }

  async function runDescriptor(descriptor: ToolDescriptor, input: unknown): Promise<ToolResult> {
    if (disposed) return detached();

    const mapped = toCommands(descriptor, input);
    if ('error' in mapped) return mapped.error;
    const { commands, skipped } = applyLayoutOptOut(mapped.commands);
    if (commands.length === 0) {
      return text({
        ok: true,
        results: [],
        skipped: skipped.map((c) => ({ type: c.type, reason: LAYOUT_SKIPPED })),
        completedCount: 0,
        totalCount: 0
      });
    }

    const context = createStoreCommandContext(nodeTypes(), onUIAction, instance);
    if (!context) return errorResult('NO_WORKFLOW', 'No workflow is loaded in this editor');

    // D3: reads and view changes run; document changes wait for the gate.
    if (needsApproval(commands)) {
      let approved: boolean;
      try {
        approved = await gate.request(commands, gateRequest(descriptor.verb));
      } catch (err) {
        if (err instanceof GateBusyError) return errorResult('BUSY', err.message);
        throw err;
      }
      if (!approved) return errorResult('REJECTED', 'The user rejected the change');
      if (disposed) return detached();
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
      approved = await gate.request([], gateRequest(tool));
    } catch (err) {
      if (err instanceof GateBusyError) return errorResult('BUSY', err.message);
      throw err;
    }
    if (!approved) return errorResult('REJECTED', 'The user rejected the change');
    if (disposed) return detached();
    return null;
  }

  /**
   * `save` persists the workflow via the host's `onSave`. It has no commands
   * of its own — nothing for `executeBatch` to run — so it is gated directly
   * rather than going through the command pipeline.
   */
  async function runSave(onSave: NonNullable<HostHooks['onSave']>, input: unknown) {
    if (disposed) return detached();
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
      envelope = await onSave();
    } catch (err) {
      const message = describeError(err);
      if (!isConflictError(err)) return errorResult('SAVE_FAILED', message);
      // The server's own wording usually already says to reload; add the hint
      // only when it does not, so the agent is not told twice.
      const hint = /reload/i.test(message)
        ? ''
        : ' The workflow changed on the server since it was loaded; reload the page before saving.';
      return errorResult('CONFLICT', `${message}${hint}`);
    }
    if (envelope) return envelopeResult(envelope, 'Workflow saved');
    return text({ ok: true, message: 'Workflow saved' });
  }

  /** `run` starts a run through the host's `onRun`; gated like `save`. */
  async function runRun(onRun: NonNullable<HostHooks['onRun']>, input: unknown) {
    if (disposed) return detached();
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
      envelope = await onRun((args.inputs as Record<string, unknown> | undefined) ?? {});
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
  async function runRunStatus(onRunStatus: NonNullable<HostHooks['onRunStatus']>, input: unknown) {
    if (disposed) return detached();
    const args = validateOrError(RUN_STATUS_SCHEMA, input);
    if (isToolResult(args)) return args;

    let envelope: HostEnvelope<RunStatus>;
    try {
      envelope = await onRunStatus(args.runId as string);
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

  // ---- dispatch -----------------------------------------------------------

  async function runTool(name: string, input: unknown): Promise<ToolResult> {
    if (disposed) return detached();
    const descriptor = byVerb.get(name);
    if (descriptor) return runDescriptor(descriptor, input);
    if (hostByVerb.has(name)) {
      if (name === 'save' && hooks.onSave) return runSave(hooks.onSave, input);
      if (name === 'run' && hooks.onRun) return runRun(hooks.onRun, input);
      if (name === 'run_status' && hooks.onRunStatus) return runRunStatus(hooks.onRunStatus, input);
    }
    return errorResult(
      'UNKNOWN_TOOL',
      `No tool named "${name}". Available: ${[...byVerb.keys(), ...hostByVerb.keys()].join(', ')}.`
    );
  }

  function preview(name: string, input: unknown): ToolPreview | null {
    const host = hostByVerb.get(name);
    if (host) {
      const mutating = !host.readOnly;
      return {
        commands: [],
        skipped: [],
        mutating,
        consequential: host.consequential,
        asks: gateAsks && mutating
      };
    }
    const descriptor = byVerb.get(name);
    if (!descriptor) return null;
    const mapped = toCommands(descriptor, input);
    if ('error' in mapped) return null;
    const { commands, skipped } = applyLayoutOptOut(mapped.commands);
    const mutating = needsApproval(commands);
    return {
      commands,
      skipped,
      mutating,
      consequential: false,
      asks: gateAsks && mutating && !gate.editsPreApproved
    };
  }

  return {
    descriptors,
    hostTools,
    gate,
    runTool,
    preview,
    get disposed() {
      return disposed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (ownsGate) gate.dispose();
    }
  };
}
