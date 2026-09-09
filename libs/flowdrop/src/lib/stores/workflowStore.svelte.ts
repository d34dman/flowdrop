/**
 * Workflow Store for FlowDrop (Svelte 5 Runes)
 *
 * Provides per-instance state management for workflows with dirty state
 * tracking and undo/redo history integration.
 *
 * The reactive state lives in the {@link WorkflowStore} class — one per
 * FlowDrop instance, created by `createFlowDropInstance()` and resolved in
 * components via `getInstance().workflow`.
 *
 * @module stores/workflowStore
 */

import type { Workflow, WorkflowNode, WorkflowEdge } from '$lib/types';
import { DEFAULT_WORKFLOW_FORMAT } from '$lib/types/index.js';
import type { WorkflowChangeType } from '$lib/types/events.js';
import type { HistoryService } from '../services/historyService.js';
import { WORKFLOW_SCHEMA_VERSION } from '$lib/schemas/index.js';
import type { PortMapping } from '../utils/nodeSwap.js';
import type { WorkflowInterfaceEntry } from '$lib/types/index.js';
import { interfaceBoundHandles, rewriteInterfaceBindings } from '../utils/workflowInterface.js';

type WorkflowMetadata = Workflow['metadata'];

/**
 * Safely build updated workflow metadata, providing defaults for required fields.
 *
 * Accepts loosely-typed legacy metadata so it can absorb 1.x documents (where
 * the schema-version field was named `version`) during load-time healing.
 */
function buildMetadata(
  existing?: Partial<WorkflowMetadata> & { version?: string },
  updates?: Partial<WorkflowMetadata>
): WorkflowMetadata {
  return {
    schemaVersion: existing?.schemaVersion ?? existing?.version ?? WORKFLOW_SCHEMA_VERSION,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author: existing?.author,
    tags: existing?.tags,
    versionId: existing?.versionId,
    updateNumber: existing?.updateNumber,
    format: existing?.format,
    ...updates
  };
}

/**
 * Loosely-typed shape a workflow may arrive in before healing — a 1.x document
 * may have no `metadata`, or metadata carrying the legacy `version` key instead
 * of `schemaVersion`.
 */
type LegacyWorkflow = Omit<Workflow, 'metadata'> & {
  metadata?: (Partial<WorkflowMetadata> & { version?: string }) | null;
};

/**
 * Normalize workflow metadata at load time (the only back-compat path we keep,
 * mirroring the storage-key migration in commit 8fab9157).
 *
 * Rules:
 * - missing `metadata` → `buildMetadata(undefined)` (fresh required defaults)
 * - legacy `version` key present → copied to `schemaVersion` when absent, then
 *   the legacy key is dropped
 *
 * Idempotent: re-running on an already-healed workflow returns equivalent
 * metadata (round-trip stable).
 */
export function normalizeWorkflowMetadata(workflow: LegacyWorkflow): Workflow {
  const raw = workflow.metadata;
  if (!raw) {
    return { ...workflow, metadata: buildMetadata(undefined) } as Workflow;
  }

  const { version: legacyVersion, ...rest } = raw;
  const healed: WorkflowMetadata = {
    ...(rest as WorkflowMetadata),
    schemaVersion: rest.schemaVersion ?? legacyVersion ?? WORKFLOW_SCHEMA_VERSION
  };

  return { ...workflow, metadata: healed } as Workflow;
}

/**
 * Check if workflow data has actually changed
 *
 * Used to prevent unnecessary updates and infinite loops.
 */
function hasWorkflowDataChanged(
  currentWorkflow: Workflow | null,
  newNodes: WorkflowNode[],
  newEdges: WorkflowEdge[]
): boolean {
  if (!currentWorkflow) return true;

  // Check if nodes have changed
  if (currentWorkflow.nodes.length !== newNodes.length) return true;

  for (let i = 0; i < newNodes.length; i++) {
    const currentNode = currentWorkflow.nodes[i];
    const newNode = newNodes[i];

    if (!currentNode || !newNode) return true;
    if (currentNode.id !== newNode.id) return true;
    if (
      currentNode.position.x !== newNode.position.x ||
      currentNode.position.y !== newNode.position.y
    )
      return true;
    if (currentNode.data !== newNode.data) return true;
  }

  // Check if edges have changed
  if (currentWorkflow.edges.length !== newEdges.length) return true;

  for (let i = 0; i < newEdges.length; i++) {
    const currentEdge = currentWorkflow.edges[i];
    const newEdge = newEdges[i];

    if (!currentEdge || !newEdge) return true;
    if (currentEdge.id !== newEdge.id) return true;
    if (currentEdge.source !== newEdge.source || currentEdge.target !== newEdge.target) return true;
  }

  return false;
}

