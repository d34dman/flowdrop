/**
 * Enhanced API Client for FlowDrop
 *
 * Uses configurable endpoints and supports pluggable authentication providers.
 *
 * @module api/enhanced-client
 */

import type {
  NodeMetadata,
  Workflow,
  ExecutionResult,
  ApiResponse,
  NodesResponse,
  WorkflowResponse,
  WorkflowsResponse
} from '../types/index.js';
import type { EndpointConfig } from '../config/endpoints.js';
import { buildEndpointUrl, getEndpointMethod, getRequestHeaders } from '../config/endpoints.js';
import type { AuthProvider } from '../types/auth.js';
import { NoAuthProvider } from '../types/auth.js';
import { getApiSettings } from '../stores/settingsStore.svelte.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_API_TIMEOUT_MS } from '../config/constants.js';

/**
 * API error with additional context
 */
export class ApiError extends Error {
  /** HTTP status code */
  public readonly status: number;
  /** Original error data from API */
  public readonly errorData: Record<string, unknown>;
  /** Operation that was being performed */
  public readonly operation: string;
  /**
   * The reasons behind `message`, one per line, already human-readable.
   * For a fddo validation refusal these are the `details[].message` strings;
   * empty when the server gave only a headline.
   */
  public readonly details: readonly string[];

  constructor(
    message: string,
    status: number,
    operation: string,
    errorData: Record<string, unknown> = {},
    details: readonly string[] = []
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.operation = operation;
    this.errorData = errorData;
    this.details = details;
  }
}

/**
 * The reasons an error carries, or none. An `ApiError` contributes its
 * `details`; a plain `Error` or a string has nothing to add. Duck-typed rather
 * than `instanceof` because the error may come from a host page that bundled
 * its own copy of this client.
 */
export function errorDetails(error: unknown): readonly string[] {
  if (!error || typeof error !== 'object') return [];
  const details = (error as { details?: unknown }).details;
  return Array.isArray(details) ? details.filter((d): d is string => typeof d === 'string') : [];
}

/**
 * Splits a non-2xx API body into a headline and its reasons.
 *
 * fddo answers a refusal as `{ success: false, error, error_code?, details? }`.
 * `error` is the headline ("Workflow validation failed"); what the user can
 * act on lives in `details` — for a validation failure an array of
 * `{ code, message, locator }`. The exception subscriber's envelope carries
 * the headline in `error` and the reason in `message`. Both are kept as
 * structure (headline + list) so the toast can render a list instead of a
 * semicolon-joined paragraph; the raw body still travels on `errorData`.
 */
export function parseApiErrorBody(
  errorData: unknown,
  status: number,
  statusText: string
): { message: string; details: string[] } {
  const fallback = `HTTP ${status}: ${statusText}`;
  if (!errorData || typeof errorData !== 'object') return { message: fallback, details: [] };
  const body = errorData as { error?: unknown; message?: unknown; details?: unknown };
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

  const message = str(body.error) ?? str(body.message) ?? fallback;
  const details: string[] = [];

  const reason = str(body.message);
  if (reason && reason !== message) details.push(reason);

  if (Array.isArray(body.details)) {
    for (const detail of body.details) {
      const text =
        str(detail) ??
        (detail && typeof detail === 'object'
          ? str((detail as { message?: unknown }).message)
          : null);
      if (text) details.push(text);
    }
  }

  return { message, details };
}

/**
 * Whether a failed attempt is worth repeating.
 *
 * Only failures the next attempt could plausibly not repeat: a network failure
 * (`fetch` rejects with a `TypeError`), 408 Request Timeout, 429 Too Many
 * Requests, and 5xx. Every other 4xx is a refusal — the server read the request
 * and said no — and the same bytes will get the same answer. A 2xx whose body
 * is not JSON (`SyntaxError` from `response.json()`) is not retried either:
 * the same proxy will serve the same login page three times.
 */
function isRetryable(error: Error): boolean {
  if (!(error instanceof ApiError)) return error instanceof TypeError;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

/**
 * Enhanced HTTP API client for FlowDrop with configurable endpoints
 *
 * Supports pluggable authentication via AuthProvider interface.
 *
 * @example
 * ```typescript
 * // With AuthProvider
 * const client = new EnhancedFlowDropApiClient(config, authProvider);
 *
 * // Without authentication
 * const client = new EnhancedFlowDropApiClient(config);
 * ```
 */
export interface PipelineDataResponse {
  status: string;
  jobs: Array<Record<string, unknown>>;
  node_statuses: Record<string, { status: string; [key: string]: unknown }>;
  job_status_summary: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    skipped?: number;
    paused?: number;
    interrupted?: number;
  };
  kanban_config?: {
    columns: Array<{
      key: string;
      label: string;
      statuses: string[];
      icon?: string;
      color?: string;
    }>;
  };
}

