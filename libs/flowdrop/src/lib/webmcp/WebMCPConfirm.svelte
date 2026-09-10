<!--
  WebMCPConfirm

  The built-in approval dialog for mutating editor tools called by a browser
  agent. Lists what is about to run and asks the person at the keyboard.
  Mounted imperatively by `gate.ts` into the host's container (default
  `document.body`), one at a time; a second request while one is open is
  refused upstream with a `busy` error rather than stacking dialogs.
-->

<script lang="ts">
  import { m } from '../messages/index.js';
  import { focusOnMount } from '../utils/focus.js';

  interface Props {
    /** The title — who wants to change which editor (see `GateRequest.title`). */
    title: string;
    /** One human-readable line per command (see `describeCommand`). */
    lines: string[];
    /**
     * Overrides the default "N changes — applied together, undone together"
     * hint, e.g. for `save`, which has no commands to count.
     */
    hint?: string;
    /**
     * Show the "apply further edits without asking" checkbox. Off for
     * consequential calls (`save`, `run`), which always ask.
     */
    offerRemember?: boolean;
    /** Called exactly once with the decision and whether to remember it for edits. */
    onResolve: (approved: boolean, remember?: boolean) => void;
  }

  let { title, lines, hint, offerRemember = false, onResolve }: Props = $props();

  let rejectButton = $state<HTMLButtonElement | null>(null);
  let approveButton = $state<HTMLButtonElement | null>(null);
  let rememberBox = $state<HTMLInputElement | null>(null);
  let remember = $state(false);

  // Focus starts on Apply and stays inside the dialog: Tab cycles Apply →
  // Reject → (checkbox) → Apply, Escape rejects. The handler sits on the
  // dialog itself, which holds focus through its controls, not on the window.
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onResolve(false);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const order = [approveButton, rejectButton, rememberBox].filter(
        (el): el is HTMLButtonElement | HTMLInputElement => el !== null
      );
      const i = order.indexOf(document.activeElement as HTMLButtonElement | HTMLInputElement);
      const step = event.shiftKey ? -1 : 1;
      order[(i + step + order.length) % order.length]?.focus();
    }
  }
</script>

