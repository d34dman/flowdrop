/**
 * FlowDrop Instance Container
 *
 * Holds all per-instance state for one FlowDrop editor: workflow state,
 * undo/redo history, playground sessions, interrupts, port coordinates,
 * categories, and pipeline panel state. Creating one container per mount is
 * what allows multiple FlowDrop editors to coexist on a single page.
 *
 * The container is provided to the component tree via Svelte context (see
 * `getInstance.svelte.ts`). A lazily-created, browser-only default instance
 * backs the legacy module-level store APIs so existing single-instance
 * consumers keep working unchanged.
 *
 * @module stores/instanceContainer
 */

import type { NodeMetadata } from '../types/index.js';
import type { HostHooks } from '../webmcp/types.js';
import { HistoryService, historyService } from '../services/historyService.js';
import { WorkflowStore } from './workflowStore.svelte.js';
import { HistoryStore } from './historyStore.svelte.js';
import { PlaygroundStore } from './playgroundStore.svelte.js';
import { InterruptStore } from './interruptStore.svelte.js';
import { CategoriesStore } from './categoriesStore.svelte.js';
import { PortCoordinateStore } from './portCoordinateStore.svelte.js';
import { PipelinePanelStore } from './pipelinePanelStore.svelte.js';
import { ApiContext } from './apiContext.js';
import { PortCompatibilityChecker } from '../utils/connections.js';
import { DEFAULT_PORT_CONFIG } from '../config/defaultPortConfig.js';
import { NodeComponentRegistry } from '../registry/nodeComponentRegistry.js';
import { FieldComponentRegistry } from '../form/fieldRegistry.js';
import { WorkflowFormatRegistry } from '../registry/workflowFormatRegistry.js';
import { BUILTIN_NODE_COMPONENTS } from '../registry/builtinNodes.js';
import { getBuiltinFormatAdapters } from '../registry/builtinFormats.js';

/** Storage key prefix shared by the default instance and legacy consumers. */
export const DEFAULT_DRAFT_PREFIX = 'flowdrop:draft';

/**
 * All per-instance FlowDrop state.
 *
 * Store fields are added phase-by-phase as the module-level stores are
 * converted to classes (workflow, history bindings, playground, interrupts,
 * categories, port coordinates, pipeline panel).
 */
export interface FlowDropInstance {
  /** Unique id for this instance (used to scope storage keys). */
  readonly id: string;
  /** Prefix for draft localStorage keys — legacy bare prefix for the default instance. */
  readonly storagePrefix: string;
  /** Whether this is the page-default instance (legacy storage keys, module-API reachable). */
  readonly isDefault: boolean;
  /** Undo/redo engine for this instance. */
  readonly history: HistoryService;
  /** Workflow state with dirty tracking and history integration. */
  readonly workflow: WorkflowStore;
  /** Reactive rune bindings around `history` (undo/redo button state). */
  readonly historyBindings: HistoryStore;
  /** Playground sessions, messages, and execution state. */
  readonly playground: PlaygroundStore;
  /** Pending interrupt/confirmation dialogs. */
  readonly interrupts: InterruptStore;
  /** Endpoint configuration, auth provider, and API client for this instance. */
  readonly api: ApiContext;
  /** Node component registry, seeded with the built-in node components. */
  readonly nodes: NodeComponentRegistry;
  /**
   * Form field component registry. Starts empty (built-in light fields are
   * resolved inline); heavy editors are registered on demand via
   * `registerCodeEditorField(fd.fields)` etc.
   */
  readonly fields: FieldComponentRegistry;
  /** Workflow format registry, seeded with the flowdrop + agentspec adapters. */
  readonly formats: WorkflowFormatRegistry;
  /** Node category definitions. */
  readonly categories: CategoriesStore;
  /**
   * Port-to-port data-type compatibility checker for this instance.
   * Seeded with `DEFAULT_PORT_CONFIG`; re-initialized by mount after the
   * backend's port config is fetched.
   */
  readonly portCompatibility: PortCompatibilityChecker;
  /** Canvas port coordinates. */
  readonly portCoordinates: PortCoordinateStore;
  /** Pipeline panel open/close state (instance-scoped persistence). */
  readonly pipelinePanel: PipelinePanelStore;
  /**
   * The node types this editor currently knows: what `App` fetched (or was
   * given), merged with the format-provided nodes. Written by the editor as
   * its fetch lands; read by anything that needs the list without fetching
   * again (the WebMCP adapter's `list_types`, `add_node`).
   */
  readonly nodeTypes: NodeTypesStore;
  /**
   * The host's save/run/status hooks for this editor, as the mount supplied
   * them (`mountFlowDropApp` sets `onSave` to its own Save and copies the
   * `webmcp` option's `onRun`/`onRunStatus`). Read by anything that offers
   * the `save`, `run` and `run_status` tools without a WebMCP runtime — the
   * chat panel's tool loop — so both agents persist and run exactly the way
   * clicking Save does.
   */
  readonly host: HostHooksStore;
  /**
   * Run `fn` when this instance is destroyed. Returns an unsubscribe; calling
   * it before `destroy()` means `fn` never runs. Adapters that bind to an
   * instance (WebMCP, host integrations) hook their teardown here instead of
   * wrapping `destroy`.
   */
  onDestroy(fn: () => void): () => void;
  /**
   * Dispose all per-instance resources (subscriptions, effect roots,
   * external callbacks). Safe to call more than once. Must not touch
   * sibling instances.
   */
  destroy(): void;
}