export class EnhancedFlowDropApiClient {
  private config: EndpointConfig;
  private authProvider: AuthProvider;

  /**
   * Create a new EnhancedFlowDropApiClient
   *
   * @param config - Endpoint configuration
   * @param authProvider - Optional authentication provider (defaults to NoAuthProvider)
   */
  constructor(config: EndpointConfig, authProvider?: AuthProvider) {
    this.config = config;

    // Use provided AuthProvider or default to no authentication
    this.authProvider = authProvider ?? new NoAuthProvider();
  }

  /**
   * Make HTTP request with error handling, retry logic, timeout, and auth support
   *
   * Uses apiSettings for timeout and retry configuration, falling back to EndpointConfig values.
   *
   * @param endpointKey - Key identifying the endpoint (for method/header lookup)
   * @param endpointPath - The endpoint path template
   * @param params - URL parameters to substitute
   * @param options - Additional fetch options
   * @param operation - Description of the operation (for error messages)
   */
  private async request<T>(
    endpointKey: string,
    endpointPath: string,
    params?: Record<string, string>,
    options: RequestInit = {},
    operation: string = 'API request'
  ): Promise<T> {
    const url = buildEndpointUrl(this.config, endpointPath, params);
    const method = options.method ?? getEndpointMethod(this.config, endpointKey);

    // Get user settings for timeout and retry
    const userApiSettings = getApiSettings();

    // Merge headers via the shared path: static endpoint headers < auth headers
    // < request-specific headers.
    const headers: Record<string, string> = {
      ...(await getRequestHeaders(this.config, endpointKey, this.authProvider)),
      ...(options.headers as Record<string, string>)
    };

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutMs = userApiSettings.timeout ?? this.config.timeout ?? DEFAULT_API_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const fetchConfig: RequestInit = {
      method,
      headers,
      signal: controller.signal,
      ...options
    };

    let lastError: Error | null = null;

    // Determine retry settings: user settings override config
    const retryEnabled = userApiSettings.retryEnabled ?? this.config.retry?.enabled ?? false;
    const maxAttempts = retryEnabled
      ? (userApiSettings.retryAttempts ?? this.config.retry?.maxAttempts ?? 3)
      : 1;

    /**
     * The `ApiError` for a non-2xx response, body read and split into headline
     * and reasons. `statusText` is only the last-resort headline: a fddo 403
     * says which permission is missing, and that must reach the user.
     */
    const refusal = async (response: Response, status: number, statusText: string) => {
      const errorData: Record<string, unknown> = await response.json().catch(() => ({}));
      const { message, details } = parseApiErrorBody(errorData, status, statusText);
      return new ApiError(message, status, operation, errorData, details);
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(url, fetchConfig);

        // Clear timeout on successful response
        clearTimeout(timeoutId);

        // Handle 401 Unauthorized
        if (response.status === 401) {
          if (this.authProvider.onUnauthorized) {
            const refreshed = await this.authProvider.onUnauthorized();
            if (refreshed && attempt < maxAttempts) {
              // Rebuild headers via the shared path to pick up the fresh token.
              fetchConfig.headers = {
                ...(await getRequestHeaders(this.config, endpointKey, this.authProvider)),
                ...(options.headers as Record<string, string>)
              };
              continue; // Retry with new headers
            }
          }
          throw await refusal(response, 401, 'Unauthorized');
        }

        // Handle 403 Forbidden
        if (response.status === 403) {
          if (this.authProvider.onForbidden) {
            await this.authProvider.onForbidden();
          }
          throw await refusal(response, 403, 'Forbidden');
        }

        // Handle other errors
        if (!response.ok) {
          throw await refusal(response, response.status, response.statusText);
        }

        const data = await response.json();
        return data as T;
      } catch (error) {
        // Clear timeout on error
        clearTimeout(timeoutId);

        // Handle abort (timeout)
        if (error instanceof Error && error.name === 'AbortError') {
          lastError = new ApiError(`Request timeout after ${timeoutMs}ms`, 0, operation, {
            timeout: true
          });
          // Don't retry on timeout - it's a client-side timeout
          logger.error(`API request timed out after ${timeoutMs}ms:`, lastError);
          throw lastError;
        }

        // If it's already an ApiError, preserve it
        if (error instanceof ApiError) {
          lastError = error;
        } else {
          lastError = error instanceof Error ? error : new Error(String(error));
        }

        if (!isRetryable(lastError) || attempt === maxAttempts) {
          logger.error(`API request failed after ${attempt} attempts:`, lastError);
          throw lastError;
        }

        // Wait before retry with exponential backoff
        const baseDelay = this.config.retry?.delay ?? 1000;
        const backoffDelay =
          this.config.retry?.backoff === 'exponential'
            ? baseDelay * Math.pow(2, attempt - 1)
            : baseDelay;

        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
      }
    }

