/**
 * WebMCP adapter — registration.
 *
 * The only file that touches the browser's model context
 * (`document.modelContext`, falling back to `navigator.modelContext`). Builds
 * a tool runtime for the instance, registers each of its tools with an
 * `execute` that delegates to `runTool()`, and registers the lot under one
 * AbortSignal so detaching is a single `abort()`. What a call *does* — validation, the gate, the batch —
 * lives in `runtime.ts`, which the chat panel shares.
 *
 * @module webmcp/register
 */

import type { FlowDropInstance } from '../stores/instanceContainer.svelte.js';
import { logger } from '../utils/logger.js';
import { createToolRuntime } from './runtime.js';
import type {
  HostToolDescriptor,
  ModelContextLike,
  RegisteredToolDefinition,
  ToolDescriptor,
  WebMCPHandle,
  WebMCPOptions
} from './types.js';

export const DEFAULT_PREFIX = 'flowdrop';

// ============================================================================
// Runtime detection
// ============================================================================

/**
 * Find the WebMCP model context on this page, or `null` when the browser has none.
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
// Prefix registry (D2) — one registration per prefix per model context
// ============================================================================

const claimedPrefixes = new WeakMap<object, Set<string>>();

function claimPrefix(modelContext: object, prefix: string): void {
  let set = claimedPrefixes.get(modelContext);
  if (!set) {
    set = new Set();
    claimedPrefixes.set(modelContext, set);
  }
  if (set.has(prefix)) {
    throw new Error(
      `[flowdrop] WebMCP tools with prefix "${prefix}" are already registered on this page. ` +
        `Pass a distinct \`prefix\` for each editor instance.`
    );
  }
  set.add(prefix);
}

function releasePrefix(modelContext: object, prefix: string): void {
  claimedPrefixes.get(modelContext)?.delete(prefix);
}

// ============================================================================
// attach
// ============================================================================

/**
 * Register the editor's commands as WebMCP tools for `instance`.
 *
 * Returns `null` — with no console output — when the page has no WebMCP
 * model context, so hosts can call it unconditionally. Throws when the prefix is
 * already registered on this model context (two editors on one page need distinct
 * prefixes).
 *
 * Registration settles asynchronously: `handle.tools` lists the tools the
 * model context has accepted so far and `handle.ready` resolves when every
 * registration has settled. The registration is torn down by
 * `handle.detach()` or automatically when `instance.destroy()` runs.
 */
export function attachWebMCP(
  instance: FlowDropInstance,
  options: WebMCPOptions = {}
): WebMCPHandle | null {
  const detected = options.modelContext ?? detectModelContext();
  if (!detected) return null;
  const modelContext: ModelContextLike = detected;

  const prefix = options.prefix ?? DEFAULT_PREFIX;
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix)) {
    throw new Error(`[flowdrop] Invalid WebMCP prefix "${prefix}"`);
  }
  claimPrefix(modelContext, prefix);

  const editorName = (): string => instance.workflow.current?.name ?? instance.id;

  // One gate per editor (see `FlowDropInstance.approvalGate`): reuse the one
  // another surface published, or publish ours.
  const { onSave, onRun, onRunStatus } = options;
  const sharedGate = instance.approvalGate;
  const tools = createToolRuntime({
    instance,
    nodeTypes: options.nodeTypes,
    onUIAction: options.onUIAction,
    hooks: { onSave, onRun, onRunStatus },
    gate: sharedGate ?? undefined,
    approval: options.approval,
    container: options.container,
    messages: options.messages,
    rememberEdits: options.rememberEdits
  });
  if (!sharedGate) instance.approvalGate = tools.gate;

  const controller = new AbortController();
  const names: string[] = [];
  let attached = true;

  // ---- register -----------------------------------------------------------

  const nameSuffix = ` Editor: "${editorName()}".`;

  async function registerRaw(tool: RegisteredToolDefinition): Promise<void> {
    try {
      // The spec returns a promise that rejects when the model context refuses
      // the tool; pre-spec ones return nothing, which `await` takes as accepted.
      await modelContext.registerTool(tool, { signal: controller.signal });
    } catch (err) {
      logger.warn(
        `WebMCP: the model context refused tool "${tool.name}":`,
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
      execute: (input) => tools.runTool(descriptor.verb, input)
    });
  }

  function registerHost(descriptor: HostToolDescriptor): Promise<void> {
    return registerRaw({
      name: `${prefix}_${descriptor.verb}`,
      description: descriptor.description + nameSuffix,
      inputSchema: descriptor.inputSchema,
      annotations: {
        readOnlyHint: descriptor.readOnly,
        ...(descriptor.consequential ? { consequentialHint: true } : {})
      },
      execute: (input) => tools.runTool(descriptor.verb, input)
    });
  }

  const ready = Promise.all([
    ...tools.descriptors.map(register),
    ...tools.hostTools.map(registerHost)
  ]).then(() => undefined);

  // ---- detach -------------------------------------------------------------

  function detach(): void {
    if (!attached) return;
    attached = false;
    unsubscribeDestroy();
    if (instance.approvalGate === tools.gate && !sharedGate) instance.approvalGate = null;
    tools.dispose();
    controller.abort();
    if (typeof modelContext.unregisterTool === 'function') {
      for (const name of names) {
        try {
          modelContext.unregisterTool(name);
        } catch {
          // Pre-spec model-context quirks are not ours to surface.
        }
      }
    }
    releasePrefix(modelContext, prefix);
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
