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
  type ModelContextLike,
  type RegisteredToolDefinition,
  type ToolDescriptor,
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

function errorResult(code: string, message: string): ToolResult {
  return text({ ok: false, code, error: message }, true);
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
    messages: options.messages
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

  // ---- save -----------------------------------------------------------

  const SAVE_INPUT_SCHEMA = {
    type: 'object',
    properties: {},
    additionalProperties: false
  } as const;

  /**
   * `save` persists the workflow via the host's `onSave`. It has no commands
   * of its own — nothing for `executeBatch` to run — so it is gated directly
   * rather than going through `run()`'s command pipeline.
   */
  async function runSave(input: unknown): Promise<ToolResult> {
    if (!attached) return errorResult('DETACHED', 'This editor is no longer available');

    try {
      validateToolArgs(SAVE_INPUT_SCHEMA, input);
    } catch (err) {
      if (err instanceof ToolArgumentError) return errorResult('INVALID_ARGUMENTS', err.message);
      throw err;
    }

    if (!instance.workflow.current) {
      return errorResult('NO_WORKFLOW', 'No workflow is loaded in this editor');
    }

    let approved: boolean;
    try {
      approved = await gate.request([], { tool: 'save' });
    } catch (err) {
      if (err instanceof GateBusyError) return errorResult('BUSY', err.message);
      throw err;
    }
    if (!approved) return errorResult('REJECTED', 'The user rejected the change');
    if (!attached) return errorResult('DETACHED', 'This editor is no longer available');

    try {
      // Non-null: runSave is only wired up as a tool when options.onSave is set.
      await options.onSave!();
    } catch (err) {
      return errorResult('SAVE_FAILED', err instanceof Error ? err.message : String(err));
    }
    return text({ ok: true, message: 'Workflow saved' });
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
          'the editor.' +
          nameSuffix,
        inputSchema: SAVE_INPUT_SCHEMA,
        annotations: { readOnlyHint: false, consequentialHint: true },
        execute: (input) => runSave(input)
      })
    );
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
