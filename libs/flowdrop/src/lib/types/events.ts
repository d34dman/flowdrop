/**
 * Event Handler Types for FlowDrop
 *
 * Defines high-level event handlers for enterprise integration.
 * These events allow parent applications to react to workflow lifecycle events.
 *
 * @module types/events
 */

import type { Workflow, NodeExecutionInfo, WorkflowNode } from './index.js';
import type { SwapEventContext, SwapResult } from '../utils/nodeSwap.js';

/**
 * Types of workflow changes
 *
 * Used to identify what kind of change triggered the onWorkflowChange event.
 */
export type WorkflowChangeType =
  | 'node_add'
  | 'node_remove'
  | 'node_move'
  | 'node_config'
  | 'node_swap'
  | 'edge_add'
  | 'edge_remove'
  | 'metadata'
  | 'name'
  | 'description';

/**
 * High-level event handlers for enterprise integration
 *
 * These event handlers allow parent applications to hook into FlowDrop's
 * workflow lifecycle. All handlers are optional.
 *
 * @example
 * ```typescript
 * const eventHandlers: FlowDropEventHandlers = {
 *   onWorkflowChange: (workflow, changeType) => {
 *     console.log(`Workflow changed: ${changeType}`);
 *   },
 *   onDirtyStateChange: (isDirty) => {
 *     updateSaveButtonState(isDirty);
 *   },
 *   onAfterSave: async (workflow) => {
 *     showSuccess("Workflow saved!");
 *   }
 * };
 * ```
 */
export interface FlowDropEventHandlers {
  /**
   * Called when workflow changes (any modification)
   *
   * Triggered after nodes are added/removed/moved, edges are added/removed,
   * or node configurations are changed.
   *
   * @param workflow - The updated workflow
   * @param changeType - The type of change that occurred
   */
  onWorkflowChange?: (workflow: Workflow, changeType: WorkflowChangeType) => void;

  /**
   * Called when dirty state changes
   *
   * Triggered when the workflow transitions between saved and unsaved states.
   * Useful for updating UI indicators or enabling/disabling save buttons.
   *
   * @param isDirty - true if there are unsaved changes
   */
  onDirtyStateChange?: (isDirty: boolean) => void;

  /**
   * Called before save - return false to cancel
   *
   * Allows the parent application to validate or confirm before saving.
   * If this returns false, the save operation is cancelled.
   *
   * @param workflow - The workflow about to be saved
   * @returns Promise resolving to false to cancel, true/void to proceed
   */
  onBeforeSave?: (workflow: Workflow) => Promise<boolean | void>;

  /**
   * Called after successful save
   *
   * Triggered after the workflow has been successfully saved to the backend.
   * Useful for showing success notifications or clearing draft storage.
   *
   * @param workflow - The saved workflow (may include server-assigned IDs)
   */
  onAfterSave?: (workflow: Workflow) => Promise<void>;

  /**
   * Called when save fails
   *
   * Triggered when the save operation fails due to API error.
   * Useful for showing error notifications or logging.
   *
   * @param error - The error that occurred
   * @param workflow - The workflow that failed to save
   */
  onSaveError?: (error: Error, workflow: Workflow) => Promise<void>;

  /**
   * Called when workflow is loaded
   *
   * Triggered after a workflow is loaded and initialized.
   * This includes both initial load and subsequent loads.
   *
   * @param workflow - The loaded workflow
   */
  onWorkflowLoad?: (workflow: Workflow) => void;

  /**
   * Called before unmount
   *
   * Triggered before FlowDrop is destroyed/unmounted.
   * Allows parent application to save drafts or perform cleanup.
   *
   * @param workflow - The current workflow state
   * @param isDirty - true if there are unsaved changes
   */
  onBeforeUnmount?: (workflow: Workflow, isDirty: boolean) => void;

  /**
   * Called on any API error
   *
   * Triggered when any API request fails.
   * Return true to suppress FlowDrop's default error toast.
   *
   * @param error - The error that occurred
   * @param operation - Description of the operation that failed (e.g., "save", "load", "fetchNodes")
   * @returns true to suppress default error handling, false/void to show default toast
   */
  onApiError?: (error: Error, operation: string) => boolean | void;

  // ========================================================================
  // Node Swap Events
  // ========================================================================

  /**
   * Called before a node swap is executed.
   * Return false to cancel the swap.
   *
   * @param context - Data-only swap context (oldNode, newMetadata, preview, overrides)
   * @returns false to cancel, true/void to proceed
   */
  onBeforeSwap?: (context: SwapEventContext) => boolean | void | Promise<boolean | void>;

