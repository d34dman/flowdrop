<script lang="ts">
  import type { ChatHistoryMessage, ChatRequest, CommandPreviewItem } from '../../types/chat.js';
  import type { NodeMetadata } from '../../types/index.js';
  import type { UIAction } from '../../commands/types.js';
  import type { EndpointConfig } from '../../config/endpoints.js';
  import { chatService } from '../../services/chatService.js';
  import { getInstance } from '../../stores/getInstance.svelte.js';
  import { getBehaviorSettings } from '../../stores/settingsStore.svelte.js';
  import { extractCommands } from '../../chat/responseParser.js';
  import { buildApiHistory } from '../../chat/historyBuilder.js';
  import { isMutatingCommand, isLayoutCommand } from '../../chat/commandClassifier.js';
  import { parseCommand } from '../../commands/parser.js';
  import { executeCommand } from '../../commands/index.js';
  import { createStoreCommandContext } from '../../commands/storeIntegration.svelte.js';
  import {
    buildRetryFeedback,
    type BatchOutcome,
    type ParseFailure
  } from '../../chat/batchFeedback.js';
  import { toToolDefinitions } from '../../chat/toolCatalogue.js';
  import { runTurn, type TurnEvent } from '../../chat/turnDriver.js';
  import type { ToolPreview, ToolRuntime } from '../../webmcp/types.js';
  // Pure describers, no DOM: safe in the editor's static graph. The runtime
  // itself (dialog included) stays behind a dynamic import in ensureRuntime.
  import { describeCommand, summarizeCommands } from '../../webmcp/descriptors.js';
  import CommandPreview from './CommandPreview.svelte';
  import MarkdownDisplay from '../MarkdownDisplay.svelte';
  import { onDestroy, tick } from 'svelte';
  import Icon from '@iconify/svelte';
  import { getMessages, m } from '$lib/messages/index.js';

  // =========================================================================
  // Internal Display Message Type
  // =========================================================================

  interface DisplayMessage {
    role: 'user' | 'assistant';
    content: string;
    /**
     * The unmodified LLM response, kept when `content` is the explanation-only
     * display text. Sent as history so the assistant sees the DSL it emitted
     * (issue #35).
     */
    rawContent?: string;
    /** Set on auto-retry messages — renders as a muted notice, not a user bubble */
    retryAttempt?: number;
    /** Mutating commands awaiting approval */
    commandPreview?: CommandPreviewItem[];
    /** Results from auto-executed read-only commands */
    readOnlyResults?: string[];
    /** Set when the user dismissed this message's command preview */
    commandsDismissed?: boolean;
    /** Tools mode: one compact status line per tool call of this turn */
    toolLines?: ToolLine[];
    /** Set on the assistant placeholder while its reply is still coming */
    inProgress?: boolean;
    /** Tools mode: a muted notice (legacy fallback, abort) rather than a reply */
    notice?: boolean;
    /** Tools mode: a deterministic warning under the reply, e.g. tool calls failed this turn */
    warning?: string;
  }

  /** One tool call as the transcript shows it: what ran and how it ended. */
  interface ToolLine {
    status: 'running' | 'ok' | 'rejected' | 'failed' | 'note';
    text: string;
  }

  interface Props {
    nodeTypes: NodeMetadata[];
    workflowId?: string;
    onUIAction?: (action: UIAction) => void;
    endpointConfig?: EndpointConfig | null;
  }

  let { nodeTypes, workflowId, onUIAction, endpointConfig }: Props = $props();

  const fd = getInstance();

  // The messages getter, read once at init: the tool runtime's dialog mounts
  // outside this component tree and must not touch Svelte context at call time.
  const messages = getMessages();

  // Hoist the chat branch — read in placeholder, header, three welcome states,
  // auto-retry banner, and the send button aria-label.
  const t = $derived(m().chat);

  // =========================================================================
  // State
  // =========================================================================

  const MAX_AUTO_RETRIES = 3;

  let displayMessages: DisplayMessage[] = $state([]);
  let inputValue: string = $state('');
  let isLoading: boolean = $state(false);
  let inputElement: HTMLTextAreaElement | undefined = $state();
  let messagesElement: HTMLDivElement | undefined = $state();
  let autoRetryCount = 0;

  // ---- tools mode -----------------------------------------------------------

  /**
   * Set once the first response of the session came from a server without
   * tool-calling turns (no `turnId`). The session then stays in the text mode;
   * a reload tries tools again.
   */
  let legacyFallback: boolean = $state(false);
  let runtime: ToolRuntime | null = null;
  /** True when this panel created `fd.approvalGate`, so only then may it clear it. */
  let publishedGate = false;
  /** Set on unmount; a turn still in flight releases the runtime when it ends. */
  let destroyed = false;

  /**
   * Whether this turn drives tools. The setting asks for it, the backend
   * declares the tool-results door, and no earlier reply proved it legacy.
   */
  const toolsMode = $derived(
    getBehaviorSettings().chatMode === 'tools' &&
      chatService.supportsToolTurns(endpointConfig ?? null) &&
      !legacyFallback
  );

  /**
   * Let go of the runtime. The gate is cleared from the instance only when this
   * panel published it — the registration's gate is the registration's to
   * clear, and taking it away would leave the next panel building a second one.
   */
  function releaseRuntime(): void {
    if (!runtime) return;
    if (publishedGate && fd.approvalGate === runtime.gate) fd.approvalGate = null;
    publishedGate = false;
    runtime.dispose();
    runtime = null;
  }

  onDestroy(() => {
    destroyed = true;
    // Unpublish at once so a panel mounted after us builds its own gate; but a
    // turn still running keeps its runtime, or the rest of its calls would
    // answer DETACHED to a model that can see the editor is fine.
    if (runtime && publishedGate && fd.approvalGate === runtime.gate) {
      fd.approvalGate = null;
      publishedGate = false;
    }
    if (!isLoading) releaseRuntime();
  });

  // =========================================================================
  // Derived State
  // =========================================================================

  const isDisabled = $derived(!workflowId);
  const isChatConfigured = $derived(endpointConfig?.endpoints?.chat !== undefined);
  const canSend = $derived(
    inputValue.trim().length > 0 && !isLoading && !isDisabled && isChatConfigured
  );

  // =========================================================================
  // Auto-scroll
  // =========================================================================

  $effect(() => {
    // Read scroll-relevant state so the effect re-runs when messages change —
    // including the tool trace and reply growing on the last message.
    const last = displayMessages[displayMessages.length - 1];
    const _deps = [displayMessages.length, isLoading, last?.toolLines?.length, last?.content];
    tick().then(() => {
      if (messagesElement) {
        messagesElement.scrollTop = messagesElement.scrollHeight;
      }
    });
  });

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Build conversation history from display messages for API requests.
   *
   * Read at send time, so each assistant entry reports the *current* status of
   * the commands it emitted — applied, dismissed, failed or still pending.
   */
  function getHistory(): ChatHistoryMessage[] {
    return buildApiHistory(displayMessages);
  }

  function getWorkflowState(): unknown {
    const workflow = fd.workflow.current;
    if (!workflow) return null;
    return {
      nodes: workflow.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        data: n.data,
        position: n.position
      })),
      edges: workflow.edges.map((e) => ({
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        targetHandle: e.targetHandle
      }))
    };
  }

  function getCommandContext() {
    return createStoreCommandContext(nodeTypes, onUIAction, fd);
  }

  // =========================================================================
  // Tools mode
  // =========================================================================

  /**
   * The tool runtime for this panel: the same `runTool()` the WebMCP
   * registration uses, with this editor's host hooks (`fd.host`) behind
   * `save` / `run` / `run_status`. The gate is the editor's one shared gate
   * (`fd.approvalGate`): reused when the registration published it first,
   * published by us otherwise, so one "don't ask again" covers both surfaces
   * and two dialogs never stack. Only the dialog title is ours — it is the
   * assistant asking, not an unknown agent on the page. Loaded on demand so
   * the adapter stays out of the editor's static graph.
   */
  async function ensureRuntime(): Promise<ToolRuntime> {
    if (runtime && !runtime.disposed) return runtime;
    const { createToolRuntime } = await import('../../webmcp/index.js');
    const shared = fd.approvalGate;
    runtime = createToolRuntime({
      instance: fd,
      nodeTypes: () => nodeTypes,
      onUIAction,
      hooks: fd.host.current,
      gate: shared ?? undefined,
      approval: 'confirm',
      messages,
      dialogTitle: (name) => messages().chat.tools.confirmTitle({ name })
    });
    if (!shared) {
      fd.approvalGate = runtime.gate;
      publishedGate = true;
    }
    return runtime;
  }

  /** Primitive argument values of a call, for a status line: `describe_type http_request`. */
  function argsDetail(args: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const value of Object.values(args)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        parts.push(String(value));
      }
    }
    const text = parts.join(' ');
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  }

  /**
   * What a call changed, for the transcript, in the dialog's own words: the
   * batch summary for several commands, the one-line description for one,
   * the host's message for `save` / `run` / `run_status`.
   */
  function appliedDetail(preview: ToolPreview | null, outcome: { message?: string }): string {
    if (preview && preview.commands.length > 0) {
      if (preview.commands.length === 1) return describeCommand(preview.commands[0]);
      return summarizeCommands(preview.commands, messages().webmcp) ?? '';
    }
    return outcome.message ?? '';
  }

  function lastLine(msg: DisplayMessage): ToolLine | undefined {
    return msg.toolLines?.[msg.toolLines.length - 1];
  }

  /**
   * Render a driver event onto the in-progress assistant message. Synchronous
   * on purpose: events arrive in order and land in order.
   */
  function renderEvent(msg: DisplayMessage, event: TurnEvent): void {
    const tt = t.tools;
    switch (event.type) {
      case 'note':
        msg.toolLines?.push({ status: 'note', text: event.content });
        break;
      case 'reading':
        msg.toolLines?.push({
          status: 'running',
          text: tt.reading({ tool: event.call.name, detail: argsDetail(event.call.args) })
        });
        break;
      case 'awaiting-approval':
        msg.toolLines?.push({
          status: 'running',
          text: tt.awaitingApproval({ tool: event.call.name })
        });
        break;
      case 'applied': {
        const line = lastLine(msg);
        if (line) {
          line.status = 'ok';
          line.text = event.preview?.mutating
            ? tt.applied({
                tool: event.call.name,
                detail: appliedDetail(event.preview, event.outcome)
              })
            : tt.read({ tool: event.call.name, detail: argsDetail(event.call.args) });
        }
        break;
      }
      case 'rejected': {
        const line = lastLine(msg);
        if (line) {
          line.status = 'rejected';
          line.text = tt.rejected({ tool: event.call.name });
        }
        break;
      }
      case 'failed': {
        const line = lastLine(msg);
        if (line) {
          line.status = 'failed';
          line.text = tt.failed({
            tool: event.call.name,
            error: event.outcome.error ?? event.outcome.code ?? 'error'
          });
        }
        break;
      }
      case 'round-complete':
      case 'final':
        break;
    }
  }

  /** One user message as a tool-calling turn. */
  async function sendToolTurn(text: string): Promise<void> {
    displayMessages.push({ role: 'user', content: text });
    isLoading = true;

    const progress: DisplayMessage = {
      role: 'assistant',
      content: '',
      toolLines: [],
      inProgress: true
    };
    displayMessages.push(progress);
    // The pushed object is proxied by the state array; mutate the proxy.
    const msg = displayMessages[displayMessages.length - 1];

    try {
      const rt = await ensureRuntime();
      const history = getHistory();
      const outcome = await runTurn(
        {
          message: text,
          workflowState: getWorkflowState(),
          history: history.slice(0, -2), // all except this message and the placeholder
          tools: toToolDefinitions(rt)
        },
        {
          send: (request) =>
            chatService.sendMessage(fd.api.config, workflowId ?? '', request, fd.api.authProvider),
          sendToolResults: (turnId, request) =>
            chatService.sendToolResults(
              fd.api.config,
              workflowId ?? '',
              turnId,
              request,
              fd.api.authProvider
            ),
          runTool: (name, input) => rt.runTool(name, input),
          preview: (name, input) => rt.preview(name, input),
          onEvent: (event) => renderEvent(msg, event)
        }
      );

      if (outcome.kind === 'legacy') {
        // An older server: keep its reply, and stay in the text mode from now on.
        legacyFallback = true;
        displayMessages.splice(displayMessages.length - 1, 1);
        displayMessages.push({ role: 'assistant', content: t.tools.legacyFallback, notice: true });
        displayMessages.push(processResponse(outcome.content));
        return;
      }
      if (outcome.kind === 'aborted') {
        msg.content = t.tools.aborted({ reason: outcome.reason });
      } else {
        msg.content = outcome.content;
        if (outcome.failed > 0) {
          msg.warning = t.tools.failedSummary({ count: outcome.failed });
        }
      }
      if ((msg.toolLines?.length ?? 0) === 0) msg.toolLines = undefined;
    } catch (err) {
      msg.content = `Error: ${err instanceof Error ? err.message : 'Failed to send message'}`;
    } finally {
      msg.inProgress = false;
      isLoading = false;
      if (destroyed) releaseRuntime();
      else tick().then(() => inputElement?.focus());
    }
  }

  // =========================================================================
  // Command Execution
  // =========================================================================

  /**
   * Process an LLM response: extract commands, auto-execute read-only ones,
   * and queue mutating ones for approval via CommandPreview.
   */
  function processResponse(responseContent: string): DisplayMessage {
    const { explanation, commands } = extractCommands(responseContent);

    // No commands — pure chat message
    if (commands.length === 0) {
      return { role: 'assistant', content: explanation || responseContent };
    }

    const context = getCommandContext();
    const readOnlyResults: string[] = [];
    const mutatingCommands: CommandPreviewItem[] = [];

    for (const raw of commands) {
      const parsed = parseCommand(raw);
      if (!parsed.ok) {
        // Treat parse errors as mutating (show in preview as error)
        mutatingCommands.push({ raw, status: 'error', result: parsed.error });
        continue;
      }

      if (!isMutatingCommand(parsed.command.type)) {
        // Auto-execute read-only commands
        if (context) {
          const result = executeCommand(parsed.command, context);
          if (result.ok) {
            readOnlyResults.push(`> ${raw}\n${result.message}`);
          } else {
            readOnlyResults.push(`> ${raw}\nError: ${result.error}`);
          }
        } else {
          readOnlyResults.push(`> ${raw}\nError: No workflow loaded`);
        }
      } else {
        mutatingCommands.push({ raw, status: 'pending' });
      }
    }

    const msg: DisplayMessage = {
      role: 'assistant',
      content: explanation || responseContent,
      rawContent: responseContent
    };

    if (readOnlyResults.length > 0) {
      msg.readOnlyResults = readOnlyResults;
    }
    if (mutatingCommands.length > 0) {
      msg.commandPreview = mutatingCommands;
    }

    return msg;
  }

  /**
   * Execute the parseable commands in a batch one by one with progressive UI
   * feedback.
   *
   * Commands that failed to parse are *isolated* — they stay marked as errors
   * and are skipped, but they no longer abort the whole batch, so the healthy
   * subset still applies (matching the long-standing "applied to a certain
   * extent" expectation). After execution, if anything failed to parse or
   * execute and auto-retry is enabled, specific feedback is sent back so the
   * assistant can resend corrected commands.
   */
  async function handleApproveCommands(messageIndex: number) {
    const msg = displayMessages[messageIndex];
    if (!msg?.commandPreview) return;

    const context = getCommandContext();
    if (!context) {
      for (const cmd of msg.commandPreview) {
        if (cmd.status === 'pending') {
          cmd.status = 'error';
          cmd.result = 'No workflow loaded';
        }
      }
      appendErrorToHistory('Command execution failed: No workflow loaded');
      return;
    }

    // Commands that failed to parse (in processResponse) are isolated, not run.
    // Capture their raw text + reason so we can feed specific corrections back.
    const parseErrors: ParseFailure[] = msg.commandPreview
      .filter((c) => c.status === 'error')
      .map((c) => ({ raw: c.raw, error: c.result ?? 'Parse error' }));

    // Re-parse the pending (parseable) commands, preserving order.
    const pendingItems = msg.commandPreview.filter((c) => c.status === 'pending');
    const parsedCommands: {
      item: CommandPreviewItem;
      command: import('../../commands/types.js').Command;
    }[] = [];

    // Layout commands rewrite every node's position, so they wipe a hand-crafted
    // arrangement. Honour the user's opt-out by skipping them instead of running
    // them — a skip is not a failure, so the rest of the batch still applies and
    // no retry feedback is sent (issue #36).
    const allowLayoutChanges = getBehaviorSettings().chatAllowLayoutChanges;

    for (const item of pendingItems) {
      const parsed = parseCommand(item.raw);
      if (!parsed.ok) {
        // Re-parse disagreed with processResponse — isolate it like a parse error.
        item.status = 'error';
        item.result = parsed.error;
        parseErrors.push({ raw: item.raw, error: parsed.error });
        continue;
      }
      if (!allowLayoutChanges && isLayoutCommand(parsed.command.type)) {
        item.status = 'skipped';
        item.result = t.commandPreview.layoutSkipped;
        continue;
      }
      parsedCommands.push({ item, command: parsed.command });
    }

    const totalCount = parsedCommands.length;

    // Everything was intentionally skipped (layout commands with layout changes
    // off) — nothing failed, so there is nothing to report or retry.
    if (totalCount === 0 && parseErrors.length === 0) {
      return;
    }

    // Nothing parseable to run — feed the parse errors straight back so the
    // assistant can resend a corrected batch.
    if (totalCount === 0) {
      await resolveBatchOutcome({
        completedCount: 0,
        executionError: undefined,
        rolledBack: false,
        parseErrors
      });
      return;
    }

    // Execute the healthy subset one by one inside a single transaction.
    // A 100ms pause between commands lets the canvas visibly update at each step.
    context.dispatch.startTransaction(
      totalCount === 1 ? 'batch: 1 command' : `batch: ${totalCount} commands`
    );

    let completedCount = 0;
    let executionError: string | undefined;

    try {
      for (let i = 0; i < parsedCommands.length; i++) {
        const { item, command } = parsedCommands[i];
        item.status = 'executing';

        const result = executeCommand(command, context);

        if (!result.ok) {
          item.status = 'error';
          item.result = result.error;
          executionError = result.error;
          context.dispatch.cancelTransaction();
          break;
        }

        item.status = 'success';
        item.result = result.message;
        completedCount++;

        // Pause between commands so canvas updates are visibly distinct
        if (i < parsedCommands.length - 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 100));
        }
      }
    } catch (err) {
      context.dispatch.cancelTransaction();
      for (const { item } of parsedCommands) {
        if (item.status === 'executing') item.status = 'pending';
      }
      appendErrorToHistory(
        `Unexpected execution error: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    if (executionError !== undefined) {
      // An executed command failed — the whole batch is rolled back (atomic,
      // long-standing behaviour). Retry feedback covers both the execution
      // failure and any parse-skipped commands.
      await resolveBatchOutcome({
        completedCount,
        executionError,
        rolledBack: true,
        parseErrors
      });
      return;
    }

    // Every parseable command applied — commit so the subset persists.
    context.dispatch.commitTransaction();

    // If some commands couldn't be parsed, ask the assistant to resend them.
    if (parseErrors.length > 0) {
      await resolveBatchOutcome({
        completedCount,
        executionError: undefined,
        rolledBack: false,
        parseErrors
      });
    }
  }

  /**
   * After a batch finishes with failures (parse and/or execution), either
   * auto-retry with specific feedback so the assistant can self-correct, or —
   * when auto-retry is off/exhausted — surface the same summary in the log.
   */
  async function resolveBatchOutcome(outcome: BatchOutcome) {
    const feedback = buildRetryFeedback(outcome);
    const canRetry =
      getBehaviorSettings().chatAutoRetry && !!workflowId && autoRetryCount < MAX_AUTO_RETRIES;

    if (canRetry) {
      autoRetryCount++;
      await sendMessageInternal(feedback, autoRetryCount);
    } else {
      appendErrorToHistory(feedback);
    }
  }

  /** Dismiss a command preview without executing — CommandPreview shows its own cancelled state */
  function handleCancelCommands(messageIndex: number) {
    // CommandPreview owns the "Dismissed" *display* via its resolvedAction state;
    // the flag here is what tells the assistant, on the next turn, that these
    // commands were rejected rather than still waiting (issue #35).
    const msg = displayMessages[messageIndex];
    if (msg) msg.commandsDismissed = true;
  }

  /** Append an error message to conversation history so the LLM can self-correct */
  function appendErrorToHistory(errorMessage: string) {
    displayMessages.push({
      role: 'assistant',
      content: `Error: ${errorMessage}`
    });
  }

  // =========================================================================
  // Message Handling
  // =========================================================================

  /** Core send logic — shared by manual sends and auto-retry */
  async function sendMessageInternal(text: string, retryAttempt?: number) {
    if (!text || isLoading || !workflowId) return;

    displayMessages.push({ role: 'user', content: text, retryAttempt });
    isLoading = true;

    // The reply's place in the log, shown as thinking until it arrives — the
    // same placeholder the tools mode uses, so there is one spinner.
    const placeholderIndex =
      displayMessages.push({
        role: 'assistant',
        content: '',
        inProgress: true
      }) - 1;

    try {
      const history = getHistory();
      const request: ChatRequest = {
        message: text,
        workflowState: getWorkflowState(),
        history: history.slice(0, -2) // all except this message and the placeholder
      };

      const response = await chatService.sendMessage(
        fd.api.config,
        workflowId,
        request,
        fd.api.authProvider
      );
      displayMessages[placeholderIndex] = processResponse(response.content);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      displayMessages[placeholderIndex] = {
        role: 'assistant',
        content: `Error: ${errorMessage}`
      };
    } finally {
      isLoading = false;
      tick().then(() => inputElement?.focus());
    }
  }

  async function sendMessage() {
    const text = inputValue.trim();
    if (!text || isLoading || !workflowId) return;
    inputValue = '';
    autoRetryCount = 0;
    if (toolsMode) {
      await sendToolTurn(text);
    } else {
      await sendMessageInternal(text);
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }
</script>

<div class="ai-chat-panel" role="region" aria-label={t.aiAssistant}>
  {#if !isChatConfigured}
    <!-- No backend configured -->
    <div class="ai-chat-panel__notice">
      <Icon icon="mdi:robot-off-outline" />
      <span>{t.requiresBackend}</span>
    </div>
  {:else if isDisabled}
    <!-- No workflow loaded -->
    <div class="ai-chat-panel__notice">
      <Icon icon="mdi:chat-sleep-outline" />
      <span>{t.loadWorkflow}</span>
    </div>
  {:else}
    <!-- Messages area -->
    <div class="ai-chat-panel__messages" bind:this={messagesElement} role="log" aria-live="polite">
      {#if displayMessages.length === 0}
        <div class="ai-chat-panel__empty">
          <Icon icon="mdi:chat-outline" />
          <span>{t.helpBuild}</span>
        </div>
      {/if}
      <!-- Append-only chat log without stable IDs — index is the identity -->
      {#each displayMessages as message, msgIndex (msgIndex)}
        {#if message.retryAttempt !== undefined}
          <div
            class="ai-chat-panel__retry-notice"
            class:ai-chat-panel__retry-notice--active={displayMessages[msgIndex + 1]?.inProgress}
          >
            <Icon icon="mdi:autorenew" />
            <span>{t.autoRetry({ attempt: message.retryAttempt, max: MAX_AUTO_RETRIES })}</span>
          </div>
        {:else}
          <div
            class="ai-chat-panel__bubble ai-chat-panel__bubble--{message.role}"
            class:ai-chat-panel__bubble--notice={message.notice}
          >
            {#if message.toolLines && message.toolLines.length > 0}
              <ul
                class="ai-chat-panel__tool-lines"
                aria-label={t.tools.rounds({ count: message.toolLines.length })}
              >
                {#each message.toolLines as line (line)}
                  <li class="ai-chat-panel__tool-line ai-chat-panel__tool-line--{line.status}">
                    {#if line.status === 'running'}
                      <Icon icon="mdi:loading" class="ai-chat-panel__tool-line-spin" />
                    {:else if line.status === 'ok'}
                      <Icon icon="mdi:check" />
                    {:else if line.status === 'rejected'}
                      <Icon icon="mdi:cancel" />
                    {:else if line.status === 'note'}
                      <Icon icon="mdi:comment-text-outline" />
                    {:else}
                      <Icon icon="mdi:alert-circle-outline" />
                    {/if}
                    <span>{line.text}</span>
                  </li>
                {/each}
              </ul>
            {/if}
            {#if message.role === 'user'}
              <div class="ai-chat-panel__bubble-content">{message.content}</div>
            {:else if message.inProgress && !message.content}
              <div class="ai-chat-panel__thinking">
                <span class="ai-chat-panel__dot"></span>
                <span class="ai-chat-panel__dot"></span>
                <span class="ai-chat-panel__dot"></span>
              </div>
            {:else if message.notice}
              <div class="ai-chat-panel__bubble-content ai-chat-panel__notice-text">
                {message.content}
              </div>
            {:else}
              <div class="ai-chat-panel__bubble-content">
                <MarkdownDisplay content={message.content} />
              </div>
            {/if}
            {#if message.warning}
              <div class="ai-chat-panel__turn-warning" role="status">
                <Icon icon="mdi:alert-circle-outline" />
                <span>{message.warning}</span>
              </div>
            {/if}
            {#if message.readOnlyResults && message.readOnlyResults.length > 0}
              <div class="ai-chat-panel__readonly-results">
                {#each message.readOnlyResults as result, i (i)}
                  <pre class="ai-chat-panel__readonly-result">{result}</pre>
                {/each}
              </div>
            {/if}
            {#if message.commandPreview && message.commandPreview.length > 0}
              <div class="ai-chat-panel__command-preview">
                <CommandPreview
                  commands={message.commandPreview}
                  onApprove={() => handleApproveCommands(msgIndex)}
                  onCancel={() => handleCancelCommands(msgIndex)}
                />
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    </div>

    <!-- Input area -->
    <div class="ai-chat-panel__input-area">
      <textarea
        bind:this={inputElement}
        bind:value={inputValue}
        onkeydown={handleKeydown}
        class="ai-chat-panel__input"
        placeholder={t.placeholder}
        rows="1"
        disabled={isLoading}
      ></textarea>
      <button
        class="ai-chat-panel__send"
        onclick={sendMessage}
        disabled={!canSend}
        aria-label={t.send}
      >
        <Icon icon="mdi:send" />
      </button>
    </div>
  {/if}
</div>

<style>
  .ai-chat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: var(--fd-background);
    color: var(--fd-foreground);
    overflow: hidden;
  }

  /* Notice / disabled states */
  .ai-chat-panel__notice {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--fd-space-sm);
    height: 100%;
    color: var(--fd-muted-foreground);
    font-size: var(--fd-text-sm);
    text-align: center;
    padding: var(--fd-space-md);
  }

  .ai-chat-panel__notice :global(svg) {
    font-size: 2rem;
    opacity: 0.5;
  }

  /* Messages area */
  .ai-chat-panel__messages {
    flex: 1;
    overflow-y: auto;
    padding: var(--fd-space-sm);
    display: flex;
    flex-direction: column;
    gap: var(--fd-space-xs);
    scrollbar-width: thin;
    scrollbar-color: var(--fd-scrollbar-thumb) var(--fd-scrollbar-track);
  }

  .ai-chat-panel__messages::-webkit-scrollbar {
    width: 8px;
  }

  .ai-chat-panel__messages::-webkit-scrollbar-track {
    background: var(--fd-scrollbar-track);
  }

  .ai-chat-panel__messages::-webkit-scrollbar-thumb {
    background: var(--fd-scrollbar-thumb);
    border-radius: var(--fd-scrollbar-radius);
  }

  .ai-chat-panel__messages::-webkit-scrollbar-thumb:hover {
    background: var(--fd-scrollbar-thumb-hover);
  }

  /* Empty state */
  .ai-chat-panel__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--fd-space-xs);
    height: 100%;
    color: var(--fd-muted-foreground);
    font-size: var(--fd-text-sm);
    opacity: 0.6;
  }

  .ai-chat-panel__empty :global(svg) {
    font-size: 1.5rem;
  }

  /* Auto-retry notice */
  .ai-chat-panel__retry-notice {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--fd-space-xs);
    font-size: var(--fd-text-xs);
    color: var(--fd-muted-foreground);
    opacity: 0.7;
    padding: var(--fd-space-3xs) 0;
    animation: fadeIn 0.15s ease-out;
  }

  .ai-chat-panel__retry-notice--active :global(svg) {
    animation: spin 1s linear infinite;
  }

  /* Message bubbles */
  .ai-chat-panel__bubble {
    max-width: 80%;
    animation: fadeIn 0.15s ease-out;
  }

  .ai-chat-panel__bubble--user {
    align-self: flex-end;
  }

  .ai-chat-panel__bubble--assistant {
    align-self: flex-start;
  }

  .ai-chat-panel__bubble-content {
    padding: var(--fd-space-xs) var(--fd-space-sm);
    border-radius: var(--fd-radius-md);
    font-size: var(--fd-text-sm);
    line-height: 1.5;
    word-break: break-word;
  }

  .ai-chat-panel__bubble--user .ai-chat-panel__bubble-content {
    background: var(--fd-primary);
    color: var(--fd-primary-foreground);
    border-bottom-right-radius: var(--fd-radius-xs);
    white-space: pre-wrap;
  }

  .ai-chat-panel__bubble--assistant .ai-chat-panel__bubble-content {
    background: var(--fd-muted);
    color: var(--fd-foreground);
    border-bottom-left-radius: var(--fd-radius-xs);
  }

  /* Markdown typography inside assistant bubbles */
  .ai-chat-panel__bubble--assistant .ai-chat-panel__bubble-content :global(.markdown-display) {
    font-size: inherit;
    line-height: inherit;
    color: inherit;
  }

  .ai-chat-panel__bubble--assistant .ai-chat-panel__bubble-content :global(p) {
    margin: 0 0 0.5em;
  }

  .ai-chat-panel__bubble--assistant .ai-chat-panel__bubble-content :global(p:last-child),
  .ai-chat-panel__bubble--assistant .ai-chat-panel__bubble-content :global(ul:last-child),
  .ai-chat-panel__bubble--assistant .ai-chat-panel__bubble-content :global(ol:last-child) {
    margin-bottom: 0;
  }

  .ai-chat-panel__bubble--assistant .ai-chat-panel__bubble-content :global(ul),
  .ai-chat-panel__bubble--assistant .ai-chat-panel__bubble-content :global(ol) {
    margin: 0 0 0.5em;
    padding-left: 1.25em;
  }

  .ai-chat-panel__bubble--assistant .ai-chat-panel__bubble-content :global(li) {
    margin-bottom: 0.2em;
  }

  .ai-chat-panel__bubble--assistant .ai-chat-panel__bubble-content :global(code) {
    font-family: var(--fd-font-mono);
    font-size: 0.875em;
    background: var(--fd-background);
    padding: 0.1em 0.3em;
    border-radius: var(--fd-radius-xs);
  }

  .ai-chat-panel__bubble--assistant .ai-chat-panel__bubble-content :global(pre) {
    background: var(--fd-background);
    border: 1px solid var(--fd-border);
    border-radius: var(--fd-radius-sm);
    padding: var(--fd-space-xs) var(--fd-space-sm);
    overflow-x: auto;
    margin: 0.5em 0;
  }

  .ai-chat-panel__bubble--assistant .ai-chat-panel__bubble-content :global(pre code) {
    background: none;
    padding: 0;
    font-size: var(--fd-text-xs);
  }

  .ai-chat-panel__bubble--assistant .ai-chat-panel__bubble-content :global(strong) {
    font-weight: 600;
  }

  .ai-chat-panel__bubble--assistant .ai-chat-panel__bubble-content :global(em) {
    font-style: italic;
  }

  /* Tools mode: one status line per tool call */
  .ai-chat-panel__tool-lines {
    list-style: none;
    margin: 0 0 var(--fd-space-3xs);
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ai-chat-panel__tool-line {
    display: flex;
    align-items: flex-start;
    gap: var(--fd-space-3xs);
    font-size: var(--fd-text-xs);
    color: var(--fd-muted-foreground);
    line-height: 1.4;
  }

  .ai-chat-panel__tool-line :global(svg) {
    flex-shrink: 0;
    font-size: 0.9rem;
    margin-top: 0.1em;
  }

  .ai-chat-panel__tool-line--ok :global(svg) {
    color: var(--fd-success, var(--fd-primary));
  }

  .ai-chat-panel__tool-line--rejected,
  .ai-chat-panel__tool-line--failed {
    color: var(--fd-destructive, var(--fd-foreground));
  }

  .ai-chat-panel__tool-line :global(.ai-chat-panel__tool-line-spin) {
    animation: spin 1s linear infinite;
  }

  .ai-chat-panel__tool-line--note {
    color: var(--fd-foreground);
    font-style: italic;
    white-space: pre-wrap;
  }

  .ai-chat-panel__tool-line--note :global(svg) {
    color: var(--fd-muted-foreground);
  }

  /* Deterministic warning under the reply (e.g. tool calls failed this turn) */
  .ai-chat-panel__turn-warning {
    display: flex;
    align-items: center;
    gap: var(--fd-space-3xs);
    margin-top: var(--fd-space-3xs);
    font-size: var(--fd-text-xs);
    color: var(--fd-destructive, var(--fd-foreground));
  }

  .ai-chat-panel__turn-warning :global(svg) {
    flex-shrink: 0;
  }

  /* Notices (legacy fallback, aborted turn) */
  .ai-chat-panel__bubble--notice {
    max-width: 100%;
    align-self: center;
  }

  .ai-chat-panel__bubble--notice .ai-chat-panel__notice-text {
    background: none;
    color: var(--fd-muted-foreground);
    font-size: var(--fd-text-xs);
    text-align: center;
    opacity: 0.8;
  }

  /* Read-only command results */
  .ai-chat-panel__readonly-results {
    margin-top: var(--fd-space-xs);
  }

  .ai-chat-panel__readonly-result {
    margin: 0;
    padding: var(--fd-space-xs) var(--fd-space-sm);
    background: var(--fd-card);
    border: 1px solid var(--fd-border);
    border-radius: var(--fd-radius-sm);
    font-family: var(--fd-font-mono);
    font-size: var(--fd-text-xs);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--fd-foreground);
  }

  .ai-chat-panel__readonly-result + .ai-chat-panel__readonly-result {
    margin-top: var(--fd-space-3xs);
  }

  /* Command preview block */
  .ai-chat-panel__command-preview {
    margin-top: var(--fd-space-xs);
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Thinking indicator */
  .ai-chat-panel__thinking {
    display: flex;
    gap: 4px;
    padding: var(--fd-space-xs) var(--fd-space-sm);
    background: var(--fd-muted);
    border-radius: var(--fd-radius-md);
    border-bottom-left-radius: var(--fd-radius-xs);
  }

  .ai-chat-panel__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--fd-muted-foreground);
    animation: bounce 1.4s ease-in-out infinite;
  }

  .ai-chat-panel__dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .ai-chat-panel__dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes bounce {
    0%,
    60%,
    100% {
      transform: translateY(0);
    }
    30% {
      transform: translateY(-4px);
    }
  }

  /* Input area */
  .ai-chat-panel__input-area {
    display: flex;
    align-items: flex-end;
    gap: var(--fd-space-xs);
    padding: var(--fd-space-xs) var(--fd-space-sm);
    border-top: 1px solid var(--fd-border);
    background: var(--fd-background);
  }

  .ai-chat-panel__input {
    flex: 1;
    resize: none;
    border: 1px solid var(--fd-border);
    border-radius: var(--fd-radius-md);
    padding: var(--fd-space-xs) var(--fd-space-sm);
    font-family: var(--fd-font-sans, inherit);
    font-size: var(--fd-text-sm);
    line-height: 1.4;
    color: var(--fd-foreground);
    background: var(--fd-card);
    outline: none;
    max-height: 80px;
    overflow-y: auto;
  }

  .ai-chat-panel__input:focus {
    border-color: var(--fd-primary);
  }

  .ai-chat-panel__input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .ai-chat-panel__input::placeholder {
    color: var(--fd-muted-foreground);
  }

  .ai-chat-panel__send {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--fd-radius-md);
    background: var(--fd-primary);
    color: var(--fd-primary-foreground);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background-color var(--fd-transition-fast),
      opacity var(--fd-transition-fast);
  }

  .ai-chat-panel__send:hover:not(:disabled) {
    background: var(--fd-primary-hover);
  }

  .ai-chat-panel__send:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
