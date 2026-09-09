/**
 * Chat Service
 *
 * Handles API interactions for the LLM Chat feature including
 * sending messages, retrieving history, and clearing history.
 *
 * @module services/chatService
 */

import type {
  ChatRequest,
  ChatHistoryMessage,
  ChatToolResultsRequest,
  ChatTurnResponse
} from '../types/chat.js';
import type { EndpointConfig } from '../config/endpoints.js';
import { buildEndpointUrl } from '../config/endpoints.js';
import { authenticatedFetch } from '../utils/fetchWithAuth.js';
import type { AuthProvider } from '../types/auth.js';
import { logger } from '../utils/logger.js';

/**
 * Chat Service class
 *
 * Provides methods to interact with the chat API endpoints
 * for LLM-powered workflow building assistance.
 */
export class ChatService {
  private static instance: ChatService;

  private constructor() {}

  /**
   * Get the singleton instance of ChatService
   *
   * @returns The ChatService singleton instance
   */
  public static getInstance(): ChatService {
    if (!ChatService.instance) {
      ChatService.instance = new ChatService();
    }
    return ChatService.instance;
  }

  /**
   * Validate and return the caller-supplied endpoint configuration.
   *
   * Callers thread the config from `getInstance().api.config`.
   *
   * @throws Error if endpoint configuration is not set
   * @returns The endpoint configuration
   */
  private getConfig(config: EndpointConfig | null): EndpointConfig {
    if (!config) {
      throw new Error(
        'Endpoint configuration not set. Configure the instance via fd.api.configure().'
      );
    }
    return config;
  }

  /**
   * Generic API request helper
   *
   * @param config - The endpoint configuration
   * @param url - The URL to fetch
   * @param options - Fetch options
   * @returns The parsed JSON response
   */
  private async request<T>(
    config: EndpointConfig,
    url: string,
    options: RequestInit = {},
    authProvider?: AuthProvider
  ): Promise<T> {
    const response = await authenticatedFetch(url, options, {
      config,
      endpointKey: 'chat',
      authProvider
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as { error?: string; message?: string }).error ||
        (errorData as { error?: string; message?: string }).message ||
        `HTTP ${response.status}: ${response.statusText}`;
      throw new Error(errorMessage);
    }
    const json = await response.json();
    // Unwrap the { success, data } envelope used by the Drupal backend.
    if (json && typeof json === 'object' && 'data' in json) {
      return json.data as T;
    }
    return json as T;
  }

  // =========================================================================
  // Chat Operations
  // =========================================================================

  /**
   * Send a message to the chat endpoint.
   *
   * With a {@link ChatTurnRequest} (a `tools` list) a tool-calling server
   * answers a {@link ChatTurnResponse}; a legacy server ignores the list and
   * answers a plain {@link ChatResponse} (no `turnId`). The return type is
   * the union of the two so callers branch on `turnId`.
   *
   * @param workflowId - The workflow ID
   * @param request - The chat request payload
   * @returns The chat response from the LLM
   */
  async sendMessage(
    endpointConfig: EndpointConfig | null,
    workflowId: string,
    request: ChatRequest,
    authProvider?: AuthProvider
  ): Promise<ChatTurnResponse> {
    const config = this.getConfig(endpointConfig);
    const url = buildEndpointUrl(config, config.endpoints.chat.sendMessage, {
      id: workflowId
    });

    logger.debug('[ChatService] Sending message to', url);

    return this.request<ChatTurnResponse>(
      config,
      url,
      {
        method: 'POST',
        body: JSON.stringify(request)
      },
      authProvider
    );
  }

  /**
   * Whether the configured backend has the tool-results door — the
   * precondition for the panel's tools mode.
   */
  supportsToolTurns(endpointConfig: EndpointConfig | null): boolean {
    return typeof endpointConfig?.endpoints?.chat?.toolResults === 'string';
  }

  /**
   * Continue a tool-calling turn with the results of the calls the assistant
   * made. The server runs the reasoner again and answers either more calls
   * (`done: false`) or the final text (`done: true`).
   *
   * @throws Error when the backend has no `chat.toolResults` endpoint
   */
  async sendToolResults(
    endpointConfig: EndpointConfig | null,
    workflowId: string,
    turnId: string,
    request: ChatToolResultsRequest,
    authProvider?: AuthProvider
  ): Promise<ChatTurnResponse> {
    const config = this.getConfig(endpointConfig);
    const template = config.endpoints.chat.toolResults;
    if (!template) {
      throw new Error('This backend has no chat tool-results endpoint.');
    }
    const url = buildEndpointUrl(config, template, { id: workflowId, turnId });

    logger.debug('[ChatService] Posting tool results to', url);

    return this.request<ChatTurnResponse>(
      config,
      url,
      {
        method: 'POST',
        body: JSON.stringify(request)
      },
      authProvider
    );
  }

  /**
   * Get conversation history for a workflow
   *
   * @param workflowId - The workflow ID
   * @returns Array of chat history messages
   */
  async getHistory(
    endpointConfig: EndpointConfig | null,
    workflowId: string,
    authProvider?: AuthProvider
  ): Promise<ChatHistoryMessage[]> {
    const config = this.getConfig(endpointConfig);
    const url = buildEndpointUrl(config, config.endpoints.chat.getHistory, {
      id: workflowId
    });

    logger.debug('[ChatService] Getting history from', url);

    return this.request<ChatHistoryMessage[]>(config, url, {}, authProvider);
  }

  /**
   * Clear conversation history for a workflow
   *
   * @param workflowId - The workflow ID
   */
  async clearHistory(
    endpointConfig: EndpointConfig | null,
    workflowId: string,
    authProvider?: AuthProvider
  ): Promise<void> {
    const config = this.getConfig(endpointConfig);
    const url = buildEndpointUrl(config, config.endpoints.chat.clearHistory, {
      id: workflowId
    });

    logger.debug('[ChatService] Clearing history at', url);

    await authenticatedFetch(
      url,
      { method: 'DELETE' },
      { config, endpointKey: 'chat', authProvider }
    );
  }
}

/**
 * Pre-instantiated ChatService singleton
 */
export const chatService = ChatService.getInstance();