  /**
   * Called after a node swap is successfully executed.
   *
   * @param result - The swap result with updated nodes/edges
   * @param oldNode - The node that was replaced
   * @param newNodeId - The ID of the newly created node
   */
  onAfterSwap?: (result: SwapResult, oldNode: WorkflowNode, newNodeId: string) => void;

  // ========================================================================
  // Agent Spec Runtime Events
  // ========================================================================

  /**
   * Called when an Agent Spec execution starts
   *
   * @param executionId - The runtime execution ID
   */
  onAgentSpecExecutionStarted?: (executionId: string) => void;

  /**
   * Called when an Agent Spec execution completes successfully
   *
   * @param executionId - The runtime execution ID
   * @param results - Execution results from the runtime
   */
  onAgentSpecExecutionCompleted?: (executionId: string, results: Record<string, unknown>) => void;

  /**
   * Called when an Agent Spec execution fails
   *
   * @param executionId - The runtime execution ID
   * @param error - The error that occurred
   */
  onAgentSpecExecutionFailed?: (executionId: string, error: Error) => void;

  /**
   * Called when a node's execution status is updated during Agent Spec execution
   *
   * @param nodeId - The FlowDrop node ID
   * @param status - Updated execution info
   */
  onAgentSpecNodeStatusUpdate?: (nodeId: string, status: NodeExecutionInfo) => void;
}

/**
 * Feature flags for FlowDrop
 *
 * Controls optional features and behaviors.
 * All features have sensible defaults.
 */
export interface FlowDropFeatures {
  /**
   * Save drafts to browser storage automatically
   *
   * When enabled, FlowDrop will periodically save the current workflow
   * to draft storage (localStorage by default, configurable via the
   * `draftStorage` mount option). This helps prevent data loss. End users
   * can additionally opt out at runtime via the "Store Drafts in Browser"
   * behavior setting.
   *
   * @default true
   */
  autoSaveDraft?: boolean;

  /**
   * Auto-save interval in milliseconds
   *
   * How often to save drafts to storage when autoSaveDraft is enabled.
   *
   * @default 30000 (30 seconds)
   */
  autoSaveDraftInterval?: number;

  /**
   * Show toast notifications
   *
   * When enabled, FlowDrop will show toast notifications for
   * success, error, and loading states.
   *
   * @default true
   */
  showToasts?: boolean;

  /**
   * Enable node swap functionality
   *
   * When enabled, users can swap a node for a different type
   * while preserving compatible connections and configuration.
   *
   * @default true
   */
  enableNodeSwap?: boolean;

  /**
   * Register the built-in heavy form editors (markdown / code / template).
   *
   * The full editor is batteries-included: node config fields with
   * `format: 'markdown'` / `'code'` / `'template'` render real CodeMirror
   * editors out of the box. Their chunks are code-split and load lazily, so
   * an editor that never opens such a field never downloads CodeMirror/marked.
   *
   * Set to `false` only if you want to strip those editors (e.g. to shave the
   * lazy chunks) and either live with the textarea fallback or register your
   * own field components via `instance.fields.register(...)`.
   *
   * This does not affect the standalone `@flowdrop/flowdrop/form` primitive,
   * which stays opt-in regardless.
   *
   * @default true
   */
  builtinEditors?: boolean;

  /**
   * Offer the Command Console tab in the console / AI Assistant group.
   *
   * The console is a command line for the editor's DSL. Hosts whose users
   * are not developers may prefer to hide it, so nobody mistakes it for a
   * chat. When both `console` and `assistant` are off, the group's toggle
   * button and its backtick shortcut disappear as well.
   *
   * @default true
   */
  console?: boolean;

  /**
   * Offer the AI Assistant tab in the console / AI Assistant group.
   *
   * Independent of this flag, the tab is only offered when the endpoint
   * configuration carries a `chat` endpoint group — an assistant with no
   * backend has nothing to say. Browser agents (WebMCP) do not depend on the
   * panel: they drive the same tool runtime through the browser's model
   * context and keep working with the assistant hidden.
   *
   * @default true
   */
  assistant?: boolean;
}

/**
 * Default feature values
 *
 * Used when features are not explicitly configured.
 */
export const DEFAULT_FEATURES: Required<FlowDropFeatures> = {
  autoSaveDraft: true,
  autoSaveDraftInterval: 30000,
  showToasts: true,
  enableNodeSwap: true,
  builtinEditors: true,
  console: true,
  assistant: true
};

/**
 * Merge user-provided features with defaults
 *
 * @param features - User-provided feature configuration
 * @returns Complete feature configuration with defaults applied
 */
export function mergeFeatures(features?: FlowDropFeatures): Required<FlowDropFeatures> {
  return {
    ...DEFAULT_FEATURES,
    ...features
  };
}
