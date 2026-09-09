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
 * @module webmcp/gate
 */

import { mount, unmount } from 'svelte';
import type { Command } from '../commands/types.js';
import { defaultMessages, mergeMessages, messagesContext } from '../messages/index.js';
import type { Messages, MessagesOverride } from '../messages/index.js';
import type { WebMCPApproval, WebMCPApprovalRequest } from './types.js';
import { describeCommand } from './descriptors.js';
import WebMCPConfirm from './WebMCPConfirm.svelte';

/** What the gate needs to know about the call it is asking approval for. */
export interface GateRequest extends WebMCPApprovalRequest {
  /**
   * Dialog lines, one per command. Defaults to `commands.map(describeCommand)`;
   * `save` has no commands to describe, so the gate fills in the save line
   * itself when this is omitted and `tool === 'save'`.
   */
  lines?: string[];
  /** Extra sentence shown under the title, e.g. "This cannot be undone." */
  hint?: string;
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
}

export function createApprovalGate(
  approval: WebMCPApproval,
  options: CreateGateOptions
): ApprovalGate {
  let pending = false;
  let dismiss: (() => void) | null = null;

  // The dialog mounts outside any component tree, so it gets its messages
  // through the same context the root component would have provided. Read
  // per access so a getter-driven locale switch shows on the next dialog.
  const messages = (): Messages => {
    const override = options.messages;
    return mergeMessages(defaultMessages, typeof override === 'function' ? override() : override);
  };

  async function decide(commands: Command[], request: GateRequest): Promise<boolean> {
    if (approval === 'auto') return true;
    if (typeof approval === 'function') return approval(commands, { tool: request.tool });
    return confirmInPage(commands, request);
  }

  // `lines`/`hint` default from the commands for an ordinary change; `save`
  // has no commands, so it gets its own dialog copy from the messages system.
  function resolveLines(commands: Command[], request: GateRequest): string[] {
    if (request.lines) return request.lines;
    if (request.tool === 'save') {
      return [messages().webmcp.saveLine({ name: options.editorName() })];
    }
    return commands.map(describeCommand);
  }

  function resolveHint(request: GateRequest): string | undefined {
    if (request.hint !== undefined) return request.hint;
    return request.tool === 'save' ? messages().webmcp.saveHint : undefined;
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

      const finish = (approved: boolean): void => {
        if (settled) return;
        settled = true;
        dismiss = null;
        void unmount(component);
        host.remove();
        resolve(approved);
      };

      const component = mount(WebMCPConfirm, {
        target: host,
        context: messagesContext(messages),
        props: {
          editorName: options.editorName(),
          lines: resolveLines(commands, request),
          hint: resolveHint(request),
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