/**
 * The instance's node-type list. A getter and a setter over one `$state`, so
 * a reader inside an effect tracks it and a reader outside one just gets the
 * current array.
 */
export class NodeTypesStore {
  #list = $state<NodeMetadata[]>([]);

  /** The list as last set; empty until the editor's fetch lands. */
  get current(): NodeMetadata[] {
    return this.#list;
  }

  set(list: NodeMetadata[]): void {
    this.#list = list;
  }
}

/**
 * The host hooks of one editor. A plain holder, not reactive: hooks are set
 * once by the mount and read at call time.
 */
export class HostHooksStore {
  #hooks: HostHooks = {};

  get current(): HostHooks {
    return this.#hooks;
  }

  /** Replace the hooks. Keys set to `undefined` are dropped. */
  set(hooks: HostHooks): void {
    const next: HostHooks = {};
    if (hooks.onSave) next.onSave = hooks.onSave;
    if (hooks.onRun) next.onRun = hooks.onRun;
    if (hooks.onRunStatus) next.onRunStatus = hooks.onRunStatus;
    this.#hooks = next;
  }
}

export interface CreateInstanceOptions {
  /** Explicit instance id; auto-generated (`fd-<n>`) when omitted. */
  id?: string;
  /**
   * Marks the page-default instance: it keeps the legacy (unscoped) storage
   * keys and reuses the exported `historyService` singleton so legacy
   * imports keep operating on the same history stack.
   */
  isDefault?: boolean;
}

// Feeds auto-generated ids only (`fd-1`, `fd-2`, …) — cosmetic monotonicity.
// Incrementing across SSR requests is harmless; no state hangs off the value.
let instanceCounter = 0;

/**
 * Create a fully wired FlowDrop instance.
 *
 * Creation order matters: history first, then stores that depend on it
 * (constructor injection — no module-singleton imports).
 */
export function createFlowDropInstance(options: CreateInstanceOptions = {}): FlowDropInstance {
  const isDefault = options.isDefault ?? false;
  const id = options.id ?? (isDefault ? 'default' : `fd-${++instanceCounter}`);
  // Every instance gets an id-scoped prefix — the default instance's 1.x bare
  // keys are migrated on first read (see migrateLegacyDraftKey / PipelinePanelStore.init).
  const storagePrefix = `${DEFAULT_DRAFT_PREFIX}:${id}`;

  // The default instance reuses the exported singleton (public API via
  // `@flowdrop/flowdrop/editor`) so external `historyService.undo()` etc.
  // keep operating on the default editor's history stack.
  const history = isDefault ? historyService : new HistoryService();

  const workflow = new WorkflowStore(history);
  const historyBindings = new HistoryStore(history);
  // Default wiring: undo/redo restores into this instance's workflow store.
  // WorkflowEditor overrides this with a richer callback while mounted.
  historyBindings.setOnRestoreCallback((restored) => workflow.restoreFromHistory(restored));
  // Before any undo/redo, flush a pending config-edit session into a committed
  // step so it can be undone atomically (the history service won't commit a
  // dangling transaction itself — it has no access to the live state).
  historyBindings.setBeforeNavigateCallback(() => workflow.finalizeNodeConfig());

  const playground = new PlaygroundStore();

  const cleanups: Array<() => void> = [
    () => historyBindings.cleanup(),
    () => historyBindings.setOnRestoreCallback(null),
    () => historyBindings.setBeforeNavigateCallback(null),
    () => workflow.setOnDirtyStateChange(null),
    () => workflow.setOnWorkflowChange(null),
    () => playground.dispose()
  ];

  return {
    id,
    storagePrefix,
    isDefault,
    history,
    workflow,
    historyBindings,
    playground,
    interrupts: new InterruptStore(),
    api: new ApiContext(),
    nodes: new NodeComponentRegistry({
      registrations: BUILTIN_NODE_COMPONENTS,
      defaultType: 'workflowNode'
    }),
    fields: new FieldComponentRegistry(),
    formats: new WorkflowFormatRegistry(getBuiltinFormatAdapters()),
    categories: new CategoriesStore(),
    portCoordinates: new PortCoordinateStore(),
    portCompatibility: new PortCompatibilityChecker(DEFAULT_PORT_CONFIG),
    // The default instance keeps the legacy bare localStorage key.
    pipelinePanel: new PipelinePanelStore(id),
    nodeTypes: new NodeTypesStore(),
    host: new HostHooksStore(),
    onDestroy(fn) {
      cleanups.push(fn);
      return () => {
        const i = cleanups.indexOf(fn);
        if (i !== -1) cleanups.splice(i, 1);
      };
    },
    destroy() {
      while (cleanups.length > 0) {
        cleanups.pop()?.();
      }
    }
  };
}

// =========================================================================
// Default instance (backward compatibility)
// =========================================================================

let defaultInstance: FlowDropInstance | null = null;

/**
 * Get the page-default FlowDrop instance, creating it on first access.
 *
 * **Browser-only.** Reactive per-user state must never live at module scope
 * on the server — a module-level default would leak between SvelteKit
 * requests. Server renders must provide an instance via context instead
 * (`<App>` and `<WorkflowEditor>` do this automatically).
 */
export function getDefaultInstance(): FlowDropInstance {
  if (typeof window === 'undefined') {
    throw new Error(
      '[flowdrop] The default FlowDrop instance is browser-only to prevent ' +
        'cross-request state leakage during SSR. Render inside <App> or ' +
        '<WorkflowEditor> (which provide an instance via context), or pass ' +
        'an explicit instance.'
    );
  }
  return (defaultInstance ??= createFlowDropInstance({ isDefault: true }));
}
