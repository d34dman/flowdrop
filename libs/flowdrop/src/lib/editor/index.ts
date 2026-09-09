/**
 * FlowDrop Editor Module
 *
 * Provides the WorkflowEditor component and related functionality for
 * building visual workflow editors. This module includes @xyflow/svelte
 * and all node components.
 *
 * **Multi-instance support.** Each mount gets its own `FlowDropInstance`
 * state container (workflow, undo/redo, playground, …), so multiple editors
 * can coexist on one page. Pass `instanceId` to the mount options to scope
 * draft/panel storage keys per editor; in Svelte, pass `instance` to <App>
 * or resolve it in components via `getInstance()`. State is addressed through
 * the instance — there is no page-default module-level store API.
 * Page-global by design: theme/settings, port-compatibility config, and API
 * endpoint config.
 *
 * @module editor
 *
 * @example Mounting a standalone workflow editor:
 * ```typescript
 * import { mountFlowDropApp, WorkflowEditor } from "@flowdrop/flowdrop/editor";
 * import "@flowdrop/flowdrop/styles";
 *
 * const app = await mountFlowDropApp(document.getElementById("editor"), {
 *   workflow: myWorkflow,
 *   nodes: availableNodes
 * });
 * ```
 *
 * @example Using WorkflowEditor in Svelte:
 * ```svelte
 * <script>
 *   import { WorkflowEditor } from "@flowdrop/flowdrop/editor";
 * </script>
 *
 * <WorkflowEditor nodes={availableNodes} />
 * ```
 */

// ============================================================================
// Main Editor Components
// ============================================================================

export { default as WorkflowEditor } from '../components/WorkflowEditor.svelte';
export { default as App } from '../components/App.svelte';

// ============================================================================
// Node Components
// ============================================================================

export { default as WorkflowNodeComponent } from '../components/nodes/WorkflowNode.svelte';
export { default as SimpleNode } from '../components/nodes/SimpleNode.svelte';
export { default as ToolNode } from '../components/nodes/ToolNode.svelte';
export { default as NotesNode } from '../components/nodes/NotesNode.svelte';
export { default as GatewayNode } from '../components/nodes/GatewayNode.svelte';
export { default as SquareNode } from '../components/nodes/SquareNode.svelte';
export { default as TerminalNode } from '../components/nodes/TerminalNode.svelte';
export { default as UniversalNode } from '../components/UniversalNode.svelte';

// ============================================================================
// Supporting Editor Components
// ============================================================================

export { default as NodeSidebar } from '../components/NodeSidebar.svelte';
export { default as CanvasBanner } from '../components/CanvasBanner.svelte';
export { default as LoadingSpinner } from '../components/LoadingSpinner.svelte';
export { default as StatusIcon } from '../components/StatusIcon.svelte';
export { default as StatusLabel } from '../components/StatusLabel.svelte';
export { default as NodeStatusOverlay } from '../components/NodeStatusOverlay.svelte';
export { default as ConfigForm } from '../components/ConfigForm.svelte';
export { default as ConfigModal } from '../components/ConfigModal.svelte';
export { default as ConfigPanel } from '../components/ConfigPanel.svelte';
export { default as ReadOnlyDetails } from '../components/ReadOnlyDetails.svelte';
export { default as ConnectionLine } from '../components/ConnectionLine.svelte';
export { default as LogsSidebar } from '../components/LogsSidebar.svelte';
export { default as PipelineStatus } from '../components/PipelineStatus.svelte';
export { default as Navbar } from '../components/Navbar.svelte';
export { default as Logo } from '../components/Logo.svelte';

// Console Components
export { default as CommandConsole } from '../components/console/CommandConsole.svelte';

// ============================================================================
// Mount Functions
// ============================================================================

export { mountWorkflowEditor, mountFlowDropApp, unmountFlowDropApp } from '../svelte-app.js';

// ============================================================================
// Node Component Registry
// ============================================================================

export {
  // Core registry (the class — instances live on `fd.nodes`)
  NodeComponentRegistry,
  createNamespacedType,
  parseNamespacedType,
  // Built-in nodes
  BUILTIN_NODE_COMPONENTS,
  BUILTIN_NODE_TYPES,
  FLOWDROP_SOURCE,
  isBuiltinType,
  getBuiltinTypes,
  resolveBuiltinAlias,
  // Plugin system
  createPlugin,
  isValidNamespace
} from '../registry/index.js';

// ============================================================================
// Editor Helpers
// ============================================================================

export {
  EdgeStylingHelper,
  NodeOperationsHelper,
  WorkflowOperationsHelper,
  ConfigurationHelper
} from '../helpers/workflowEditorHelper.js';

// ============================================================================
// Stores
// ============================================================================

// Multi-instance support: per-instance state containers + context helpers.
// All workflow/history/playground state is addressed through an instance.
export {
  createFlowDropInstance,
  getDefaultInstance,
  type FlowDropInstance,
  type CreateInstanceOptions
} from '../stores/instanceContainer.svelte.js';
export {
  getInstance,
  provideInstance,
  FLOWDROP_INSTANCE_KEY
} from '../stores/getInstance.svelte.js';
export { WorkflowStore, type WorkflowStoreActions } from '../stores/workflowStore.svelte.js';
export { HistoryStore, type HistoryStoreActions } from '../stores/historyStore.svelte.js';