<div class="fd-webmcp-confirm" data-testid="flowdrop-webmcp-confirm">
  <div
    class="fd-webmcp-confirm__dialog"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="fd-webmcp-confirm-title"
    aria-describedby="fd-webmcp-confirm-list"
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <header class="fd-webmcp-confirm__header">
      <h2 id="fd-webmcp-confirm-title" class="fd-webmcp-confirm__title">
        {title}
      </h2>
      <p class="fd-webmcp-confirm__hint">
        {hint ?? m().webmcp.confirmCount({ count: lines.length })}
      </p>
    </header>
    <div class="fd-webmcp-confirm__body">
      <ol id="fd-webmcp-confirm-list" class="fd-webmcp-confirm__list">
        {#each lines as line, i (i)}
          <li class="fd-webmcp-confirm__line">{line}</li>
        {/each}
      </ol>
      {#if offerRemember}
        <label class="fd-webmcp-confirm__remember">
          <input
            type="checkbox"
            data-testid="flowdrop-webmcp-remember"
            bind:this={rememberBox}
            bind:checked={remember}
          />
          <span>{m().webmcp.rememberEdits}</span>
        </label>
      {/if}
    </div>
    <footer class="fd-webmcp-confirm__actions">
      <button
        type="button"
        class="flowdrop-btn flowdrop-btn--outline fd-webmcp-confirm__button"
        data-testid="flowdrop-webmcp-reject"
        bind:this={rejectButton}
        onclick={() => onResolve(false)}
      >
        {m().webmcp.reject}
      </button>
      <button
        type="button"
        class="flowdrop-btn flowdrop-btn--primary fd-webmcp-confirm__button"
        data-testid="flowdrop-webmcp-approve"
        bind:this={approveButton}
        {@attach focusOnMount()}
        onclick={() => onResolve(true, remember)}
      >
        {m().webmcp.apply}
      </button>
    </footer>
  </div>
</div>

<style>
  /* Mounted on document.body, outside the editor tree: the tokens come from
     :root (tokens.css), the button classes from base.css — both global — and
     the dark skin from [data-theme='dark'] on <html>. Only the font has no
     host to inherit from, so it is set here. The shell follows
     SettingsModal: blurred backdrop, header / body / footer with the xl
     rhythm, and an enter animation. */
  .fd-webmcp-confirm {
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--fd-space-xl, 1rem);
    background: rgb(0 0 0 / 0.5);
    backdrop-filter: blur(4px);
    font-family: var(--fd-font-sans, system-ui, sans-serif);
    font-size: var(--fd-text-sm, 0.875rem);
    line-height: var(--fd-leading-normal, 1.5);
  }

  .fd-webmcp-confirm__dialog {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 36rem;
    max-height: calc(100vh - 2 * var(--fd-space-xl, 1rem));
    overflow: hidden;
    border: 1px solid var(--fd-border, #d4d4d8);
    border-radius: var(--fd-radius-lg, 0.5rem);
    background: var(--fd-background, #fff);
    color: var(--fd-foreground, #18181b);
    box-shadow: var(--fd-shadow-xl, 0 20px 40px rgb(0 0 0 / 0.25));
    animation: fd-webmcp-confirm-enter 0.2s ease-out;
  }

  .fd-webmcp-confirm__dialog:focus {
    outline: none;
  }

  @keyframes fd-webmcp-confirm-enter {
    from {
      opacity: 0;
      transform: scale(0.95) translateY(-10px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .fd-webmcp-confirm__header {
    flex-shrink: 0;
    padding: var(--fd-space-xl, 1rem) var(--fd-space-xl, 1rem) var(--fd-space-lg, 0.875rem);
    border-bottom: 1px solid var(--fd-border, #d4d4d8);
  }

  .fd-webmcp-confirm__title {
    margin: 0 0 var(--fd-space-2xs, 0.25rem);
    font-size: var(--fd-text-lg, 1.125rem);
    font-weight: 600;
    line-height: var(--fd-leading-tight, 1.3);
    color: var(--fd-foreground, #18181b);
    overflow-wrap: anywhere;
  }

  .fd-webmcp-confirm__hint {
    margin: 0;
    font-size: var(--fd-text-sm, 0.875rem);
    color: var(--fd-muted-foreground, #71717a);
  }

  .fd-webmcp-confirm__body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--fd-space-xl, 1rem);
  }

  .fd-webmcp-confirm__list {
    margin: 0;
    padding: var(--fd-space-md, 0.75rem) var(--fd-space-lg, 0.875rem) var(--fd-space-md, 0.75rem)
      var(--fd-space-3xl, 2.25rem);
    border: 1px solid var(--fd-border, #d4d4d8);
    border-radius: var(--fd-radius-md, 0.375rem);
    background: var(--fd-muted, #f4f4f5);
    font-family: var(--fd-font-mono, ui-monospace, monospace);
    font-size: var(--fd-text-xs, 0.8125rem);
    line-height: var(--fd-leading-relaxed, 1.6);
    color: var(--fd-foreground, #18181b);
  }

  .fd-webmcp-confirm__line {
    padding: var(--fd-space-3xs, 0.125rem) 0;
    overflow-wrap: anywhere;
  }

  .fd-webmcp-confirm__line::marker {
    color: var(--fd-muted-foreground, #71717a);
  }

  .fd-webmcp-confirm__remember {
    display: flex;
    align-items: flex-start;
    gap: var(--fd-space-sm, 0.625rem);
    margin: var(--fd-space-lg, 0.875rem) 0 0;
    font-size: var(--fd-text-sm, 0.875rem);
    color: var(--fd-muted-foreground, #71717a);
    cursor: pointer;
  }

  .fd-webmcp-confirm__remember input {
    flex-shrink: 0;
    width: 1rem;
    height: 1rem;
    margin: 0.2em 0 0;
    accent-color: var(--fd-primary, #2563eb);
    cursor: pointer;
  }

  .fd-webmcp-confirm__remember:hover {
    color: var(--fd-foreground, #18181b);
  }

  .fd-webmcp-confirm__actions {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    gap: var(--fd-space-sm, 0.625rem);
    padding: var(--fd-space-lg, 0.875rem) var(--fd-space-xl, 1rem);
    border-top: 1px solid var(--fd-border, #d4d4d8);
    background: var(--fd-muted, #f4f4f5);
  }

  /* The buttons are .flowdrop-btn from base.css; this only keeps them from
     inheriting the host page's button font when base.css is absent. */
  .fd-webmcp-confirm__button {
    font-family: inherit;
  }

  @media (max-width: 640px) {
    .fd-webmcp-confirm {
      padding: 0;
      align-items: flex-end;
    }

    .fd-webmcp-confirm__dialog {
      max-width: 100%;
      max-height: 100vh;
      border-radius: var(--fd-radius-lg, 0.5rem) var(--fd-radius-lg, 0.5rem) 0 0;
    }

    .fd-webmcp-confirm__actions {
      flex-direction: column-reverse;
    }
  }
</style>