/**
 * Mutation actions for a {@link WorkflowStore}.
 *
 * Bound facade — safe to detach (`onclick={fd.workflow.actions.undo}`)
 * because every entry is bound to its store in the constructor.
 */
export interface WorkflowStoreActions {
  initialize: (workflow: Workflow) => void;
  updateWorkflow: (workflow: Workflow) => void;
  restoreFromHistory: (workflow: Workflow) => void;
  updateNodes: (nodes: WorkflowNode[]) => void;
  updateEdges: (edges: WorkflowEdge[]) => void;
  updateName: (name: string) => void;
  addNode: (node: WorkflowNode) => void;
  removeNode: (nodeId: string) => void;
  addEdge: (edge: WorkflowEdge) => void;
  removeEdge: (edgeId: string) => void;
  updateNode: (nodeId: string, updates: Partial<WorkflowNode>) => void;
  updateNodeConfig: (
    nodeId: string,
    updates: Partial<WorkflowNode>,
    opts?: { fieldKey?: string }
  ) => void;
  finalizeNodeConfig: (changeType?: WorkflowChangeType) => void;
  clear: () => void;
  updateMetadata: (metadata: Partial<Workflow['metadata']>) => void;
  batchUpdate: (updates: {
    nodes?: WorkflowNode[];
    edges?: WorkflowEdge[];
    name?: string;
    description?: string;
    metadata?: Partial<Workflow['metadata']>;
    config?: Record<string, unknown>;
    /** The workflow's public contract. Omit to leave it untouched. */
    interface?: Workflow['interface'];
  }) => void;
  swapNode: (updates: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    description?: string;
    /** The swapped-out node's id and its replacement — together with
     *  `portMappings`, drives the `workflow.interface` binding rewrite. Omit
     *  either to leave `interface` untouched. */
    oldNodeId?: string;
    newNodeId?: string;
    portMappings?: PortMapping[];
  }) => void;
  pushHistory: (description?: string, workflow?: Workflow) => void;
}

// =========================================================================
// WorkflowStore (per-instance reactive state)
// =========================================================================

/**
 * Per-instance workflow state with dirty tracking and history integration.
 *
 * All reads go through getters backed by `$state`, so reading them inside a
 * component template or `$derived` tracks reactively, exactly like the
 * legacy module-level functions did.
 */
export class WorkflowStore {
  /** Current workflow */
  #workflow = $state<Workflow | null>(null);

  /**
   * Monotonic edit version — bumps on every mutation action.
   *
   * Used for two purposes:
   * 1. O(1) dirty detection: isDirty = #editVersion !== #savedVersion
   * 2. Save verification protocol: include the version in the save request,
   *    backend echoes it back. If the echoed version doesn't match, the save
   *    didn't persist the version the client submitted.
   */
  #editVersion = $state<number>(0);

  /**
   * Edit version captured at the last successful save.
   * When #editVersion === #savedVersion, the workflow is clean.
   */
  #savedVersion = $state<number>(0);

  /** Callback for dirty state changes — set by the App component. */
  #onDirtyStateChange: ((isDirty: boolean) => void) | null = null;

  /** Callback for workflow changes — set by the App component. */
  #onWorkflowChange: ((workflow: Workflow, changeType: WorkflowChangeType) => void) | null = null;

  /**
   * Whether we're currently restoring from history (undo/redo).
   * When true, prevents pushing to history to avoid recursive loops.
   */
  #restoringFromHistory = false;

  /** Whether history recording is enabled (disable for bulk operations). */
  #historyEnabled = true;

  /**
   * Identifies the config-edit session currently in progress, as
   * `${nodeId}::${fieldKey}`, or null when no field is being edited.
   *
   * Config fields commit live on every change (see {@link updateNodeConfig}),
   * but a whole field-editing session — however many keystrokes — should be a
   * single undo step and fire the external change event only once. The session
   * is a history transaction: opened lazily on the first change, coalescing all
   * live edits, and closed by {@link finalizeNodeConfig}. A change to a
   * different node/field auto-finalizes the previous session first, giving
   * one-undo-step-per-field granularity.
   */
  #configEditKey: string | null = null;

