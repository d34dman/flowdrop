/**
 * Global Save Service
 * Provides save and export functionality that can be accessed from anywhere in the app.
 * This is the single source of truth for save/export logic.
 *
 * App.svelte delegates to globalSaveWorkflow() / globalExportWorkflow() rather than
 * reimplementing the logic, ensuring "blur active element" flushing and metadata
 * construction happen in exactly one place.
 */

import { tick } from 'svelte';
import { getDefaultInstance, type FlowDropInstance } from '$lib/stores/instanceContainer.svelte.js';
import { createEndpointConfig } from '$lib/config/endpoints.js';
import { v4 as uuidv4 } from 'uuid';
import type { Workflow } from '$lib/types/index.js';
import { DEFAULT_WORKFLOW_FORMAT } from '$lib/types/index.js';
import { apiToasts, workflowToasts, dismissToast } from './toastService.js';
import type { FlowDropEventHandlers, FlowDropFeatures } from '$lib/types/events.js';
import { DEFAULT_FEATURES } from '$lib/types/events.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options accepted by globalSaveWorkflow().
 * All fields are optional — omitting them falls back to the basic behaviour
 * (no event handlers, always show toasts).
 */
export interface GlobalSaveOptions {
  /** Event handler hooks (onBeforeSave, onAfterSave, onSaveError, onApiError). */
  eventHandlers?: FlowDropEventHandlers;
  /** Feature flags (showToasts). Defaults to DEFAULT_FEATURES. */
  features?: Partial<FlowDropFeatures>;
  /**
   * Callback invoked after a successful save to clear the dirty state.
   * Pass workflowStore's markAsSaved here when calling from App.svelte.
   */
  onMarkAsSaved?: () => void;
  /**
   * Callback invoked after a successful save with the persisted workflow.
   * Receives the server-returned workflow (which may have a different ID than
   * the one sent, e.g. server-assigned integer vs client UUID).
   * Use this to update draft storage keys or other ID-dependent state.
   */
  onSaved?: (savedWorkflow: Workflow) => void;
  /**
   * The FlowDrop instance whose workflow should be saved.
   * Defaults to the page-default instance when omitted.
   */
  instance?: FlowDropInstance;
}

/**
 * Options accepted by globalExportWorkflow().
 */
