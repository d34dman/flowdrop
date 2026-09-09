/**
 * Toast Service
 * Centralized toast notification service using svelte-french-toast
 * Provides consistent toast notifications across the FlowDrop application
 */

import { toast, type DefaultToastOptions, type Renderable } from 'svelte-5-french-toast';
import { TOAST_DURATION } from '../config/constants.js';
import { errorDetails } from '../api/enhanced-client.js';
import DismissibleToast from '../components/toast/DismissibleToast.svelte';
import WarningIcon from '../components/toast/WarningIcon.svelte';

/**
 * TYPE DEBT — remove when svelte-5-french-toast types `Renderable` as
 * Svelte 5's `Component` instead of the legacy `SvelteComponent` class
 * (dist/core/types.d.ts). The runtime renders a Svelte 5 component fine;
 * only the declaration is behind, so this is the one place the lie lives.
 */
const asRenderable = <P extends Record<string, unknown>>(component: unknown) =>
  component as Renderable<P>;
const dismissibleToast = asRenderable<{ text: string; details?: readonly string[] }>(
  DismissibleToast
);
const warningIcon = asRenderable(WarningIcon);

/**
 * Default toast options themed with FlowDrop design tokens.
 * Use with <Toaster toastOptions={flowdropToastOptions} containerClassName="flowdrop-toaster" />
 * and import '@flowdrop/flowdrop/styles/toast.css' (or app toast.css) so toast bar styles apply.
 */
export const flowdropToastOptions: DefaultToastOptions = {
  className: 'flowdrop-toast-bar',
  style: '',
  success: {
    iconTheme: {
      primary: 'var(--fd-success)',
      secondary: 'var(--fd-success-foreground)'
    }
  },
  error: {
    iconTheme: {
      primary: 'var(--fd-error)',
      secondary: 'var(--fd-error-foreground)'
    }
  },
  loading: {
    iconTheme: {
      primary: 'var(--fd-primary)',
      secondary: 'var(--fd-primary-muted)'
    }
  }
};

/** Container class for FlowDrop-themed Toaster (used with toast.css). */
export const FLOWDROP_TOASTER_CLASS = 'flowdrop-toaster';

/**
 * Toast notification types
 */
export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

/**
 * Toast configuration options
 */
export interface ToastOptions {
  duration?: number;
  /**
   * Reasons behind the message, rendered as a list under it (errors and
   * warnings only). Pass `ApiError.details` here.
   */
  details?: readonly string[];
  /**
   * Stable id: a toast with the same id replaces the one already showing
   * instead of stacking. Errors and warnings default to an id derived from
   * their text, so repeating a failing action does not wallpaper the screen.
   */
  id?: string;
  position?:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right';
}

/** Default id for a persistent toast: one per distinct text. */
function dedupeId(kind: string, message: string, details: readonly string[] = []): string {
  return `${kind}:${[message, ...details].join('\n')}`;
}

/**
 * Show a success toast notification
 */
export function showSuccess(message: string, options?: ToastOptions): string {
  return toast.success(message, {
    id: options?.id,
    duration: options?.duration ?? TOAST_DURATION.SUCCESS,
    position: options?.position ?? 'bottom-center'
  });
}

/**
 * Show an error toast notification.
 *
 * Stays until the user closes it (TOAST_DURATION.ERROR is Infinity). Pass a
 * finite `duration` to opt back into auto-dismiss.
 */
export function showError(message: string, options?: ToastOptions): string {
  const details = options?.details ?? [];
  return toast.error(dismissibleToast, {
    id: options?.id ?? dedupeId('error', message, details),
    props: { text: message, details },
    duration: options?.duration ?? TOAST_DURATION.ERROR,
    position: options?.position ?? 'bottom-center'
  });
}

/**
 * Show a warning toast notification.
 *
 * Persists until dismissed, like an error. The stance behind that: a warning
 * here is not "done, by the way" — the editor reserves it for something the
 * user should act on (an agent's config key that was ignored, an import that
 * dropped nodes), and a message like that must not vanish mid-read. Pass a
 * finite `duration` for a warning that is only informational. Wears its own
 * icon and colour so it is not mistaken for an error.
 */
export function showWarning(message: string, options?: ToastOptions): string {
  const details = options?.details ?? [];
  return toast(dismissibleToast, {
    id: options?.id ?? dedupeId('warning', message, details),
    props: { text: message, details },
    icon: warningIcon,
    className: 'flowdrop-toast-bar flowdrop-toast-bar--warning',
    duration: options?.duration ?? TOAST_DURATION.WARNING,
    position: options?.position ?? 'bottom-center'
  });
}

/**
 * Show an info toast notification
 */
export function showInfo(message: string, options?: ToastOptions): string {
  return toast.success(message, {
    id: options?.id,
    duration: options?.duration ?? TOAST_DURATION.INFO,
    position: options?.position ?? 'bottom-center'
  });
}

/**
 * Show a loading toast notification
 */
export function showLoading(message: string, options?: ToastOptions): string {
  return toast.loading(message, {
    id: options?.id,
    duration: options?.duration ?? Infinity,
    position: options?.position ?? 'bottom-center'
  });
}

/**
 * Dismiss a specific toast by ID
 */
export function dismissToast(toastId: string): void {
  toast.dismiss(toastId);
}