    throw lastError;
  }

  /**
   * Update the auth provider
   *
   * Useful for updating auth after token refresh in parent application.
   * Note: Per specification, this should rarely be needed as auth is typically
   * set at mount time and requires remount to change.
   *
   * @param authProvider - New authentication provider
   */
  setAuthProvider(authProvider: AuthProvider): void {
    this.authProvider = authProvider;
  }

  /**
   * Get current auth provider
   *
   * @returns The current AuthProvider instance
   */
  getAuthProvider(): AuthProvider {
    return this.authProvider;
  }

  // =========================================================================
  // Node API Methods
  // =========================================================================

  /**
   * Fetch all available node types
   */
  async getAvailableNodes(): Promise<NodeMetadata[]> {
    const response = await this.request<NodesResponse>(
      'nodes.list',
      this.config.endpoints.nodes.list,
      undefined,
      {},
      'fetch available nodes'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to fetch available nodes');
    }

    return response.data;
  }

  /**
   * Fetch nodes filtered by category
   */
  async getNodesByCategory(category: string): Promise<NodeMetadata[]> {
    const response = await this.request<NodesResponse>(
      'nodes.byCategory',
      this.config.endpoints.nodes.byCategory,
      { category },
      {},
      'fetch nodes by category'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to fetch nodes by category');
    }

    return response.data;
  }

  /**
   * Fetch metadata for a specific node type
   */
  async getNodeMetadata(nodeId: string): Promise<NodeMetadata> {
    const response = await this.request<ApiResponse<NodeMetadata>>(
      'nodes.metadata',
      this.config.endpoints.nodes.metadata,
      { id: nodeId },
      {},
      'fetch node metadata'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to fetch node metadata');
    }

    return response.data;
  }

  // =========================================================================
  // Workflow API Methods
  // =========================================================================

  /**
   * Save a new workflow
   */
  async saveWorkflow(workflow: Workflow): Promise<Workflow> {
    const response = await this.request<WorkflowResponse>(
      'workflows.create',
      this.config.endpoints.workflows.create,
      undefined,
      {
        method: 'POST',
        body: JSON.stringify(workflow)
      },
      'save workflow'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to save workflow');
    }

    return response.data;
  }

  /**
   * Update an existing workflow
   */
  async updateWorkflow(workflowId: string, workflow: Partial<Workflow>): Promise<Workflow> {
    const response = await this.request<WorkflowResponse>(
      'workflows.update',
      this.config.endpoints.workflows.update,
      { id: workflowId },
      {
        method: 'PUT',
        body: JSON.stringify(workflow)
      },
      'update workflow'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to update workflow');
    }

    return response.data;
  }

  /**
   * Load a workflow by ID
   */
  async loadWorkflow(workflowId: string): Promise<Workflow> {
    const response = await this.request<WorkflowResponse>(
      'workflows.get',
      this.config.endpoints.workflows.get,
      { id: workflowId },
      {},
      'load workflow'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to load workflow');
    }

    return response.data;
  }

  /**
   * List all workflows
   */
  async listWorkflows(): Promise<Workflow[]> {
    const response = await this.request<WorkflowsResponse>(
      'workflows.list',
      this.config.endpoints.workflows.list,
      undefined,
      {},
      'list workflows'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to list workflows');
    }

    return response.data;
  }

  /**
   * Delete a workflow
   */
  async deleteWorkflow(workflowId: string): Promise<void> {
    const response = await this.request<ApiResponse<void>>(
      'workflows.delete',
      this.config.endpoints.workflows.delete,
      { id: workflowId },
      { method: 'DELETE' },
      'delete workflow'
    );

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to delete workflow');
    }
  }

  /**
   * Validate a workflow
   */
  async validateWorkflow(workflow: Workflow): Promise<{ valid: boolean; errors: string[] }> {
    const response = await this.request<ApiResponse<{ valid: boolean; errors: string[] }>>(
      'workflows.validate',
      this.config.endpoints.workflows.validate,
      undefined,
      {
        method: 'POST',
        body: JSON.stringify(workflow)
      },
      'validate workflow'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to validate workflow');
    }

    return response.data;
  }

  /**
   * Export a workflow as JSON string
   */
  async exportWorkflow(workflowId: string): Promise<string> {
    const response = await this.request<ApiResponse<string>>(
      'workflows.export',
      this.config.endpoints.workflows.export,
      { id: workflowId },
      {},
      'export workflow'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to export workflow');
    }

    return response.data;
  }

  /**
   * Import a workflow from JSON
   */
  async importWorkflow(workflowJson: string): Promise<Workflow> {
    const response = await this.request<WorkflowResponse>(
      'workflows.import',
      this.config.endpoints.workflows.import,
      undefined,
      {
        method: 'POST',
        body: JSON.stringify({ workflow: workflowJson })
      },
      'import workflow'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to import workflow');
    }

    return response.data;
  }

  // =========================================================================
  // Execution API Methods
  // =========================================================================

  /**
   * Execute a workflow
   */
  async executeWorkflow(
    workflowId: string,
    inputs?: Record<string, unknown>
  ): Promise<ExecutionResult> {
    const response = await this.request<ApiResponse<ExecutionResult>>(
      'executions.execute',
      this.config.endpoints.executions.execute,
      { id: workflowId },
      {
        method: 'POST',
        body: JSON.stringify({ inputs })
      },
      'execute workflow'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to execute workflow');
    }

    return response.data;
  }

  /**
   * Get execution status
   */
  async getExecutionStatus(executionId: string): Promise<ExecutionResult> {
    const response = await this.request<ApiResponse<ExecutionResult>>(
      'executions.status',
      this.config.endpoints.executions.status,
      { id: executionId },
      {},
      'get execution status'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to get execution status');
    }

    return response.data;
  }

  /**
   * Cancel a running execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    const response = await this.request<ApiResponse<void>>(
      'executions.cancel',
      this.config.endpoints.executions.cancel,
      { id: executionId },
      { method: 'POST' },
      'cancel execution'
    );

    if (!response.success) {
      throw new Error(response.error ?? 'Failed to cancel execution');
    }
  }

  /**
   * Get execution logs
   */
  async getExecutionLogs(executionId: string): Promise<string[]> {
    const response = await this.request<ApiResponse<string[]>>(
      'executions.logs',
      this.config.endpoints.executions.logs,
      { id: executionId },
      {},
      'get execution logs'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to get execution logs');
    }

    return response.data;
  }

  // =========================================================================
  // Template API Methods
  // =========================================================================

  /**
   * List available templates
   */
  async listTemplates(): Promise<Workflow[]> {
    const response = await this.request<WorkflowsResponse>(
      'templates.list',
      this.config.endpoints.templates.list,
      undefined,
      {},
      'list templates'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to list templates');
    }

    return response.data;
  }

  /**
   * Get a template by ID
   */
  async getTemplate(templateId: string): Promise<Workflow> {
    const response = await this.request<WorkflowResponse>(
      'templates.get',
      this.config.endpoints.templates.get,
      { id: templateId },
      {},
      'get template'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to get template');
    }

    return response.data;
  }

  // =========================================================================
  // System API Methods
  // =========================================================================

  /**
   * Get system health status
   */
  async getSystemHealth(): Promise<{ status: string; timestamp: number }> {
    const response = await this.request<ApiResponse<{ status: string; timestamp: number }>>(
      'system.health',
      this.config.endpoints.system.health,
      undefined,
      {},
      'get system health'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to get system health');
    }

    return response.data;
  }

  /**
   * Get system configuration
   */
  async getSystemConfig(): Promise<Record<string, unknown>> {
    const response = await this.request<ApiResponse<Record<string, unknown>>>(
      'system.config',
      this.config.endpoints.system.config,
      undefined,
      {},
      'get system config'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to get system config');
    }

    return response.data;
  }

  /**
   * Get system version information
   */
  async getSystemVersion(): Promise<{ version: string; build: string }> {
    const response = await this.request<ApiResponse<{ version: string; build: string }>>(
      'system.version',
      this.config.endpoints.system.version,
      undefined,
      {},
      'get system version'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to get system version');
    }

    return response.data;
  }

  // =========================================================================
  // Pipeline API Methods
  // =========================================================================

  /**
   * Fetch pipeline data including job information and status
   */
  async getPipelineData(pipelineId: string): Promise<PipelineDataResponse> {
    const response = await this.request<ApiResponse<PipelineDataResponse>>(
      'pipelines.get',
      this.config.endpoints.pipelines.get,
      { id: pipelineId },
      {},
      'get pipeline data'
    );

    if (!response.success || !response.data) {
      throw new Error(response.error ?? 'Failed to fetch pipeline data');
    }

    return response.data;
  }
}
