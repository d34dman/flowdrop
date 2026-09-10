/**
 * Chat — the turn driver.
 *
 * One user message is one *turn*. The driver sends it with the tool
 * catalogue, and while the server answers with tool calls it runs each call
 * through the tool runtime — the same validation, gate and batch a WebMCP
 * browser agent goes through — posts the results back, and repeats until the
 * server says the turn is done or something stops it.
 *
 * The driver knows nothing of Svelte or the DOM: it takes the three functions
 * it needs (`send`, `sendToolResults`, `runTool`) and reports what happens
 * as events the panel renders. Rejection at the gate is not an error here —
 * the `REJECTED` result goes back to the model, which gets to explain or ask.
 *
 * @module chat/turnDriver
 */

import type {
  ChatToolCall,
  ChatToolResult,
  ChatToolResultsRequest,
  ChatTurnRequest,
  ChatTurnResponse
} from '../types/chat.js';
import type { ToolPreview, ToolResult } from '../webmcp/types.js';

// ============================================================================
// Events
// ============================================================================

/** The parsed `{ok, code, …}` payload of a tool result, when it parses. */
export interface ToolOutcome {
  ok: boolean;
  code?: string;
  message?: string;
  error?: string;
}

export type TurnEvent =
  /** A read or view call is about to run; nothing to approve. */
  | { type: 'reading'; call: ChatToolCall; preview: ToolPreview | null }
  /** The call is about to wait on the gate (`preview.asks`). */
  | { type: 'awaiting-approval'; call: ChatToolCall; preview: ToolPreview | null }
  /** The call ran and reported `ok`. */
  | { type: 'applied'; call: ChatToolCall; preview: ToolPreview | null; outcome: ToolOutcome }
  /** The person rejected the call in the dialog. */
  | { type: 'rejected'; call: ChatToolCall; preview: ToolPreview | null; outcome: ToolOutcome }
  /** The call failed for any other reason; the result goes back to the model. */
  | { type: 'failed'; call: ChatToolCall; preview: ToolPreview | null; outcome: ToolOutcome }
  /** Every call of a round ran; the results are being posted. */
  | { type: 'round-complete'; round: number; results: ChatToolResult[] }
  /** The server ended the turn with text. */
  | { type: 'final'; content: string; rounds: number };

export type TurnOutcome =
  /** A tool-calling server finished the turn. */
  | { kind: 'final'; content: string; rounds: number; turnId: string }
  /**
   * The first response had no `turnId`: a legacy server that answered a plain
   * chat response. `content` is what it said; the caller falls back to the
   * text mode for the rest of the session.
   */
  | { kind: 'legacy'; content: string }
  /**
   * The driver stopped the loop itself: past `maxRounds`, or the server
   * continued the turn (`done: false`) without a single tool call to run.
   */
  | { kind: 'aborted'; reason: string; rounds: number; turnId: string };

// ============================================================================
// Dependencies
// ============================================================================

export interface TurnDriverDeps {
  send(request: ChatTurnRequest): Promise<ChatTurnResponse>;
  sendToolResults(turnId: string, request: ChatToolResultsRequest): Promise<ChatTurnResponse>;
  /** The tool runtime's `runTool`; never expected to throw for a bad call. */
  runTool(name: string, input: unknown): Promise<ToolResult>;
  /** The tool runtime's `preview`, for the events. Optional. */
  preview?(name: string, input: unknown): ToolPreview | null;
  onEvent?(event: TurnEvent): void;
  /**
   * Client-side bound on rounds, a backstop for a server whose own bound
   * (`max_tool_rounds`, D6) failed. Default 32 — well above any server
   * default, so the server's bound is the one that normally speaks.
   */
  maxRounds?: number;
}

// ============================================================================
// Helpers
// ============================================================================

/** The JSON text of a tool result, as the runtime writes it. */
export function toolResultText(result: ToolResult): string {
  return result.content.map((c) => c.text).join('\n');
}

/** Parse the runtime's `{ok, code, …}` payload; a non-JSON text is an opaque success. */
export function parseOutcome(result: ToolResult): ToolOutcome {
  try {
    const parsed = JSON.parse(toolResultText(result)) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      return {
        ok: parsed.ok !== false && !result.isError,
        ...(typeof parsed.code === 'string' ? { code: parsed.code } : {}),
        ...(typeof parsed.message === 'string' ? { message: parsed.message } : {}),
        ...(typeof parsed.error === 'string' ? { error: parsed.error } : {})
      };
    }
  } catch {
    // Not JSON — fall through.
  }
  return { ok: !result.isError };
}

function isLegacy(response: ChatTurnResponse): boolean {
  return typeof response.turnId !== 'string' || response.turnId.length === 0;
}

// ============================================================================
// runTurn
// ============================================================================

/**
 * Drive one turn to its end. Rejects only when a request fails (network,
 * HTTP error) — the caller shows that as an error bubble; every tool-level
 * failure is a result the model reads.
 */
export async function runTurn(
  request: ChatTurnRequest,
  deps: TurnDriverDeps
): Promise<TurnOutcome> {
  const emit = deps.onEvent ?? (() => undefined);
  const preview = deps.preview ?? (() => null);
  const maxRounds = deps.maxRounds ?? 32;

  let response = await deps.send(request);
  if (isLegacy(response)) {
    return { kind: 'legacy', content: response.content ?? '' };
  }
  const turnId = response.turnId as string;
  let rounds = 0;

  while (!response.done) {
    if (!response.toolCalls || response.toolCalls.length === 0) {
      // Not a reply and nothing to run: a protocol error, named as one rather
      // than rendered as an empty answer.
      return {
        kind: 'aborted',
        reason: 'The server continued the turn without any tool calls to run.',
        rounds,
        turnId
      };
    }
    rounds++;
    if (rounds > maxRounds) {
      return {
        kind: 'aborted',
        reason: `The assistant made ${rounds} rounds of tool calls without finishing; stopped.`,
        rounds: rounds - 1,
        turnId
      };
    }

    const results: ChatToolResult[] = [];
    // Sequential on purpose: the gate can hold one decision at a time, and
    // a batch's outcome may change what the next call finds.
    for (const call of response.toolCalls) {
      const seen = preview(call.name, call.args);
      emit({ type: seen?.asks ? 'awaiting-approval' : 'reading', call, preview: seen });

      const result = await deps.runTool(call.name, call.args);
      const outcome = parseOutcome(result);
      if (outcome.ok) {
        emit({ type: 'applied', call, preview: seen, outcome });
      } else if (outcome.code === 'REJECTED') {
        emit({ type: 'rejected', call, preview: seen, outcome });
      } else {
        emit({ type: 'failed', call, preview: seen, outcome });
      }
      results.push({
        toolCallId: call.id,
        content: toolResultText(result),
        ...(result.isError ? { isError: true } : {})
      });
    }

    emit({ type: 'round-complete', round: rounds, results });
    response = await deps.sendToolResults(turnId, { results });
  }

  const content = response.content ?? '';
  emit({ type: 'final', content, rounds });
  return { kind: 'final', content, rounds, turnId };
}