// Per-instance API context (endpoints + auth provider + lazily-built client).
export { ApiContext } from '../stores/apiContext.js';

// Port Coordinate Store (Svelte 5 runes-based)
export { PortCoordinateStore } from '../stores/portCoordinateStore.svelte.js';

// History Service (the undo/redo engine class)
export { HistoryService } from '../services/historyService.js';

export type { HistoryEntry, HistoryState, PushOptions } from '../stores/historyStore.svelte.js';

// ============================================================================
// Services
// ============================================================================

export {
  showSuccess,
  showError,
  showWarning,
  showInfo,
  showLoading,
  dismissToast,
  dismissAllToasts,
  showPromise,
  showConfirmation,
  apiToasts,
  workflowToasts,
  pipelineToasts
} from '../services/toastService.js';

export { NodeExecutionService } from '../services/nodeExecutionService.js';

export {
  saveWorkflow,
  updateWorkflow,
  getWorkflow,
  getWorkflows,
  deleteWorkflow,
  getWorkflowCount,
  initializeSampleWorkflows
} from '../services/workflowStorage.js';

export { globalSaveWorkflow, globalExportWorkflow } from '../services/globalSave.js';

export { fetchPortConfig, validatePortConfig } from '../services/portConfigApi.js';

export { fetchCategories, validateCategories } from '../services/categoriesApi.js';

export {
  fetchDynamicSchema,
  resolveExternalEditUrl,
  getEffectiveConfigEditOptions,
  clearSchemaCache,
  invalidateSchemaCache,
  hasConfigEditOptions,
  shouldShowExternalEdit,
  shouldUseDynamicSchema
} from '../services/dynamicSchemaService.js';

export {
  getDraftStorageKey,
  saveDraft,
  loadDraft,
  deleteDraft,
  hasDraft,
  getDraftMetadata,
  clearAllDrafts,
  setDraftStorage,
  getDraftStorage,
  resolveDraftStorage,
  DraftAutoSaveManager
} from '../services/draftStorage.js';
export type {
  DraftStorageAdapter,
  DraftStorageType,
  DraftStorageOption
} from '../services/draftStorage.js';

// ============================================================================
// API Clients
// ============================================================================

export {
  EnhancedFlowDropApiClient,
  ApiError,
  parseApiErrorBody,
  errorDetails
} from '../api/enhanced-client.js';

// ============================================================================
// Connection Utilities
// ============================================================================

export {
  isLoopbackEdge,
  isValidLoopbackCycle,
  PortCompatibilityChecker,
  getPossibleConnections,
  validateConnection,
  getConnectionSuggestions,
  hasCycles,
  hasInvalidCycles,
  getExecutionOrder
} from '../utils/connections.js';

// ============================================================================
// Port Shape Symbols
// ============================================================================

// A port's JSON-Schema shape and its semantic lane are two separate marks on
// the canvas: a small coloured glyph for the shape, a quiet outlined chip for
// the lane's name. `PortTypeBadge` draws one port's whole label row; the rest
// is for a custom node component that wants the same glyph vocabulary.
// `portShape` takes the instance's port-compatibility checker, the same source
// colour reads, so a served or aliased lane shapes the way it colours. See
// utils/portShape.ts for where the shape comes from.
//
// Deliberately small: the lane table, the shape labels and the two-component
// split behind `PortTypeBadge` are implementation, and stay so until something
// outside the library needs them. `portGlyph` is the one name here that fails
// that test — it is `SHAPE_GLYPH[portShape(…)]`, and shipping both it and the
// map was a surface we did not need. Deprecated rather than deleted: it went
// out in 2.3.0, so it leaves in 3.0.0.
export { SHAPE_GLYPH, portShape, portGlyph } from '../utils/portShape.js';
export type { PortShape } from '../utils/portShape.js';

export { default as PortTypeBadge } from '../components/ports/PortTypeBadge.svelte';

// ============================================================================
// Runtime Configuration
// ============================================================================

export {
  fetchRuntimeConfig,
  getRuntimeConfig,
  clearRuntimeConfigCache,
  initRuntimeConfig
} from '../config/runtimeConfig.js';

export type { RuntimeConfig } from '../config/runtimeConfig.js';

// ============================================================================
// Re-export core types (for convenience)
// ============================================================================

export type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  NodeMetadata,
  NodePort,
  DynamicPort,
  Branch,
  ExecutionStatus,
  ExecutionResult,
  FlowDropConfig,
  PortConfig,
  ConfigSchema,
  ConfigProperty,
  ConfigEditOptions
} from '../types/index.js';

export type { WorkflowEditorConfig, EditorFeatures, UIConfig, APIConfig } from '../types/config.js';

export type { AuthProvider, StaticAuthConfig, CallbackAuthConfig } from '../types/auth.js';

export type {
  FlowDropEventHandlers,
  FlowDropFeatures,
  WorkflowChangeType
} from '../types/events.js';

export type { EndpointConfig } from '../config/endpoints.js';

export type { UIAction } from '../commands/types.js';

export type { FlowDropMountOptions, MountedFlowDropApp, NavbarAction } from '../svelte-app.js';

export type {
  NodeComponentProps,
  NodeComponentRegistration,
  FlowDropPluginConfig,
  PluginNodeDefinition
} from '../registry/index.js';