/**
 * Dismiss all toasts
 */
export function dismissAllToasts(): void {
  toast.dismiss();
}

/**
 * Show a promise-based toast (loading -> success/error)
 */
export function showPromise<T>(
  promise: Promise<T>,
  {
    loading,
    success,
    error,
    options
  }: {
    loading: string;
    success: string | ((data: T) => string);
    error: string | ((error: unknown) => string);
    options?: ToastOptions;
  }
): Promise<T> {
  return toast.promise(promise, {
    loading,
    success,
    error,
    ...options
  });
}

/**
 * Show a confirmation toast (simplified version without action buttons)
 */
export function showConfirmation(message: string, options?: ToastOptions): string {
  return toast(message, {
    id: options?.id,
    duration: options?.duration ?? TOAST_DURATION.CONFIRMATION,
    position: options?.position ?? 'bottom-center'
  });
}

/** Headline and reasons of a thrown error; see `errorDetails`. */
function errorParts(error: string | Error): { message: string; details: readonly string[] } {
  if (typeof error === 'string') return { message: error, details: [] };
  return { message: error.message, details: errorDetails(error) };
}

/**
 * API-specific toast helpers
 */
export const apiToasts = {
  /**
   * Show API success message
   */
  success: (operation: string, details?: string) => {
    const message = details ? `${operation}: ${details}` : operation;
    return showSuccess(message);
  },

  /**
   * Show API error message
   */
  error: (operation: string, error: string | Error) => {
    const { message, details } = errorParts(error);
    return showError(`${operation} failed: ${message}`, { details });
  },

  /**
   * Show API loading message
   */
  loading: (operation: string) => {
    return showLoading(`${operation}...`);
  },

  /**
   * Show API promise with automatic success/error handling
   */
  promise: <T>(
    promise: Promise<T>,
    operation: string,
    options?: {
      successMessage?: string;
      errorMessage?: string;
    }
  ) => {
    return showPromise(promise, {
      loading: `${operation}...`,
      success: options?.successMessage || `${operation} completed successfully`,
      error: options?.errorMessage || `${operation} failed`
    });
  }
};

/**
 * Workflow-specific toast helpers
 */
export const workflowToasts = {
  /**
   * Show workflow save success
   */
  saved: (workflowName?: string) => {
    const message = workflowName
      ? `Workflow "${workflowName}" saved successfully`
      : 'Workflow saved successfully';
    return showSuccess(message);
  },

  /**
   * Show workflow save error
   */
  saveError: (error: string | Error) => {
    const { message, details } = errorParts(error);
    return showError(`Failed to save workflow: ${message}`, { details });
  },

  /**
   * Show workflow delete success
   */
  deleted: (workflowName?: string) => {
    const message = workflowName
      ? `Workflow "${workflowName}" deleted successfully`
      : 'Workflow deleted successfully';
    return showSuccess(message);
  },

  /**
   * Show workflow delete error
   */
  deleteError: (error: string | Error) => {
    const { message, details } = errorParts(error);
    return showError(`Failed to delete workflow: ${message}`, { details });
  },

  /**
   * Show workflow execution started
   */
  executionStarted: (workflowName?: string) => {
    const message = workflowName
      ? `Workflow "${workflowName}" execution started`
      : 'Workflow execution started';
    return showInfo(message);
  },

  /**
   * Show workflow execution completed
   */
  executionCompleted: (workflowName?: string) => {
    const message = workflowName
      ? `Workflow "${workflowName}" execution completed`
      : 'Workflow execution completed';
    return showSuccess(message);
  },

  /**
   * Show workflow export success
   */
  exported: (workflowName?: string) => {
    const message = workflowName
      ? `Workflow "${workflowName}" exported successfully`
      : 'Workflow exported successfully';
    return showSuccess(message);
  },

  /**
   * Show workflow execution error
   */
  executionError: (error: string | Error) => {
    const { message, details } = errorParts(error);
    return showError(`Workflow execution failed: ${message}`, { details });
  }
};

/**
 * Pipeline-specific toast helpers
 */
export const pipelineToasts = {
  /**
   * Show pipeline creation success
   */
  created: (pipelineName?: string) => {
    const message = pipelineName
      ? `Pipeline "${pipelineName}" created successfully`
      : 'Pipeline created successfully';
    return showSuccess(message);
  },

  /**
   * Show pipeline creation error
   */
  creationError: (error: string | Error) => {
    const { message, details } = errorParts(error);
    return showError(`Failed to create pipeline: ${message}`, { details });
  },

  /**
   * Show pipeline execution started
   */
  executionStarted: (pipelineId: string) => {
    return showInfo(`Pipeline ${pipelineId} execution started`);
  },

  /**
   * Show pipeline execution completed
   */
  executionCompleted: (pipelineId: string) => {
    return showSuccess(`Pipeline ${pipelineId} execution completed`);
  },

  /**
   * Show pipeline execution error
   */
  executionError: (pipelineId: string, error: string | Error) => {
    const { message, details } = errorParts(error);
    return showError(`Pipeline ${pipelineId} execution failed: ${message}`, { details });
  },

  /**
   * Show pipeline status update
   */
  statusUpdate: (pipelineId: string, status: string) => {
    return showInfo(`Pipeline ${pipelineId} status: ${status}`);
  }
};
