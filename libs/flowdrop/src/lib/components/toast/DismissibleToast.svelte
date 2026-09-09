<script lang="ts">
  /**
   * Toast body with a close button.
   *
   * svelte-5-french-toast renders a component message as
   * `<toast.message {toast} {...toast.props} />`, so this receives the live
   * toast (for its id) plus the props the service passes. Used for errors and
   * warnings, which stay on screen until the user dismisses them: a refusal
   * the user has to act on must not vanish mid-read.
   *
   * `details` are the server's reasons behind the headline (ApiError.details);
   * they render as a list rather than being joined into the headline.
   * The list is keyed by index on purpose: two reasons may share their
   * wording, and keying on the text throws `each_key_duplicate` — in
   * production too. The list never changes for the life of a toast.
   */
  import { toast as toastApi, type Toast } from 'svelte-5-french-toast';

  interface Props {
    toast: Toast;
    text: string;
    details?: readonly string[];
  }

  let { toast, text, details = [] }: Props = $props();
</script>

<div class="flowdrop-toast-text">
  <p class="flowdrop-toast-headline">{text}</p>
  {#if details.length}
    <ul class="flowdrop-toast-details">
      {#each details as detail, i (i)}
        <li>{detail}</li>
      {/each}
    </ul>
  {/if}
</div>
<button
  type="button"
  class="flowdrop-toast-close"
  aria-label="Dismiss"
  onclick={() => toastApi.dismiss(toast.id)}
>
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
    <path
      d="M4 4l8 8M12 4l-8 8"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      fill="none"
    />
  </svg>
</button>
