<!--
  Warning glyph for toasts. The library only ships success/error/loading
  icons, so a warning would otherwise wear the error icon and be
  indistinguishable from one.
-->
<svg
  class="flowdrop-toast-warning-icon"
  viewBox="0 0 20 20"
  width="20"
  height="20"
  aria-hidden="true"
  focusable="false"
>
  <path
    d="M10 2.5 18.5 17H1.5L10 2.5Z"
    fill="var(--fd-warning, #f59e0b)"
    stroke="var(--fd-warning, #f59e0b)"
    stroke-width="1.5"
    stroke-linejoin="round"
  />
  <path
    d="M10 8v4.5"
    stroke="var(--fd-warning-foreground, #fff)"
    stroke-width="1.75"
    stroke-linecap="round"
  />
  <circle cx="10" cy="14.75" r="1" fill="var(--fd-warning-foreground, #fff)" />
</svg>
