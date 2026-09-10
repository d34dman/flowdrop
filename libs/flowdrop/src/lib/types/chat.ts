/**
 * Chat Types for FlowDrop LLM Chat Interface
 *
 * Provides type definitions for the chat panel's communication
 * with backend LLM integrations.
 *
 * @module types/chat
 */

// =========================================================================
// Message Types
// =========================================================================

/**
 * Role for chat history messages
 */
export type ChatMessageRole = 'user' | 'assistant';

/**
 * A single message in the chat history
 */
export interface ChatHistoryMessage {
  role: ChatMessageRole;
  content: string;
}

// =========================================================================
// Request / Response
// =========================================================================

/**
 * Request payload sent to the chat endpoint
 */
export interface ChatRequest {
  /** The user's natural language message */
  message: string;
  /** Serialized current workflow state (nodes + edges) */
  workflowState: unknown;
  /** Optional conversation history for context */
  history?: ChatHistoryMessage[];
}

/**
 * Response payload from the chat endpoint
 */
export interface ChatResponse {
  /** The LLM's response content (may contain markdown and code blocks) */
  content: string;
  /** Optional conversation ID for backend session tracking */
  conversationId?: string;
}

// =========================================================================
// Command Extraction
// =========================================================================

/**
 * Result of parsing an LLM response to extract DSL commands
 */
export interface ExtractedCommands {
  /** The full explanation text (content outside code blocks) */
  explanation: string;
  /** Extracted DSL command strings */
  commands: string[];
}

// =========================================================================
// Command Preview / Execution
// =========================================================================

/**
 * Status of a single command in the preview
 *
 * `skipped` means the command was intentionally not run (e.g. a layout command
 * while `chatAllowLayoutChanges` is off) — it is not a failure and does not
 * trigger retry feedback.
 */
export type CommandExecutionStatus = 'pending' | 'executing' | 'success' | 'error' | 'skipped';

/**
 * A single command shown in the command preview UI
 */
export interface CommandPreviewItem {
  /** The raw DSL command string */
  raw: string;
  /** Current execution status */
  status: CommandExecutionStatus;
  /** Optional result or error message after execution */
  result?: string;
}

// =========================================================================
// Tool-calling turns (2.8.0)
// =========================================================================

/**
 * One tool as the panel offers it to the server, in the shape a function-
 * calling reasoner expects: `{name, description, input_schema}` plus the
 * read-only flag. Projected from the editor's tool descriptors by
 * `toToolDefinitions()`; the server holds no copy of these schemas.
 *
 * Names are the bare verbs (`describe_type`, `batch`, `save`) — no prefix.
 */
export interface ChatToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  readOnly: boolean;
}

/** A tool call the assistant made; the panel runs it and posts the result. */
export interface ChatToolCall {
  /** Server-issued id, echoed back as `toolCallId`. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * The first request of a turn. A superset of {@link ChatRequest}: a server
 * that knows tool-calling turns reads `tools`; an older one ignores it and
 * answers a plain {@link ChatResponse}, which the panel treats as legacy.
 */
export interface ChatTurnRequest extends ChatRequest {
  /** The tools the panel can run for this turn, in call order preference. */
  tools: ChatToolDefinition[];
}

/** One tool result, posted back to continue the turn. */
export interface ChatToolResult {
  toolCallId: string;
  /** The tool's result as text — the JSON the runtime returned. */
  content: string;
  /** Set when the tool reported an error (`isError` on the tool result). */
  isError?: boolean;
}

export interface ChatToolResultsRequest {
  results: ChatToolResult[];
}

/**
 * What the server answers to a turn request or a tool-results post.
 *
 * `done: true` carries the assistant's final `content`; `done: false`
 * carries `toolCalls` the panel must run and post back. `turnId` is present
 * on every response of a tool-calling server; its absence marks a legacy
 * server and a plain {@link ChatResponse}.
 *
 * `content` may also accompany `toolCalls` on a non-final response
 * (`done: false`): text the model wrote alongside its calls — a note to the
 * user, e.g. "this node has no url input port" — rather than the reply.
 * Shown in the trace, never as the message body.
 */
export interface ChatTurnResponse extends ChatResponse {
  turnId?: string;
  toolCalls?: ChatToolCall[];
  done?: boolean;
}