  /** Undo/redo engine for this instance (constructor-injected). */
  readonly #history: HistoryService;

  /** Bound mutation facade — see {@link WorkflowStoreActions}. */
  readonly actions: WorkflowStoreActions;

  constructor(history: HistoryService) {
    this.#history = history;
    this.actions = Object.freeze({
      initialize: this.initialize.bind(this),
      updateWorkflow: this.updateWorkflow.bind(this),
      restoreFromHistory: this.restoreFromHistory.bind(this),
      updateNodes: this.updateNodes.bind(this),
      updateEdges: this.updateEdges.bind(this),
      updateName: this.updateName.bind(this),
      addNode: this.addNode.bind(this),
      removeNode: this.removeNode.bind(this),
      addEdge: this.addEdge.bind(this),
      removeEdge: this.removeEdge.bind(this),
      updateNode: this.updateNode.bind(this),
      updateNodeConfig: this.updateNodeConfig.bind(this),
      finalizeNodeConfig: this.finalizeNodeConfig.bind(this),
      clear: this.clear.bind(this),
      updateMetadata: this.updateMetadata.bind(this),
      batchUpdate: this.batchUpdate.bind(this),
      swapNode: this.swapNode.bind(this),
      pushHistory: this.pushHistory.bind(this)
    });
  }

  // -----------------------------------------------------------------------
  // Reactive getters
  // -----------------------------------------------------------------------

  /** The current workflow, or null when none is loaded. */
  get current(): Workflow | null {
    return this.#workflow;
  }

  /**
   * Whether there are unsaved changes.
   *
   * Reads both #editVersion and #savedVersion, so Svelte tracks them as
   * reactive dependencies — any component using this re-renders when dirty
   * state changes.
   */
  get isDirty(): boolean {
    return this.#editVersion !== this.#savedVersion;
  }

  /** The workflow ID, or null. */
  get id(): string | null {
    return this.#workflow?.id ?? null;
  }

  /** The workflow name, or 'Untitled Workflow'. */
  get name(): string {
    return this.#workflow?.name ?? 'Untitled Workflow';
  }

  /** The workflow nodes. */
  get nodes(): WorkflowNode[] {
    return this.#workflow?.nodes ?? [];
  }

  /** The workflow edges. */
  get edges(): WorkflowEdge[] {
    return this.#workflow?.edges ?? [];
  }