export interface GlobalExportOptions {
  /** Feature flags (showToasts). Defaults to DEFAULT_FEATURES. */
  features?: Partial<FlowDropFeatures>;
  /**
   * The FlowDrop instance whose workflow should be exported.
   * Defaults to the page-default instance when omitted.
   */
  instance?: FlowDropInstance;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Ensure the instance's API context is configured.
 * This is needed when the global save function is called from the layout
 * component which doesn't initialize the API configuration like <App> does.
 */
function ensureApiConfiguration(fd: FlowDropInstance): void {
  if (fd.api.isConfigured() && fd.api.config?.baseUrl) {
    return;
  }

  // API configuration is not initialized — derive URL from window.location when available
  const apiBaseUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}/api/flowdrop`
      : '/api/flowdrop';

  const config = createEndpointConfig(apiBaseUrl, {
    timeout: 10000,
    retry: {
      enabled: true,
      maxAttempts: 2,
      delay: 1000,
      backoff: 'exponential'
    }
  });

  fd.api.configure(config);
}

/**
 * Flush any pending form changes by blurring the active element.
 * This ensures focusout handlers (like ConfigForm's handleFormBlur)
 * sync local state to the global store before we read it.
 *
 * Must be called once, in this file only, so the logic lives in exactly one place.
 */
async function flushPendingFormChanges(): Promise<void> {
  if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  // Wait for any pending DOM / Svelte reactive updates before reading the store
  await tick();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save the current workflow to the backend.
 *
 * This is the single source of truth for save logic. App.svelte delegates
 * to this function rather than reimplementing the steps.
 *
 * Steps performed:
 *  1. Flush pending form changes (blur active element + tick)
 *  2. Optionally call onBeforeSave — return false cancels the save
 *  3. Build the canonical Workflow object (preserving metadata, format, etc.)
 *  4. Persist via the instance's API client (fd.api.client)
 *  5. Update the store if the server assigned a new ID
 *  6. Call onMarkAsSaved / onAfterSave hooks
 *  7. Show toast notifications (respecting features.showToasts)
 */
/**
 * Resolves `true` when the workflow was written, `false` when nothing was
 * saved because there was no workflow or `onBeforeSave` cancelled. A failed
 * request throws. Callers that relay the outcome (the WebMCP `save` tool)
 * must not read a quiet return as a save.
 */
export async function globalSaveWorkflow(options: GlobalSaveOptions = {}): Promise<boolean> {
  const { eventHandlers, onMarkAsSaved, onSaved } = options;
  const features = { ...DEFAULT_FEATURES, ...options.features };

  // Resolve the target instance; defaults to the page-default instance.
  const fd = options.instance ?? getDefaultInstance();
  const readWorkflow = () => fd.workflow.current;

  // Step 1 — Flush pending form changes (single location for this logic)
  await flushPendingFormChanges();

  // Get current workflow from the instance's store after flush
  const currentWorkflow = readWorkflow();

  if (!currentWorkflow) {
    if (features.showToasts) {
      apiToasts.error('Save workflow', 'No workflow to save');
    }
    return false;
  }

  // Step 2 — Allow the parent to cancel the save
  if (eventHandlers?.onBeforeSave) {
    const shouldContinue = await eventHandlers.onBeforeSave(currentWorkflow);
    if (shouldContinue === false) {
      return false;
    }
  }

  const loadingToast = features.showToasts ? apiToasts.loading('Saving workflow') : null;

  try {
    // Ensure API configuration is initialised (needed when called outside App.svelte)
    ensureApiConfiguration(fd);

    // Step 3 — Build the canonical workflow object.
    // Preserve all existing metadata fields (format, tags, etc.) so nothing is dropped.
    //
    // Determine new vs existing BEFORE the uuidv4() fallback: if the store already
    // has an id (any format — integer, UUID, slug), the workflow came from a backend
    // and must be updated. Only a missing id means "truly new".
    const isExistingWorkflow = !!currentWorkflow.id;
    const workflowId = currentWorkflow.id || uuidv4();

    const finalWorkflow: Workflow = {
      id: workflowId,
      name: currentWorkflow.name || 'Untitled Workflow',
      description: currentWorkflow.description || '',
      nodes: currentWorkflow.nodes || [],
      edges: currentWorkflow.edges || [],
      metadata: {
        ...currentWorkflow.metadata,
        schemaVersion: currentWorkflow.metadata?.schemaVersion || '1.0.0',
        format: currentWorkflow.metadata?.format || DEFAULT_WORKFLOW_FORMAT,
        createdAt: currentWorkflow.metadata?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      // Explicit key list, so every contract field must be named here:
      // omitting `interface` silently strips the declared contract on save
      // (absent means "declares no interface" to the server).
      ...(currentWorkflow.interface !== undefined && { interface: currentWorkflow.interface }),
      // The revision the editor loaded, so a server that checks it can refuse
      // a stale write (409 CONFLICT) instead of letting the last write win.
      ...(currentWorkflow.revision !== undefined && { revision: currentWorkflow.revision })
    };

    // Step 4 — Persist via this instance's API client.
    // id-presence (computed above) decides update vs create — never UUID-regex.
    const apiClient = fd.api.client;
    const savedWorkflow: Workflow = isExistingWorkflow
      ? await apiClient.updateWorkflow(finalWorkflow.id, finalWorkflow)
      : await apiClient.saveWorkflow(finalWorkflow);

    // Step 5 — If the server assigned a new ID, sync the store
    if (savedWorkflow.id && savedWorkflow.id !== finalWorkflow.id) {
      fd.workflow.batchUpdate({
        nodes: finalWorkflow.nodes,
        edges: finalWorkflow.edges,
        name: finalWorkflow.name,
        metadata: {
          ...finalWorkflow.metadata,
          ...savedWorkflow.metadata
        }
      });
    }

    // Step 5b — The save minted a new revision (and may have refreshed what the
    // user may do); take the server's word so the next save sends the current
    // stamp rather than the one this save just superseded.
    fd.workflow.acknowledgeServer({ revision: savedWorkflow.revision, can: savedWorkflow.can });

    // Step 6a — Mark dirty state as clean
    if (onMarkAsSaved) {
      onMarkAsSaved();
    } else {
      fd.workflow.markAsSaved();
    }

    // Notify caller with the definitive saved workflow (server-assigned ID)
    if (onSaved) {
      onSaved(savedWorkflow);
    }

    // Show success toast
    if (loadingToast) dismissToast(loadingToast);
    if (features.showToasts) {
      workflowToasts.saved(finalWorkflow.name);
    }

    // Step 6b — After-save hook
    if (eventHandlers?.onAfterSave) {
      await eventHandlers.onAfterSave(savedWorkflow);
    }
    return true;
  } catch (error) {
    if (loadingToast) dismissToast(loadingToast);

    const errorObj = error instanceof Error ? error : new Error('Unknown error occurred');

    // onSaveError hook
    const currentWorkflowForError = readWorkflow();
    if (eventHandlers?.onSaveError && currentWorkflowForError) {
      await eventHandlers.onSaveError(errorObj, currentWorkflowForError);
    }

    // onApiError hook — return true suppresses the default toast
    let suppressToast = false;
    if (eventHandlers?.onApiError) {
      suppressToast = eventHandlers.onApiError(errorObj, 'save') === true;
    }

    if (features.showToasts && !suppressToast) {
      // The error object, not its message: an ApiError carries the server's
      // reasons as `details`, and the toast renders them as a list.
      apiToasts.error('Save workflow', errorObj);
    }

    throw error;
  }
}

/**
 * Export the current workflow as a downloadable JSON file.
 *
 * This is the single source of truth for export logic. App.svelte delegates
 * to this function rather than reimplementing the steps.
 *
 * Preserves all metadata fields (format, tags, etc.) consistently with save.
 */
export async function globalExportWorkflow(options: GlobalExportOptions = {}): Promise<void> {
  const features = { ...DEFAULT_FEATURES, ...options.features };

  try {
    // Flush pending changes before exporting (same discipline as save)
    await flushPendingFormChanges();

    const fd = options.instance ?? getDefaultInstance();
    const currentWorkflow = fd.workflow.current;

    if (!currentWorkflow) {
      if (features.showToasts) {
        apiToasts.error('Export workflow', 'No workflow to export');
      }
      return;
    }

    // Build the canonical export object — preserve all metadata fields
    const finalWorkflow: Workflow = {
      id: currentWorkflow.id || 'untitled-workflow',
      name: currentWorkflow.name || 'Untitled Workflow',
      description: currentWorkflow.description || '',
      nodes: currentWorkflow.nodes || [],
      edges: currentWorkflow.edges || [],
      metadata: {
        ...currentWorkflow.metadata,
        schemaVersion: currentWorkflow.metadata?.schemaVersion || '1.0.0',
        format: currentWorkflow.metadata?.format || DEFAULT_WORKFLOW_FORMAT,
        createdAt: currentWorkflow.metadata?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      // Same rule as the save path: the export must carry the declared
      // contract, or a re-import round-trip loses `interface`.
      ...(currentWorkflow.interface !== undefined && { interface: currentWorkflow.interface })
    };

    // Trigger browser download
    const dataStr = JSON.stringify(finalWorkflow, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${finalWorkflow.name}.json`;
    link.click();
    URL.revokeObjectURL(url);

    if (features.showToasts) {
      workflowToasts.exported(finalWorkflow.name);
    }
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error('Unknown error occurred');
    apiToasts.error('Export workflow', errorObj.message);
  }
}
