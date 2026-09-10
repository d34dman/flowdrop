/**
 * WebMCP adapter — approval gate.
 *
 * Tool calls that would change the document pass through here before anything
 * runs. The policy is the host's (`WebMCPOptions.approval`); the default is a
 * confirm dialog rendered inside the page, because the WebMCP permission model
 * is about which origins may *see* tools, not about whether a given call may
 * change the user's document. Any agent or extension on the page can call a
 * tool, so the gate must not be weaker than the chat panel's click-to-apply.
 *
 * Two ergonomics live here too. A batch shows a *summary* of what changes
 * (nodes added, edges connected, config keys set) above the line list, so the
 * person reads what the agent is doing rather than a verb list. And the
 * dialog can offer "apply further edits without asking" for the rest of the
 * page's life — edits only: `save` and `run` are consequential and always ask.
 * The gate cannot tell one agent from another, so the offer is worded as what
 * it is: every caller on the page is covered once it is ticked. It is still a
 * click-to-apply — one the person chose to make once.
 *
 * @module webmcp/gate
 */

import { mount, unmount } from 'svelte';
import type { Command } from '../commands/types.js';
import { defaultMessages, mergeMessages, messagesContext } from '../messages/index.js';
import type { Messages, MessagesOverride } from '../messages/index.js';
import type { WebMCPApproval, WebMCPApprovalRequest } from './types.js';
import { describeCommand, summarizeCommands } from './descriptors.js';
import WebMCPConfirm from './WebMCPConfirm.svelte';

/** What the gate needs to know about the call it is asking approval for. */
export interface GateRequest extends WebMCPApprovalRequest {
  /**
   * Dialog lines, one per command. Defaults to `commands.map(describeCommand)`;
   * `save` and `run` have no commands to describe, so the gate fills in their
   * line itself when this is omitted.
   */
  lines?: string[];
  /** Extra sentence shown under the title, e.g. "This cannot be undone." */
  hint?: string;
  /**
   * The dialog's title — who is asking. Defaults to the WebMCP wording ("A
   * browser agent wants to change …"); the chat panel passes its own so a
   * shared gate still says which surface is asking.
   */
  title?: string;
  /**
   * A consequential call (`save`, `run`) is never covered by the "don't ask
   * again for edits" choice and never offers it. Defaults to `tool` being
   * `save` or `run`.
   */
  consequential?: boolean;
}

export interface ApprovalGate {
  /**
   * Ask whether `commands` may run. Resolves `true` to run. Rejects with
   * {@link GateBusyError} when a decision is already pending — the caller
   * turns that into a `busy` tool error instead of stacking dialogs.
   */
  request(commands: Command[], request: GateRequest): Promise<boolean>;
  /** True while a decision is pending. */
  readonly busy: boolean;
  /** True once the person chose to apply further edits without asking. */
  readonly editsPreApproved: boolean;
  /** Dismiss any open dialog (as a rejection) and release resources. */
  dispose(): void;
}

/** A second mutating call arrived while a decision was pending. */
export class GateBusyError extends Error {
  constructor() {
    super('A previous change is still waiting for approval');
    this.name = 'GateBusyError';
  }
}

export interface CreateGateOptions {
  /** Where the built-in dialog mounts. Default `document.body`. */
  container?: HTMLElement;
  /** Name shown in the dialog title; read at request time. */
  editorName: () => string;
  /** Strings for the dialog, as a partial override or a getter for one. */
  messages?: MessagesOverride | (() => MessagesOverride);
  /** Offer the "don't ask again for edits" choice. Default true. */
  rememberEdits?: boolean;
}

const CONSEQUENTIAL_TOOLS: ReadonlySet<string> = new Set(['save', 'run']);

export function createApprovalGate(
  approval: WebMCPApproval,
  options: CreateGateOptions
): ApprovalGate {
  let pending = false;
  let dismiss: (() => void) | null = null;
  let editsPreApproved = false;
  const offerRemember = options.rememberEdits ?? true;

  // The dialog mounts outside any component tree, so it gets its messages
  // through the same context the root component would have provided. Read
  // per access so a getter-driven locale switch shows on the next dialog.
  const messages = (): Messages => {
    const override = options.messages;
    return mergeMessages(defaultMessages, typeof override === 'function' ? override() : override);
  };

  const isConsequential = (request: GateRequest): boolean =>
    request.consequential ?? CONSEQUENTIAL_TOOLS.has(request.tool);

  async function decide(commands: Command[], request: GateRequest): Promise<boolean> {
    if (approval === 'auto') return true;
    if (typeof approval === 'function') return approval(commands, { tool: request.tool });
    // The person's earlier "don't ask again" covers edits, never save or run.
    if (editsPreApproved && !isConsequential(request)) return true;
    return confirmInPage(commands, request);
  }

  // `lines`/`hint` default from the commands for an ordinary change; `save`
  // and `run` have no commands, so they get their own dialog copy.
  function resolveLines(commands: Command[], request: GateRequest): string[] {
    if (request.lines) return request.lines;
    const m = messages().webmcp;
    if (request.tool === 'save') return [m.saveLine({ name: options.editorName() })];
    if (request.tool === 'run') return [m.runLine({ name: options.editorName() })];
    return commands.map(describeCommand);
  }

  function resolveTitle(request: GateRequest): string {
    return request.title ?? messages().webmcp.confirmTitle({ name: options.editorName() });
  }

  function resolveHint(commands: Command[], request: GateRequest): string | undefined {
    if (request.hint !== undefined) return request.hint;
    const m = messages().webmcp;
    if (request.tool === 'save') return m.saveHint;
    if (request.tool === 'run') return m.runHint;
    return summarizeCommands(commands, m);
  }

  function confirmInPage(commands: Command[], request: GateRequest): Promise<boolean> {
    const target = options.container ?? (typeof document !== 'undefined' ? document.body : null);
    if (!target) {
      // No DOM to ask in: refuse rather than silently apply.
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const host = document.createElement('div');
      host.className = 'fd-webmcp-confirm-host';
      target.appendChild(host);

      const finish = (approved: boolean, remember = false): void => {
        if (settled) return;
        settled = true;
        dismiss = null;
        void unmount(component);
        host.remove();
        if (approved && remember) editsPreApproved = true;
        resolve(approved);
      };

      const component = mount(WebMCPConfirm, {
        target: host,
        context: messagesContext(messages),
        props: {
          title: resolveTitle(request),
          lines: resolveLines(commands, request),
          hint: resolveHint(commands, request),
          offerRemember: offerRemember && !isConsequential(request),
          onResolve: finish
        }
      });

      dismiss = () => finish(false);
    });
  }

  return {
    get busy() {
      return pending;
    },
    get editsPreApproved() {
      return editsPreApproved;
    },
    async request(commands, request) {
      if (pending) throw new GateBusyError();
      pending = true;
      try {
        return await decide(commands, request);
      } finally {
        pending = false;
      }
    },
    dispose() {
      dismiss?.();
    }
  };
}
