<!--
  Workflow Editor Component
  Main workflow editor with sidebar and flow canvas
  Styled with BEM syntax
-->

<script lang="ts">
  import {
    SvelteFlow,
    ConnectionLineType,
    Controls,
    Background,
    BackgroundVariant,
    MiniMap,
    SvelteFlowProvider,
    type ColorMode
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import {
    getResolvedTheme,
    getEditorSettings,
    getBehaviorSettings
  } from '../stores/settingsStore.svelte.js';
  import type { WorkflowNode as WorkflowNodeType, Workflow, WorkflowEdge } from '../types/index.js';
  import CanvasBanner from './CanvasBanner.svelte';
  import CanvasController from './CanvasController.svelte';
  import FlowDropZone from './FlowDropZone.svelte';
  import EdgeRefresher from './EdgeRefresher.svelte';
  import { tick, untrack, onMount } from 'svelte';
  import type { EndpointConfig } from '../config/endpoints.js';
  import type { AuthProvider } from '../types/auth.js';
  import ConnectionLine from './ConnectionLine.svelte';
  import FlowDropEdge from './FlowDropEdge.svelte';
  import { m } from '$lib/messages/index.js';
  import { provideInstance } from '../stores/getInstance.svelte.js';
  import type { FlowDropInstance } from '../stores/instanceContainer.svelte.js';
  import type { FlowDropGridVariant } from '../types/theme.js';
  import UniversalNode from './UniversalNode.svelte';
  import {
    EdgeStylingHelper,
    NodeOperationsHelper,
    WorkflowOperationsHelper,
    ConfigurationHelper
  } from '../helpers/workflowEditorHelper.js';
  import type { NodeExecutionInfo } from '../types/index.js';
  import { Toaster } from 'svelte-5-french-toast';
  import {
    flowdropToastOptions,
    FLOWDROP_TOASTER_CLASS,
    apiToasts
  } from '../services/toastService.js';
  import {
    ProximityConnectHelper,
    type ProximityEdgeCandidate
  } from '../helpers/proximityConnect.js';
  import PortCoordinateTracker from './PortCoordinateTracker.svelte';
  import { logger } from '../utils/logger.js';
  import { validateWorkflowData } from '../utils/validation.js';
  import { suppressPortDragSelection } from '../utils/canvasSelection.js';
  import { createEditorStateMachine } from '../stores/editorStateMachine.svelte.js';
  import CanvasIconButton from '$lib/components/CanvasIconButton.svelte';
  import CommandLineIcon from '$lib/components/icons/CommandLineIcon.svelte';
  import { DEV } from 'esm-env';

  interface Props {
    endpointConfig?: EndpointConfig;
    /** Auth provider applied to this instance's API requests. */
    authProvider?: AuthProvider;
    openConfigSidebar?: (node: WorkflowNodeType) => void;
    /**
     * Editor interaction mode. `'edit'` allows node drag/connect/select and
     * proximity-connect; `'readonly'` and `'locked'` disable all canvas
     * editing (they behave identically today — see App's `mode` prop for the
     * full matrix). Replaces the former `readOnly` + `lockWorkflow` booleans.
     * @default 'edit'
     */
    mode?: 'edit' | 'readonly' | 'locked';
    // Pipeline ID for fetching node execution info from jobs
    pipelineId?: string;
    /**
     * Increments to force a re-fetch of node execution info from the server.
     * Used by parents (e.g. PipelineStatus) to push poll ticks / chat-message
     * arrivals down to the canvas without owning a separate status channel.
     */
    refreshTrigger?: number;
    // Console toggle
    consoleOpen?: boolean;
    onToggleConsole?: () => void;
    /** Label of the console-group toggle; defaults to the Command Console wording. */
    consoleToggleLabel?: string;
    /** Per-instance state container (created by mount functions). Defaults to the page-default instance. */
    instance?: FlowDropInstance;
    /**
     * Canvas background grid pattern. Supplied by App from the active theme's
     * `config.canvas.grid` default; any theme can opt into 'lines' / 'cross'.
     * Color is driven separately by the `--fd-grid-pattern-color` token.
     * @default 'dots'
     */
    gridVariant?: FlowDropGridVariant;
    /**
     * Register the built-in heavy form editors (markdown / code / template)
     * on this instance's field registry. Batteries-included by default — node
     * config fields with `format: 'markdown' | 'code' | 'template'` render real
     * CodeMirror editors. The chunks are code-split (loaded lazily here), so
     * the `/editor` static bundle stays light. Set `false` to keep the textarea
     * fallback or register your own field components. See `features.builtinEditors`.
     * @default true
     */
    builtinEditors?: boolean;
  }

  let props: Props = $props();

  // Resolve (and provide to children) the per-instance state container.
  // Must run during component init — provideInstance reads/sets Svelte context.
  // The instance never changes for a mounted component, so capturing it once is correct.
  // svelte-ignore state_referenced_locally
  const fd = provideInstance(props.instance);

  // Batteries-included: register the built-in heavy form editors (markdown /
  // code / template) on this instance's field registry so node config fields
  // render real editors out of the box. Dynamic import is deliberate — the
  // bundle guard only inspects *static* imports, and `form/markdown`/`form/code`
  // statically re-export their CodeMirror components, so a static import here
  // would leak CodeMirror into the light `/editor` entry. Importing lazily on
  // mount keeps the static graph clean while the chunks load on demand.
  // register*Field is idempotent per registry, so re-mounts are safe.
  onMount(() => {
    if (props.builtinEditors === false) return;
    void (async () => {
      const [code, markdown] = await Promise.all([
        import('../form/code.js'),
        import('../form/markdown.js')
      ]);
      code.registerCodeEditorField(fd.fields);
      code.registerTemplateEditorField(fd.fields);
      markdown.registerMarkdownEditorField(fd.fields);
    })();
  });

  // `mode` is the public API; the canvas only needs to know whether editing is
  // enabled. 'readonly' and 'locked' both disable interaction identically.
  const canvasEditable = $derived((props.mode ?? 'edit') === 'edit');

  // Canvas grid pattern, supplied by the active theme's config.canvas.grid
  // (App passes it down). BackgroundVariant's enum values are the same strings
  // ('dots' | 'lines' | 'cross'), so the theme config maps straight through.
  const gridVariant = $derived((props.gridVariant ?? 'dots') as BackgroundVariant);

  // ---------------------------------------------------------------------------
  // Editor State Machine
  // Centralizes reactive guards — replaces scattered boolean flags
  // (isDraggingNode, lastEditorStoreValue identity checks, etc.)
  // ---------------------------------------------------------------------------
  const machine = createEditorStateMachine();

  // Dev-mode transition logging
  if (DEV) {
    machine.onTransition((from, event, to) => {
      logger.debug(`[EditorFSM] ${from} --${event}--> ${to}`);
    });
  }

  // Proximity connect state
  let currentProximityCandidates = $state<ProximityEdgeCandidate[]>([]);

  // Port coordinate tracker state
  let portCoordNodeToUpdate = $state<WorkflowNodeType | null>(null);
  let portCoordRebuildTrigger = $state(0);

  // ---------------------------------------------------------------------------
  // Flow state — bound to SvelteFlow via bind:nodes / bind:edges
  // These are $state.raw to prevent deep proxy leaking (SvelteFlow mutates
  // node internals during drag which would cause infinite loops with $state).
  // ---------------------------------------------------------------------------
  let flowNodes = $state.raw<WorkflowNodeType[]>([]);
  let flowEdges = $state.raw<WorkflowEdge[]>([]);

  // Execution info loading state
  let loadExecutionInfoTimeout: number | null = null;
  let executionInfoAbortController: AbortController | null = null;

  /**
   * Key for SvelteFlow component — changes when workflow ID changes.
   * Forces SvelteFlow to remount with fresh state, allowing fitView to work correctly.
   */
  let svelteFlowKey = $derived(fd.workflow.current?.id ?? 'default');

  /**
   * Derive snap grid configuration from editor settings
   */
  let snapGrid = $derived(
    getEditorSettings().snapToGrid
      ? ([getEditorSettings().gridSize, getEditorSettings().gridSize] as [number, number])
      : undefined
  );

  /**
   * Derive initial viewport configuration from editor settings
   */
  let initialViewport = $derived({
    zoom: getEditorSettings().defaultZoom,
    x: 0,
    y: 0
  });

  // ---------------------------------------------------------------------------
  // Helper: derive flowNodes/flowEdges from a Workflow object
  // ---------------------------------------------------------------------------
  function buildFlowNodesFromStore(workflow: Workflow): {
    nodes: WorkflowNodeType[];
    edges: WorkflowEdge[];
  } {
    const nodesWithCallbacks = workflow.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        onConfigOpen: props.openConfigSidebar
      }
    }));
    const styledEdges = EdgeStylingHelper.updateEdgeStyles(workflow.edges, nodesWithCallbacks);
    return { nodes: nodesWithCallbacks, edges: styledEdges };
  }

  // ---------------------------------------------------------------------------
  // Helper: sync current flowNodes/flowEdges back to the global store
  // ---------------------------------------------------------------------------
  function syncFlowToStore(): void {
    const storeValue = untrack(() => fd.workflow.current);
    if (!storeValue) return;
    const updatedWorkflow = WorkflowOperationsHelper.updateWorkflow(
      storeValue,
      flowNodes,
      flowEdges
    );
    fd.workflow.updateWorkflow(updatedWorkflow);
  }

  // ---------------------------------------------------------------------------
  // Single sync effect: workflowStore → flowNodes / flowEdges
  // Replaces the old Effect A (store→currentWorkflow) + Effect B (currentWorkflow→flow).
  // Suppressed during operations via state machine; handlers update flowNodes directly.
  // ---------------------------------------------------------------------------
  let previousSyncedWorkflowId: string | null = null;

  $effect(() => {
    const storeValue = fd.workflow.current;

    // Suppressed during operations — handlers write to flowNodes directly
    if (untrack(() => machine.permissions.suppressEffect)) return;

    if (!storeValue) {
      if (flowNodes.length > 0 || flowEdges.length > 0) {
        flowNodes = [];
        flowEdges = [];
        previousSyncedWorkflowId = null;
        untrack(() => machine.send('WORKFLOW_CLEARED'));
      }
      return;
    }

    const isNewWorkflow = storeValue.id !== previousSyncedWorkflowId;

    if (isNewWorkflow) {
      untrack(() =>
        machine.send(previousSyncedWorkflowId ? 'WORKFLOW_SWITCHED' : 'WORKFLOW_LOADED')
      );
    }

    // Derive flowNodes/flowEdges from store
    const derived = buildFlowNodesFromStore(storeValue);
    flowNodes = derived.nodes;
    flowEdges = derived.edges;
    previousSyncedWorkflowId = storeValue.id;

    // Trigger port coordinate rebuild after workflow load
    if (getEditorSettings().proximityConnect) {
      portCoordRebuildTrigger = Date.now();
    }

    if (isNewWorkflow) {
      untrack(() => machine.send('LOAD_COMPLETE'));
    }
  });

  // ---------------------------------------------------------------------------
  // Execution info effect (separate — async, depends on workflow + pipeline ID)
  // ---------------------------------------------------------------------------
  let previousExecWorkflowId: string | null = null;
  let previousExecPipelineId: string | undefined = undefined;

  $effect(() => {
    const storeValue = fd.workflow.current;
    const pipelineId = props.pipelineId;

    if (!storeValue || !pipelineId) return;

    const workflowChanged = storeValue.id !== previousExecWorkflowId;
    const pipelineChanged = pipelineId !== previousExecPipelineId;

    if (!workflowChanged && !pipelineChanged) return;

    previousExecWorkflowId = storeValue.id;
    previousExecPipelineId = pipelineId;

    // Cancel any pending idle/timeout schedule. In-flight fetches are
    // cancelled by loadNodeExecutionInfo() itself when it's re-entered.
    if (loadExecutionInfoTimeout) {
      clearTimeout(loadExecutionInfoTimeout);
      loadExecutionInfoTimeout = null;
    }

    // Schedule loading with requestIdleCallback (falls back to setTimeout)
    if (typeof requestIdleCallback !== 'undefined') {
      loadExecutionInfoTimeout = requestIdleCallback(
        () => {
          loadNodeExecutionInfo();
        },
        { timeout: 500 }
      ) as unknown as number;
    } else {
      loadExecutionInfoTimeout = setTimeout(() => {
        loadNodeExecutionInfo();
      }, 300) as unknown as number;
    }
  });

  // Re-fetch node execution info when the parent bumps refreshTrigger
  // (poll ticks, chat-message arrivals, manual refresh). loadNodeExecutionInfo()
  // is the single writer of executionInfo on flowNodes — no parallel channel.
  // svelte-ignore state_referenced_locally
  let _prevExecRefreshTrigger = props.refreshTrigger ?? 0;
  $effect(() => {
    const t = props.refreshTrigger ?? 0;
    if (t === 0 || t === _prevExecRefreshTrigger) return;
    _prevExecRefreshTrigger = t;
    loadNodeExecutionInfo();
  });

  // ---------------------------------------------------------------------------
  // History restore callback
  // ---------------------------------------------------------------------------
  $effect(() => {
    fd.historyBindings.setOnRestoreCallback((restoredWorkflow: Workflow) => {
      machine.send('START_RESTORE');
      // Update the store (effect is suppressed during 'restoring')
      fd.workflow.restoreFromHistory(restoredWorkflow);
      // Derive flowNodes/flowEdges directly for immediate visual update
      const derived = buildFlowNodesFromStore(restoredWorkflow);
      flowNodes = derived.nodes;
      flowEdges = derived.edges;
      machine.send('RESTORE_COMPLETE');
      // After RESTORE_COMPLETE → idle, the sync effect runs but produces
      // the same data (no-op re-derive).
    });

    return () => {
      // Reinstate the container's default wiring rather than nulling it: the
      // default instance survives unmount, and a bare null would make legacy
      // historyActions.undo() silently restore nothing afterwards.
      fd.historyBindings.setOnRestoreCallback((restored: Workflow) =>
        fd.workflow.restoreFromHistory(restored)
      );
    };
  });

  /**
   * Load node execution information for all nodes in the workflow.
   * Cancels any in-flight fetch so concurrent callers (pipelineId change
   * and refreshTrigger bumps) can't race on flowNodes.
   */
  async function loadNodeExecutionInfo(): Promise<void> {
    const workflow = untrack(() => fd.workflow.current);
    if (!workflow?.nodes || !props.pipelineId) return;

    if (executionInfoAbortController) {
      executionInfoAbortController.abort();
    }
    const controller = new AbortController();
    executionInfoAbortController = controller;

    try {
      const executionInfo = await NodeOperationsHelper.loadNodeExecutionInfo(
        fd.api,
        workflow,
        props.pipelineId
      );

      if (controller.signal.aborted) return;

      const defaultExecutionInfo: NodeExecutionInfo = {
        status: 'idle' as const,
        executionCount: 0,
        isExecuting: false
      };

      // Update flowNodes with execution info (visual-only, no store sync needed)
      flowNodes = flowNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          executionInfo: executionInfo[node.id] || defaultExecutionInfo
        }
      }));

      if (executionInfoAbortController === controller) {
        executionInfoAbortController = null;
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        logger.error('Failed to load node execution info:', error);
      }
    }
  }

  // The global store should be initialized by the parent App component

  // Sidebar is now always visible - removed toggle functionality

  // Node types for Svelte Flow - using UniversalNode for all node types
  // All nodes use 'universalNode' type, and UniversalNode handles internal switching
  const nodeTypes = {
    universalNode: UniversalNode
  };

  // Use custom edge that shortens the path so the stroke ends at the arrow base
  const edgeTypes = {
    default: FlowDropEdge
  };

  // Handle arrows in our custom connection handler
  const defaultEdgeOptions = {};

  /**
   * Handle node drag start
   *
   * Transitions the state machine to 'dragging', which suppresses
   * the sync effect to prevent reactive loops during high-frequency
   * position updates. SvelteFlow mutates flowNodes directly via bind:nodes.
   */
  function handleNodeDragStart(): void {
    machine.send('START_DRAG');
    // Clear any leftover proximity previews
    currentProximityCandidates = [];
  }

  /**
   * Handle node drag - compute proximity connect preview edges
   * Called continuously during drag if proximity connect is enabled.
   * Uses port-to-port distance via the port coordinate store.
   */
  function handleNodeDrag({
    targetNode
  }: {
    targetNode: WorkflowNodeType | null;
    nodes: WorkflowNodeType[];
    event: MouseEvent | TouchEvent;
  }): void {
    if (!getEditorSettings().proximityConnect || !targetNode || !canvasEditable) {
      if (currentProximityCandidates.length > 0) {
        flowEdges = ProximityConnectHelper.removePreviewEdges(flowEdges);
        currentProximityCandidates = [];
      }
      portCoordNodeToUpdate = null;
      return;
    }

    // Update the dragged node's port coordinates (position changed during drag)
    portCoordNodeToUpdate = targetNode;

    // Remove previous preview edges
    const baseEdges = ProximityConnectHelper.removePreviewEdges(flowEdges);

    // Find the best compatible edge using port-to-port distance
    const portCoordinates = fd.portCoordinates.coordinates;
    const candidates =
      portCoordinates.size > 0
        ? ProximityConnectHelper.findCompatibleEdgesByPortCoordinates(
            fd.portCompatibility,
            targetNode.id,
            portCoordinates,
            baseEdges,
            getEditorSettings().proximityConnectDistance
          )
        : ProximityConnectHelper.findCompatibleEdges(
            fd.portCompatibility,
            targetNode,
            flowNodes,
            baseEdges,
            getEditorSettings().proximityConnectDistance
          );

    // Create preview edges
    const previews = ProximityConnectHelper.createPreviewEdges(candidates);

    // Update state
    currentProximityCandidates = candidates;
    flowEdges = [...baseEdges, ...previews];
  }

  /**
   * Handle node drag stop
   *
   * Still in 'dragging' state — sync effect suppressed.
   * Syncs final positions to store, pushes history, then transitions to idle.
   */
  function handleNodeDragStop(): void {
    portCoordNodeToUpdate = null;

    // Finalize proximity connect if there are candidates
    if (getEditorSettings().proximityConnect && currentProximityCandidates.length > 0) {
      const baseEdges = ProximityConnectHelper.removePreviewEdges(flowEdges);
      const permanentEdges = ProximityConnectHelper.createPermanentEdges(
        currentProximityCandidates
      );

      for (const edge of permanentEdges) {
        const sourceNode = flowNodes.find((n) => n.id === edge.source);
        const targetNode = flowNodes.find((n) => n.id === edge.target);
        if (sourceNode && targetNode) {
          EdgeStylingHelper.applyConnectionStyling(edge, sourceNode, targetNode);
        }
      }

      flowEdges = [...baseEdges, ...permanentEdges];
      currentProximityCandidates = [];
    }

    // Sync flowNodes/flowEdges → store
    syncFlowToStore();

    // Push history AFTER the drag completed
    const storeValue = fd.workflow.current;
    if (storeValue) {
      fd.workflow.pushHistory('Move node', storeValue);
    }

    // Transition to idle — sync effect is now unblocked
    machine.send('STOP_DRAG');
  }

  /**
   * Handle new connections between nodes.
   * The connection details aren't needed — SvelteFlow auto-creates the edge
   * via bind:edges; this only drives the state machine and history snapshot.
   */
  async function handleConnect(): Promise<void> {
    machine.send('START_CONNECT');

    // SvelteFlow auto-creates the edge via bind:edges — wait for DOM update
    await tick();

    // Apply styling to all edges (including the new one)
    flowEdges = EdgeStylingHelper.updateEdgeStyles(flowEdges, flowNodes);

    // Sync to store
    syncFlowToStore();

    const storeValue = fd.workflow.current;
    if (storeValue) {
      fd.workflow.pushHistory('Add connection', storeValue);
    }

    machine.send('CONNECTION_MADE');
  }

  /**
   * Handle before delete - show confirmation dialog if enabled in settings
   *
   * This callback is called before nodes/edges are deleted.
   * Return true to proceed with deletion, false to cancel.
   *
   * @param params - Object containing nodes and edges to be deleted
   * @returns Promise resolving to true if deletion should proceed, false to cancel
   */
  async function handleBeforeDelete(params: {
    nodes: WorkflowNodeType[];
    edges: WorkflowEdge[];
  }): Promise<boolean> {
    // If confirmDelete setting is enabled, show confirmation dialog
    if (getBehaviorSettings().confirmDelete) {
      const nodeCount = params.nodes.length;
      const edgeCount = params.edges.length;

      // Build a descriptive message
      let message = 'Are you sure you want to delete ';
      const parts: string[] = [];

      if (nodeCount > 0) {
        parts.push(`${nodeCount} node${nodeCount > 1 ? 's' : ''}`);
      }
      if (edgeCount > 0) {
        parts.push(`${edgeCount} connection${edgeCount > 1 ? 's' : ''}`);
      }

      message += parts.join(' and ') + '?';

      // Show native confirmation dialog
      const confirmed = window.confirm(message);
      if (!confirmed) {
        return false;
      }
    }

    // Don't push to history here - we'll push AFTER deletion in handleNodesDelete
    // This ensures undo will restore the state before deletion
    return true;
  }

  /**
   * Handle node deletion - automatically remove connected edges and push to history
   */
  function handleNodesDelete(params: { nodes: WorkflowNodeType[]; edges: WorkflowEdge[] }): void {
    machine.send('START_DELETE');

    const deletedNodeIds = new Set(params.nodes.map((node) => node.id));

    // Filter out edges connected to deleted nodes
    flowEdges = flowEdges.filter(
      (edge) => !deletedNodeIds.has(edge.source) && !deletedNodeIds.has(edge.target)
    );

    // Sync to store
    syncFlowToStore();

    // Push to history AFTER the deletion so undo restores the previous state
    const nodeCount = params.nodes.length;
    const edgeCount = params.edges.length;
    let description = 'Delete';
    if (nodeCount > 0 && edgeCount > 0) {
      description = `Delete ${nodeCount} node${nodeCount > 1 ? 's' : ''} and ${edgeCount} connection${edgeCount > 1 ? 's' : ''}`;
    } else if (nodeCount > 0) {
      description = `Delete ${nodeCount} node${nodeCount > 1 ? 's' : ''}`;
    } else if (edgeCount > 0) {
      description = `Delete ${edgeCount} connection${edgeCount > 1 ? 's' : ''}`;
    }
    const storeValue = fd.workflow.current;
    if (storeValue) {
      fd.workflow.pushHistory(description, storeValue);
    }

    machine.send('DELETE_COMPLETE');
  }

  // Edge styling will be handled when edges are first created or manually updated

  // Configure endpoints when props change
  $effect(() => {
    if (props.endpointConfig) {
      ConfigurationHelper.configureEndpoints(fd.api, props.endpointConfig, props.authProvider);
    }
  });

  /**
   * Cached cycle check — skips DFS during drag/connect via FSM suppressEffect guard.
   * $derived deduplicates the boolean result so the template only re-renders on change.
   */
  let hasCycles = $derived.by(() => {
    if (machine.permissions.suppressEffect) return false;
    return WorkflowOperationsHelper.checkWorkflowCycles(flowNodes, flowEdges);
  });

  /**
   * Handle drop event and add new node to canvas
   */
  async function handleNodeDrop(
    nodeTypeData: string,
    position: { x: number; y: number }
  ): Promise<void> {
    machine.send('START_DROP');

    const newNode = NodeOperationsHelper.createNodeFromDrop(nodeTypeData, position, flowNodes);

    if (newNode) {
      // Add onConfigOpen callback and append to flowNodes for immediate visual feedback
      const nodeWithCallback = {
        ...newNode,
        data: { ...newNode.data, onConfigOpen: props.openConfigSidebar }
      };
      flowNodes = [...flowNodes, nodeWithCallback];

      // Sync to store
      syncFlowToStore();

      await tick();

      const storeValue = fd.workflow.current;
      if (storeValue) {
        fd.workflow.pushHistory('Add node', storeValue);
      }
    } else {
      logger.warn('Failed to create node from drop data');
    }

    machine.send('DROP_COMPLETE');
  }

  /**
   * Handle a workflow JSON file dropped directly onto the canvas.
   *
   * Validates the JSON against the minimum required Workflow fields and, if valid,
   * loads it into the workflow store. Shows a toast on validation failure or read error.
   */
  function handleWorkflowFileDrop(file: File): void {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result;
        if (typeof text !== 'string') {
          throw new Error('Could not read file contents.');
        }
        const data = JSON.parse(text);
        const validation = validateWorkflowData(data);
        if (!validation.valid) {
          apiToasts.error('Import workflow', validation.error ?? 'Invalid workflow JSON');
          logger.warn('Workflow file drop validation failed:', validation.error);
          return;
        }
        fd.workflow.initialize(data as Workflow);
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error('Unknown error occurred');
        logger.error('Workflow file drop import failed:', errorObj);
        apiToasts.error('Import workflow', errorObj);
      }
    };
    reader.onerror = () => {
      const message = 'Failed to read the dropped file.';
      logger.error(message);
      apiToasts.error('Import workflow', message);
    };
    reader.readAsText(file);
  }

  /**
   * Node ID that needs edge refresh - used to trigger EdgeRefresher component
   */
  let nodeIdToRefresh = $state<string | null>(null);

  // Canvas viewport controller ref (rendered inside SvelteFlowProvider)
  let canvasControllerRef: CanvasController | undefined = $state();

  /**
   * Update a node's data in the local editor state.
   * Called by App.svelte AFTER it has already updated the global store via
   * fd.workflow.updateNode(). We only need to update flowNodes for
   * immediate visual feedback — no store sync needed.
   *
   * @param nodeId - The ID of the node to update
   * @param dataUpdates - Partial data updates to merge into the node's data
   */
  export function updateNodeData(
    nodeId: string,
    dataUpdates: Partial<WorkflowNodeType['data']>
  ): void {
    machine.send('START_NODE_UPDATE');

    flowNodes = flowNodes.map((node) => {
      if (node.id === nodeId) {
        return {
          ...node,
          data: {
            ...node.data,
            ...dataUpdates
          }
        };
      }
      return node;
    });

    machine.send('UPDATE_COMPLETE');
  }

  /**
   * Force edge position recalculation after node config changes
   * This should be called after saving gateway/switch node configs where branches are reordered
   * Svelte Flow doesn't automatically recalculate edge paths when handle positions change
   * @param nodeId - The ID of the node whose handles have changed position
   */
  export async function refreshEdgePositions(nodeId: string): Promise<void> {
    // Wait for DOM to update with new handle positions
    await tick();

    // Trigger the EdgeRefresher component to call updateNodeInternals
    nodeIdToRefresh = nodeId;
  }

  // Canvas viewport methods (forwarded to CanvasController inside SvelteFlowProvider)

  export function canvasFitView(): void {
    canvasControllerRef?.canvasFitView();
  }

  export function canvasZoomIn(): void {
    canvasControllerRef?.canvasZoomIn();
  }

  export function canvasZoomOut(): void {
    canvasControllerRef?.canvasZoomOut();
  }

  export function canvasZoomTo(level: number): void {
    canvasControllerRef?.canvasZoomTo(level);
  }

  export function canvasPanTo(x: number, y: number): void {
    canvasControllerRef?.canvasPanTo(x, y);
  }

  export function canvasResetView(): void {
    canvasControllerRef?.canvasResetView();
  }

  /**
   * Callback when edge refresh is complete
   */
  function handleEdgeRefreshComplete(): void {
    nodeIdToRefresh = null;
  }

  /**
   * Handle keyboard shortcuts for undo/redo
   *
   * - Ctrl+Z (or Cmd+Z on Mac): Undo
   * - Ctrl+Shift+Z (or Cmd+Shift+Z): Redo
   * - Ctrl+Y (or Cmd+Y): Redo (Windows convention)
   *
   * Also suppresses WebKit's legacy default action for Backspace outside
   * editable content — history back-navigation. SvelteFlow's KeyHandler
   * deletes the selected elements on Backspace but never preventDefaults,
   * so in embedded WebKit the page navigates away mid-delete. Scoped to
   * keydowns originating inside the flow canvas so host-page behavior
   * outside the editor is untouched.
   */
  function handleKeydown(event: KeyboardEvent): void {
    // Don't handle shortcuts if user is typing in an input, textarea, or contenteditable
    const target = event.target as HTMLElement;
    const isInputElement =
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    if (isInputElement) {
      return;
    }

    // Backspace/Delete on a canvas element: let SvelteFlow handle the
    // deletion, but block the browser default (WebKit navigates back).
    if ((event.key === 'Backspace' || event.key === 'Delete') && target.closest('.svelte-flow')) {
      event.preventDefault();
      return;
    }

    // Check for Ctrl (Windows/Linux) or Cmd (Mac)
    const isModifierPressed = event.ctrlKey || event.metaKey;

    if (!isModifierPressed) {
      return;
    }

    // Undo: Ctrl+Z (without Shift)
    if (event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      fd.historyBindings.undo();
      return;
    }

    // Redo: Ctrl+Shift+Z or Ctrl+Y
    if ((event.key === 'z' && event.shiftKey) || event.key === 'y') {
      event.preventDefault();
      fd.historyBindings.redo();
      return;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<SvelteFlowProvider>
  <!-- Canvas viewport controller - provides fitView, zoom, pan methods -->
  <CanvasController bind:this={canvasControllerRef} />

  <!-- EdgeRefresher component - handles updateNodeInternals calls -->
  <EdgeRefresher {nodeIdToRefresh} onRefreshComplete={handleEdgeRefreshComplete} />

  <!-- Port Coordinate Tracker - maintains port positions for proximity connect -->
  <PortCoordinateTracker
    nodeToUpdate={portCoordNodeToUpdate}
    rebuildTrigger={portCoordRebuildTrigger}
    nodes={flowNodes}
  />

  <div class="flowdrop-workflow-editor">
    <!-- Main Editor Area -->
    <div class="flowdrop-workflow-editor__main">
      <!-- Flow Canvas.
           Capture-phase mousedown so dragging from a port never turns into a
           WebKit text-selection drag — see suppressPortDragSelection. -->
      <div class="flowdrop-canvas" onmousedowncapture={suppressPortDragSelection}>
        <FlowDropZone ondrop={handleNodeDrop} onfiledrop={handleWorkflowFileDrop}>
          {#key svelteFlowKey}
            <SvelteFlow
              id={fd.id}
              bind:nodes={flowNodes}
              bind:edges={flowEdges}
              {nodeTypes}
              {edgeTypes}
              {defaultEdgeOptions}
              onconnect={() => void handleConnect()}
              onbeforedelete={handleBeforeDelete}
              ondelete={handleNodesDelete}
              onnodedragstart={handleNodeDragStart}
              onnodedrag={handleNodeDrag}
              onnodedragstop={handleNodeDragStop}
              minZoom={0.2}
              maxZoom={3}
              clickConnect={true}
              elevateEdgesOnSelect={true}
              connectionLineType={ConnectionLineType.Bezier}
              connectionLineComponent={ConnectionLine}
              {snapGrid}
              {initialViewport}
              colorMode={getResolvedTheme() as ColorMode}
              fitView={getEditorSettings().fitViewOnLoad}
              nodesDraggable={canvasEditable}
              nodesConnectable={canvasEditable}
              elementsSelectable={canvasEditable}
            >
              <Controls />
              {#if canvasEditable && props.onToggleConsole}
                <CanvasIconButton
                  class="flowdrop-console-toggle"
                  label={props.consoleToggleLabel ?? m().layout.commandConsole}
                  active={props.consoleOpen}
                  onclick={props.onToggleConsole}
                >
                  {#snippet icon()}
                    <CommandLineIcon />
                  {/snippet}
                </CanvasIconButton>
              {/if}
              <!-- Always render Background for consistent bg color in dark/light mode -->
              <Background
                gap={getEditorSettings().gridSize}
                bgColor="var(--fd-canvas-bg)"
                variant={gridVariant}
                lineWidth={1}
                patternColor={getEditorSettings().showGrid
                  ? 'var(--fd-grid-pattern-color)'
                  : 'transparent'}
              />
              {#if getEditorSettings().showMinimap}
                <MiniMap />
              {/if}
            </SvelteFlow>
          {/key}
          <!-- Drop Zone Indicator -->
          {#if flowNodes.length === 0}
            <CanvasBanner
              title="Drag components here to start building"
              description="Use the sidebar to add components to your workflow"
            >
              {#snippet icon()}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="1em"
                  height="1em"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
              {/snippet}
            </CanvasBanner>
          {/if}
        </FlowDropZone>
      </div>

      <!-- Status Bar: aria-live announces dynamic changes (node/edge counts, cycle warnings) -->
      <div class="flowdrop-status-bar" aria-live="polite" aria-atomic="true">
        <div class="flowdrop-status-bar__content">
          <div class="flowdrop-flex flowdrop-gap--4">
            <span class="flowdrop-text--xs flowdrop-text--gray">{flowNodes.length} nodes</span>
            <span class="flowdrop-text--xs flowdrop-text--gray">•</span>
            <span class="flowdrop-text--xs flowdrop-text--gray">{flowEdges.length} connections</span
            >

            {#if hasCycles}
              <span class="flowdrop-text--xs flowdrop-text--gray">•</span>
              <span class="flowdrop-text--xs flowdrop-font--medium flowdrop-text--error"
                >⚠️ Cycles detected</span
              >
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
</SvelteFlowProvider>

<!-- Toast notifications container -->
<!-- aria-live="polite" ensures screen readers announce toast messages without interrupting -->
<div aria-live="polite" aria-atomic="true">
  <Toaster
    position="bottom-center"
    containerClassName={FLOWDROP_TOASTER_CLASS}
    toastOptions={flowdropToastOptions}
  />
</div>

<style>
  .flowdrop-workflow-editor {
    display: flex;
    flex-direction: row; /* Side by side layout */
    height: 100%;
    position: relative;
  }

  .flowdrop-workflow-editor__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    transition: margin-left 0.3s ease-in-out;
  }

  .flowdrop-text--error {
    color: var(--fd-error);
  }

  .flowdrop-canvas {
    flex: 1;
    min-height: 0;
    position: relative;
    background: transparent;
  }

  .flowdrop-status-bar {
    background-color: var(--fd-backdrop);
    backdrop-filter: var(--fd-backdrop-blur);
    border-top: 1px solid var(--fd-border);
    padding: 0.75rem;
    height: 40px;
    min-height: 40px;
    max-height: 40px;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .flowdrop-status-bar__content {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  /* Console toggle — placement only; visuals live in CanvasIconButton */
  :global(.flowdrop-console-toggle) {
    bottom: 140px;
    left: 12px;
    z-index: 5;
  }

  :global(.flowdrop-workflow-editor .svelte-flow__node:hover) {
    transform: translateY(-2px);
  }

  :global(.flowdrop-workflow-editor .svelte-flow__edge) {
    stroke-width: 2 !important;
    cursor: pointer;
    pointer-events: all;
  }

  :global(.flowdrop-workflow-editor .svelte-flow__edge path) {
    stroke-width: 2 !important;
  }

  :global(.flowdrop-workflow-editor .svelte-flow__edge:hover) {
    stroke: var(--fd-primary) !important;
    stroke-width: 3 !important;
  }

  :global(.flowdrop-workflow-editor .svelte-flow__edge:hover path) {
    stroke-width: 3 !important;
  }

  :global(.flowdrop-workflow-editor .svelte-flow__edge.selected) {
    stroke: var(--fd-primary) !important;
    stroke-width: 3 !important;
    filter: drop-shadow(0 0 4px color-mix(in srgb, var(--fd-primary) 50%, transparent));
  }

  :global(.flowdrop-workflow-editor .svelte-flow__edge.selected path) {
    stroke-width: 3 !important;
  }

  /* Ensure edge paths are clickable */
  :global(.flowdrop-workflow-editor .svelte-flow__edge path) {
    pointer-events: all;
    cursor: pointer;
  }

  /* Handle size/position only; colors come from inline --fd-handle-fill and base.css ::before */
  :global(.flowdrop-workflow-editor .svelte-flow__handle) {
    width: var(--fd-handle-size);
    height: var(--fd-handle-size);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    z-index: 20;
  }

  /* Ensure our custom handles are clickable */
  :global(.flowdrop-workflow-editor .svelte-flow__handle) {
    pointer-events: all;
    cursor: crosshair;
    background-color: var(--fd-handle-fill);
    border-color: var(--fd-handle-border-color);
  }

  /**
	 * Edge Styling Based on Source Port Data Type
	 * Uses CSS tokens from base.css for consistent theming
	 * - Trigger edges: solid dark line (control flow)
	 * - Tool edges: dashed amber line (tool connections)
	 * - Data edges: normal gray line (data flow)
	 */

  /* Trigger Edge: Solid dark line for control flow */
  :global(.flowdrop--edge--trigger path.svelte-flow__edge-path) {
    stroke: var(--fd-edge-trigger);
    stroke-width: var(--fd-edge-trigger-width);
  }

  :global(.flowdrop--edge--trigger:hover path.svelte-flow__edge-path) {
    stroke: var(--fd-edge-trigger-hover);
    stroke-width: var(--fd-edge-trigger-width-hover);
  }

  :global(.flowdrop--edge--trigger.selected path.svelte-flow__edge-path) {
    stroke: var(--fd-edge-trigger-selected);
    stroke-width: var(--fd-edge-trigger-width-hover);
  }

  /* Tool Edge: Dashed amber line for tool connections */
  :global(.flowdrop--edge--tool path.svelte-flow__edge-path) {
    stroke: var(--fd-edge-tool);
    stroke-dasharray: 5 3;
  }

  :global(.flowdrop--edge--tool:hover path.svelte-flow__edge-path) {
    stroke: var(--fd-edge-tool-hover);
    stroke-width: 2;
  }

  :global(.flowdrop--edge--tool.selected path.svelte-flow__edge-path) {
    stroke: var(--fd-edge-tool-selected);
    stroke-dasharray: 5 3;
    stroke-width: 2;
  }

  /* Data Edge: Normal gray line for data flow (default) */
  :global(.flowdrop--edge--data path.svelte-flow__edge-path) {
    stroke: var(--fd-edge-data);
  }

  :global(.flowdrop--edge--data:hover path.svelte-flow__edge-path) {
    stroke: var(--fd-edge-data-hover);
    stroke-width: 2;
  }

  :global(.flowdrop--edge--data.selected path.svelte-flow__edge-path) {
    stroke: var(--fd-edge-data-selected);
    stroke-width: 2;
  }

  /* Loopback Edge: Dashed gray line for loop iteration connections */
  :global(.flowdrop--edge--loopback path.svelte-flow__edge-path) {
    stroke: var(--fd-edge-loopback);
    stroke-width: var(--fd-edge-loopback-width);
    stroke-dasharray: var(--fd-edge-loopback-dasharray);
    opacity: var(--fd-edge-loopback-opacity);
  }

  :global(.flowdrop--edge--loopback:hover path.svelte-flow__edge-path) {
    stroke: var(--fd-edge-loopback-hover);
    stroke-width: var(--fd-edge-loopback-width-hover);
    opacity: 1;
  }

  :global(.flowdrop--edge--loopback.selected path.svelte-flow__edge-path) {
    stroke: var(--fd-edge-loopback-selected);
    stroke-width: var(--fd-edge-loopback-width-hover);
    stroke-dasharray: var(--fd-edge-loopback-dasharray);
    filter: drop-shadow(0 0 3px rgba(139, 92, 246, 0.4));
    opacity: 1;
  }

  /* Proximity Connect Preview Edge: animated dashed line */
  :global(.flowdrop--edge--proximity-preview path.svelte-flow__edge-path) {
    stroke: var(--fd-primary);
    stroke-width: 2;
    stroke-dasharray: 5 5;
    opacity: 0.6;
    animation: flowdrop-proximity-dash 0.5s linear infinite;
  }

  @keyframes flowdrop-proximity-dash {
    to {
      stroke-dashoffset: -10;
    }
  }
</style>
