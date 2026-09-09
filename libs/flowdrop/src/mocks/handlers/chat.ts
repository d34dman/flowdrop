/**
 * MSW handlers for Chat API endpoints
 *
 * Implements mock handlers for the LLM chat feature including
 * sending messages, retrieving history, and clearing history.
 */

import { http, HttpResponse } from 'msw';
import { getHistory, addMessage, clearHistory, generateMockResponse } from '../data/chat.js';

/** Base API path for flowdrop endpoints */
const API_BASE = '/api/flowdrop';

/**
 * POST /api/flowdrop/workflows/:id/chat/messages
 * Send a chat message and receive a mock LLM response
 */
export const sendMessageHandler = http.post(
  `${API_BASE}/workflows/:id/chat/messages`,
  async ({ params, request }) => {
    const { id } = params;
    const workflowId = Array.isArray(id) ? id[0] : id;

    let body: {
      message?: string;
      workflowState?: unknown;
      history?: unknown[];
      tools?: Array<{ name: string }>;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return HttpResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.message || typeof body.message !== 'string') {
      return HttpResponse.json({ success: false, error: 'Message is required' }, { status: 400 });
    }

    // Store the user message
    addMessage(workflowId, 'user', body.message);

    // A tool-calling turn: the panel sent its tool catalogue. Script one round
    // of reads so the tools-mode UI can be exercised without a real backend —
    // the reply then quotes what the tools returned.
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      const names = new Set(body.tools.map((t) => t.name));
      const turnId = `turn-${++turnCounter}`;
      const toolCalls = [
        names.has('list_nodes') ? { id: `${turnId}-c1`, name: 'list_nodes', args: {} } : null,
        names.has('list_types') ? { id: `${turnId}-c2`, name: 'list_types', args: {} } : null
      ].filter((c): c is { id: string; name: string; args: Record<string, never> } => c !== null);
      openTurns.set(turnId, { workflowId, message: body.message });
      return HttpResponse.json({ turnId, done: false, toolCalls });
    }

    // Generate mock LLM response
    const { content, conversationId } = generateMockResponse(body.message, workflowId);

    // Store the assistant response
    addMessage(workflowId, 'assistant', content);

    return HttpResponse.json({ content, conversationId });
  }
);

/**
 * GET /api/flowdrop/workflows/:id/chat/messages
 * Get conversation history for a workflow
 */
export const getHistoryHandler = http.get(
  `${API_BASE}/workflows/:id/chat/messages`,
  ({ params }) => {
    const { id } = params;
    const workflowId = Array.isArray(id) ? id[0] : id;

    const history = getHistory(workflowId);

    return HttpResponse.json(history);
  }
);

/**
 * DELETE /api/flowdrop/workflows/:id/chat/messages
 * Clear conversation history for a workflow
 */
export const clearHistoryHandler = http.delete(
  `${API_BASE}/workflows/:id/chat/messages`,
  ({ params }) => {
    const { id } = params;
    const workflowId = Array.isArray(id) ? id[0] : id;

    clearHistory(workflowId);

    return HttpResponse.json({
      success: true,
      message: 'History cleared'
    });
  }
);

/** Open tool-calling turns of the mock (turnId → who asked what). */
const openTurns = new Map<string, { workflowId: string; message: string }>();
let turnCounter = 0;

/**
 * POST /api/flowdrop/workflows/:id/chat/turns/:turnId/tool-results
 * Continue a tool-calling turn: the mock ends it after one round, quoting
 * the tool results it was given.
 */
export const toolResultsHandler = http.post(
  `${API_BASE}/workflows/:id/chat/turns/:turnId/tool-results`,
  async ({ params, request }) => {
    const turnId = String(Array.isArray(params.turnId) ? params.turnId[0] : params.turnId);
    const turn = openTurns.get(turnId);
    if (!turn) {
      return HttpResponse.json(
        { success: false, error: 'Unknown or finished turn', error_code: 'NOT_FOUND' },
        { status: 404 }
      );
    }
    let body: { results?: Array<{ toolCallId: string; content: string; isError?: boolean }> };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return HttpResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }
    openTurns.delete(turnId);

    const lines = (body.results ?? []).map((r) => {
      let summary = r.content;
      try {
        const parsed = JSON.parse(r.content) as { message?: string; data?: unknown };
        summary = parsed.message ?? JSON.stringify(parsed.data ?? parsed).slice(0, 200);
      } catch {
        // keep the raw text
      }
      return `- \`${r.toolCallId}\`${r.isError ? ' (error)' : ''}: ${summary}`;
    });
    const content = [
      `You asked: "${turn.message}". I looked at the workflow first:`,
      '',
      ...lines,
      '',
      '_(mock backend: one round of reads, then this reply)_'
    ].join('\n');
    addMessage(turn.workflowId, 'assistant', content);
    return HttpResponse.json({ turnId, done: true, content });
  }
);

/**
 * Export all chat handlers
 */
export const chatHandlers = [
  sendMessageHandler,
  toolResultsHandler,
  getHistoryHandler,
  clearHistoryHandler
];

/**
 * Create a stateful handler that returns `responses` in sequence.
 * Designed for testing the auto-retry flow: provide the initial response
 * (with commands that will fail) followed by a corrected response.
 *
 * Usage in tests:
 * ```ts
 * server.use(createRetryScenarioHandler([
 *   // First call — commands that executeBatch will fail on
 *   "I'll add that.\n```flowdrop\nadd bad_type\n```",
 *   // Retry call — corrected commands after the error report
 *   "Let me fix that.\n```flowdrop\nadd http_node\n```",
 * ]));
 * ```
 *
 * Once all responses are consumed the last one repeats.
 */
export function createRetryScenarioHandler(responses: string[]) {
  if (responses.length === 0) throw new Error('responses must not be empty');
  let callIndex = 0;
  return http.post(`${API_BASE}/workflows/:id/chat/messages`, async () => {
    const content = responses[Math.min(callIndex++, responses.length - 1)];
    return HttpResponse.json({ content, conversationId: 'test-retry-conv' });
  });
}