  /** The workflow metadata, with defaults. */
  get metadata(): WorkflowMetadata {
    return (
      this.#workflow?.metadata ?? {
        schemaVersion: WORKFLOW_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versionId: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        updateNumber: 0
      }
    );
  }

  /** The workflow format string. */
  get format(): string {
    return this.#workflow?.metadata?.format ?? DEFAULT_WORKFLOW_FORMAT;
  }

  /** Workflow change summary (useful for triggering saves). */
  get changeSummary(): { nodes: WorkflowNode[]; edges: WorkflowEdge[]; name: string } {
    return {
      nodes: this.nodes,
      edges: this.edges,
      name: this.name
    };
  }

  /** Workflow validation state. */
  get validation(): {
    hasNodes: boolean;
    hasEdges: boolean;
    nodeCount: number;
    edgeCount: number;
    isValid: boolean;
  } {
    const nodes = this.nodes;
    const edges = this.edges;
    return {
      hasNodes: nodes.length > 0,
      hasEdges: edges.length > 0,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      isValid: nodes.length > 0 && edges.length >= 0
    };
  }

  /** Workflow metadata change summary. */
  get metadataChangeSummary(): { createdAt: string; updatedAt: string; schemaVersion: string } {
    const metadata = this.metadata;
    return {
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      schemaVersion: metadata.schemaVersion ?? WORKFLOW_SCHEMA_VERSION
    };
  }

  /**
   * Set of all handle IDs currently connected to edges.
   *
   * Handle IDs are formatted `{nodeId}-{direction}-{portId}`.
   */
  get connectedHandles(): Set<string> {
    const handles = new Set<string>();

    this.edges.forEach((edge) => {
      // Add source handle (output port)
      if (edge.sourceHandle) {
        handles.add(edge.sourceHandle);
      }
      // Add target handle (input port)
      if (edge.targetHandle) {
        handles.add(edge.targetHandle);
      }
    });

    return handles;
  }

  /**
   * Handle IDs bound to a `workflow.interface` entry, mapped to the entry
   * itself — one memoized pass over `resolveInterface`, shared by every node
   * component and `FormPorts` instead of each re-deriving it per port. See
   * `utils/workflowInterface.ts#interfaceBoundHandles` for what counts as
   * "bound" (only bindings that resolve to a live port).
   */
  get interfaceBoundHandles(): Map<string, WorkflowInterfaceEntry> {
    return this.#workflow ? interfaceBoundHandles(this.#workflow) : new Map();
  }

  /**
   * The current monotonic edit version.
   *
   * Use this for the save verification protocol:
   * 1. Before save: `const v = store.editVersion`
   * 2. Include `v` in the save request payload
   * 3. Backend echoes `v` in the response
   * 4. If echoed version matches: `store.markAsSaved()`
   * 5. If not: the save didn't persist the version you submitted — reset from backend response
   */
  get editVersion(): number {
    return this.#editVersion;
  }

  /** Whether history recording is enabled. */
  get historyEnabled(): boolean {
    return this.#historyEnabled;
  }

  /** Enable or disable history recording (e.g. for bulk operations). */
  set historyEnabled(enabled: boolean) {
    this.#historyEnabled = enabled;
  }

  // -----------------------------------------------------------------------
  // Callback setters & save protocol
  // -----------------------------------------------------------------------

  /** Set the dirty state change callback. */
  setOnDirtyStateChange(callback: ((isDirty: boolean) => void) | null): void {
    this.#onDirtyStateChange = callback;
  }

  /** Set the workflow change callback. */
  setOnWorkflowChange(
    callback: ((workflow: Workflow, changeType: WorkflowChangeType) => void) | null
  ): void {
    this.#onWorkflowChange = callback;
  }

  /**
   * Mark the current workflow state as saved.
   *
   * Captures the current edit version so isDirty becomes false.
   * Call this after a successful backend save.
   */
  markAsSaved(): void {
    const wasDirty = this.#editVersion !== this.#savedVersion;
    this.#savedVersion = this.#editVersion;
    if (wasDirty && this.#onDirtyStateChange) {
      this.#onDirtyStateChange(false);
    }
  }

  /**
   * Take the server's word on the workflow's revision and permissions after a
   * save (the load path sets them with the payload). Bookkeeping only: no history entry, no dirty flag, no
   * change notification — the document the user edits is unchanged. Keys the
   * server did not send are left as they were.
   */
  acknowledgeServer(state: { revision?: Workflow['revision']; can?: Workflow['can'] }): void {
    if (!this.#workflow) return;
    this.#workflow = {
      ...this.#workflow,
      ...(state.revision !== undefined && { revision: state.revision }),
      ...(state.can !== undefined && { can: state.can })
    };
  }

  /**
   * Set the restoring from history flag.
   *
   * Used internally by the history store when performing undo/redo.
   */
  setRestoringFromHistory(restoring: boolean): void {
    this.#restoringFromHistory = restoring;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Bump the edit version and notify dirty state change if needed.
   * Called by every mutation action.
   */
  #bumpVersion(): void {
    this.#editVersion++;
    // Dirty state just flipped from clean → dirty
    if (this.#editVersion - 1 === this.#savedVersion) {
      if (this.#onDirtyStateChange) {
        this.#onDirtyStateChange(true);
      }
    }
  }

  /**
   * Notify external listeners of a workflow change.
   * Does NOT bump the version — callers that mutate must call #bumpVersion() explicitly.
   */
  #notifyWorkflowChange(changeType: WorkflowChangeType): void {
    if (this.#workflow && this.#onWorkflowChange) {
      this.#onWorkflowChange(this.#workflow, changeType);
    }
  }

  /**
   * Record the current (post-change) state to history.
   *
   * Call this AFTER mutating `#workflow` so the entry captures the new committed
   * state — the history stack's top is the live state, making one undo == one
   * change (see issue #39). Passing the pre-change state instead makes a single
   * undo skip a step once there are two or more sequential edits.
   *
   * @param description - Description of the change that was just made
   * @param workflow - Optional workflow to push (uses store state if not provided)
   */
  #pushToHistory(description?: string, workflow?: Workflow): void {
    if (!this.#historyEnabled || this.#restoringFromHistory) {
      return;
    }

    const workflowToPush = workflow ?? this.#workflow;
    if (workflowToPush) {
      this.#history.push(workflowToPush, { description });
    }
  }

  // -----------------------------------------------------------------------
  // Mutation actions
  // -----------------------------------------------------------------------

  /**
   * Initialize workflow (from load or new).
   *
   * This sets the initial saved snapshot, clears dirty state, and initializes history.
   */
  initialize(workflow: Workflow): void {
    this.#configEditKey = null;
    workflow = normalizeWorkflowMetadata(workflow);
    this.#workflow = workflow;
    // Reset version counters — workflow is "clean" after initialization
    this.#editVersion = 0;
    this.#savedVersion = 0;
    if (this.#onDirtyStateChange) {
      this.#onDirtyStateChange(false);
    }
    // Initialize history with the loaded workflow
    this.#history.initialize(workflow);
  }

  /**
   * Update the entire workflow.
   *
   * Note: This is typically called from SvelteFlow sync and should not push to history
   * for every small change. History is pushed by specific actions or drag handlers.
   */
  updateWorkflow(workflow: Workflow): void {
    this.#workflow = workflow;
    this.#bumpVersion();
    this.#notifyWorkflowChange('metadata');
  }

  /**
   * Restore workflow from history (undo/redo).
   *
   * This bypasses history recording to prevent recursive loops.
   */
  restoreFromHistory(workflow: Workflow): void {
    // Undo/redo supersedes any in-progress config edit; drop the session marker
    // (the history service already closed the transaction).
    this.#configEditKey = null;
    this.#restoringFromHistory = true;
    workflow = normalizeWorkflowMetadata(workflow);
    this.#workflow = workflow;
    this.#bumpVersion();
    this.#notifyWorkflowChange('metadata');
    this.#restoringFromHistory = false;
  }

  /** Update nodes. */
  updateNodes(nodes: WorkflowNode[]): void {
    if (!this.#workflow) return;

    // Check if nodes have actually changed to prevent infinite loops
    if (!hasWorkflowDataChanged(this.#workflow, nodes, this.#workflow.edges)) {
      return;
    }

    // Generate unique version identifier
    const versionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    this.#workflow = {
      ...this.#workflow,
      nodes,
      metadata: buildMetadata(this.#workflow.metadata, {
        versionId,
        updateNumber: (this.#workflow.metadata?.updateNumber ?? 0) + 1
      })
    };
    this.#bumpVersion();
    this.#notifyWorkflowChange('node_move');
  }

  /** Update edges. */
  updateEdges(edges: WorkflowEdge[]): void {
    if (!this.#workflow) return;

    // Check if edges have actually changed to prevent infinite loops
    if (!hasWorkflowDataChanged(this.#workflow, this.#workflow.nodes, edges)) {
      return;
    }

    // Generate unique version identifier
    const versionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    this.#workflow = {
      ...this.#workflow,
      edges,
      metadata: buildMetadata(this.#workflow.metadata, {
        versionId,
        updateNumber: (this.#workflow.metadata?.updateNumber ?? 0) + 1
      })
    };
    this.#bumpVersion();
    this.#notifyWorkflowChange('edge_add');
  }

  /** Update workflow name. */
  updateName(name: string): void {
    if (!this.#workflow) return;
    this.#workflow = {
      ...this.#workflow,
      name,
      metadata: buildMetadata(this.#workflow.metadata)
    };
    this.#bumpVersion();
    this.#notifyWorkflowChange('name');
  }

  /** Add a node. */
  addNode(node: WorkflowNode): void {
    if (!this.#workflow) return;
    this.#workflow = {
      ...this.#workflow,
      nodes: [...this.#workflow.nodes, node],
      metadata: buildMetadata(this.#workflow.metadata)
    };
    this.#pushToHistory('Add node');
    this.#bumpVersion();
    this.#notifyWorkflowChange('node_add');
  }

  /**
   * Remove a node.
   *
   * This is an atomic operation that also removes connected edges.
   * A single undo will restore both the node and its edges.
   */
  removeNode(nodeId: string): void {
    if (!this.#workflow) return;
    this.#workflow = {
      ...this.#workflow,
      nodes: this.#workflow.nodes.filter((node) => node.id !== nodeId),
      edges: this.#workflow.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId
      ),
      metadata: buildMetadata(this.#workflow.metadata)
    };
    this.#pushToHistory('Delete node');
    this.#bumpVersion();
    this.#notifyWorkflowChange('node_remove');
  }

  /** Add an edge. */
  addEdge(edge: WorkflowEdge): void {
    if (!this.#workflow) return;
    // Never append an edge whose id already exists — SvelteFlow keys edges by id
    // and a duplicate throws `each_key_duplicate`, taking down the canvas. Guard
    // before touching history so a no-op stays a no-op.
    if (this.#workflow.edges.some((e) => e.id === edge.id)) return;
    this.#workflow = {
      ...this.#workflow,
      edges: [...this.#workflow.edges, edge],
      metadata: buildMetadata(this.#workflow.metadata)
    };
    this.#pushToHistory('Add connection');
    this.#bumpVersion();
    this.#notifyWorkflowChange('edge_add');
  }

  /** Remove an edge. */
  removeEdge(edgeId: string): void {
    if (!this.#workflow) return;
    this.#workflow = {
      ...this.#workflow,
      edges: this.#workflow.edges.filter((edge) => edge.id !== edgeId),
      metadata: buildMetadata(this.#workflow.metadata)
    };
    this.#pushToHistory('Delete connection');
    this.#bumpVersion();
    this.#notifyWorkflowChange('edge_remove');
  }

  /**
   * Update a specific node.
   *
   * Used for config changes. Pushes to history for undo support.
   */
  updateNode(nodeId: string, updates: Partial<WorkflowNode>): void {
    if (!this.#workflow) return;
    this.#workflow = {
      ...this.#workflow,
      nodes: this.#workflow.nodes.map((node) =>
        node.id === nodeId ? { ...node, ...updates } : node
      ),
      metadata: buildMetadata(this.#workflow.metadata)
    };
    this.#pushToHistory('Update node config');
    this.#bumpVersion();
    this.#notifyWorkflowChange('node_config');
  }

  /**
   * Apply a live config edit to a node.
   *
   * Unlike {@link updateNode}, this is cheap enough to call on every keystroke:
   * it does NOT snapshot the workflow to history and does NOT fire the external
   * change event per call. Instead it opens (lazily) a single history
   * transaction for the field-editing session and defers the change event to
   * {@link finalizeNodeConfig}. Editing a different node or field first
   * finalizes the previous session, so undo granularity is one step per field.
   *
   * The store always reflects the latest value immediately (the mutation and
   * version bump happen here), so a save mid-session persists the current
   * value even if the session hasn't been finalized yet.
   *
   * @param nodeId - Node whose config is being edited
   * @param updates - Partial node updates (typically `{ data }`)
   * @param opts.fieldKey - The config field being edited; drives per-field
   *   session boundaries. Omit to treat the whole node as one session.
   */
  updateNodeConfig(
    nodeId: string,
    updates: Partial<WorkflowNode>,
    opts?: { fieldKey?: string }
  ): void {
    if (!this.#workflow) return;

    const sessionKey = `${nodeId}::${opts?.fieldKey ?? ''}`;
    // Moving to a different field/node closes the previous field's session.
    if (this.#configEditKey !== null && this.#configEditKey !== sessionKey) {
      this.finalizeNodeConfig();
    }
    // Open a transaction for this session on first touch. `push()` calls are
    // no-ops until it commits, so the per-keystroke edits below never clone.
    if (this.#configEditKey === null) {
      if (this.#historyEnabled && !this.#restoringFromHistory) {
        this.#history.startTransaction(this.#workflow, 'Update node config');
      }
      this.#configEditKey = sessionKey;
    }

    this.#workflow = {
      ...this.#workflow,
      nodes: this.#workflow.nodes.map((node) =>
        node.id === nodeId ? { ...node, ...updates } : node
      ),
      metadata: buildMetadata(this.#workflow.metadata)
    };
    this.#bumpVersion();
    // Deliberately no #pushToHistory (coalesced into the transaction) and no
    // #notifyWorkflowChange (deferred to finalize) — that is the whole point.
  }

  /**
   * Finalize the in-progress config-edit session, if any.
   *
   * Commits the session's history transaction (one undo step for the whole
   * session) and fires the external change event once. Idempotent: a no-op
   * when no session is open. Call on blur, panel close, node switch, and before
   * save. Undo/redo call this first (via the history facade / command dispatch)
   * so a session becomes a committed step before it is undone.
   */
  finalizeNodeConfig(changeType: WorkflowChangeType = 'node_config'): void {
    if (this.#configEditKey === null) return;
    this.#configEditKey = null;
    // A session can only be open when a workflow is loaded, so #workflow is
    // non-null here; commit its final (post-change) state as one undo step.
    if (this.#historyEnabled && this.#workflow) {
      this.#history.commitTransaction(this.#workflow);
    }
    this.#notifyWorkflowChange(changeType);
  }

  /**
   * Clear the workflow.
   *
   * Resets the workflow and clears history.
   */
  clear(): void {
    this.#configEditKey = null;
    this.#workflow = null;
    this.#editVersion = 0;
    this.#savedVersion = 0;
    this.#history.clear();
    if (this.#onDirtyStateChange) {
      this.#onDirtyStateChange(false);
    }
  }

  /** Update workflow metadata. */
  updateMetadata(metadata: Partial<Workflow['metadata']>): void {
    if (!this.#workflow) return;
    this.#workflow = {
      ...this.#workflow,
      metadata: buildMetadata(this.#workflow.metadata, metadata)
    };
    this.#bumpVersion();
    this.#notifyWorkflowChange('metadata');
  }

  /**
   * Batch update nodes and edges.
   *
   * Useful for complex operations that update multiple things at once.
   * Creates a single history entry for the entire batch.
   */
  batchUpdate(updates: {
    nodes?: WorkflowNode[];
    edges?: WorkflowEdge[];
    name?: string;
    description?: string;
    metadata?: Partial<Workflow['metadata']>;
    config?: Record<string, unknown>;
    interface?: Workflow['interface'];
  }): void {
    if (!this.#workflow) return;
    this.#workflow = {
      ...this.#workflow,
      ...(updates.nodes && { nodes: updates.nodes }),
      ...(updates.edges && { edges: updates.edges }),
      ...(updates.name && { name: updates.name }),
      ...(updates.description !== undefined && {
        description: updates.description
      }),
      ...(updates.config !== undefined && { config: updates.config }),
      // Keyed on presence, not on value: `undefined` is a meaningful interface —
      // "this workflow declares no contract" — so a caller clearing it must be
      // able to say so. Testing `!== undefined` silently dropped that update and
      // left the old contract in place.
      ...('interface' in updates && { interface: updates.interface }),
      metadata: buildMetadata(this.#workflow.metadata, updates.metadata ?? undefined)
    };
    this.#pushToHistory('Batch update');
    this.#bumpVersion();
    this.#notifyWorkflowChange('metadata');
  }

  /**
   * Swap a node — atomically replaces nodes and edges with a descriptive history entry.
   *
   * Unlike batchUpdate, this uses `"node_swap"` as the change type and
   * records a meaningful description for the undo history.
   */
  swapNode(updates: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    description?: string;
    oldNodeId?: string;
    newNodeId?: string;
    portMappings?: PortMapping[];
  }): void {
    if (!this.#workflow) return;
    // Node swap is the one mutation that actively moves interface bindings —
    // every other mutation (including delete) leaves them untouched.
    const interfaceAfterSwap =
      updates.oldNodeId && updates.newNodeId
        ? rewriteInterfaceBindings(
            this.#workflow.interface,
            updates.oldNodeId,
            updates.newNodeId,
            updates.portMappings ?? []
          )
        : this.#workflow.interface;
    this.#workflow = {
      ...this.#workflow,
      nodes: updates.nodes,
      edges: updates.edges,
      interface: interfaceAfterSwap,
      metadata: buildMetadata(this.#workflow.metadata)
    };
    this.#pushToHistory(updates.description ?? 'Swap node');
    this.#bumpVersion();
    this.#notifyWorkflowChange('node_swap');
  }

  /**
   * Push the current (post-change) state to history manually.
   *
   * Use this AFTER operations that modify the workflow through other means
   * (e.g., drag operations handled by SvelteFlow directly), passing the
   * resulting state so undo returns to the state before the operation.
   *
   * @param description - Description of the change that was just made
   * @param workflow - Optional workflow to push (uses store state if not provided)
   */
  pushHistory(description?: string, workflow?: Workflow): void {
    this.#pushToHistory(description, workflow);
  }
}
