/**
 * `DismissibleToast` — the body of an error or warning toast. Mounted for
 * real (happy-dom) so the reason list and the close button are exercised on
 * the DOM. The duplicate-reason case is the point: a keyed each would throw
 * here, in production too, and the toast meant to explain a failure would be
 * the failure.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import type { Toast } from 'svelte-5-french-toast';
import DismissibleToast from '$lib/components/toast/DismissibleToast.svelte';

const dismiss = vi.fn();
vi.mock('svelte-5-french-toast', () => ({
  toast: { dismiss: (...args: unknown[]) => dismiss(...args) }
}));

const toast = { id: 'error:x', type: 'error', visible: true } as unknown as Toast;

let target: HTMLElement;
let instance: ReturnType<typeof mount> | null = null;

function render(props: { text: string; details?: readonly string[] }) {
  target = document.createElement('div');
  document.body.appendChild(target);
  instance = mount(DismissibleToast, { target, props: { toast, ...props } });
  flushSync();
  return target;
}

afterEach(() => {
  if (instance) unmount(instance);
  instance = null;
  target?.remove();
  dismiss.mockReset();
});

describe('DismissibleToast', () => {
  it('renders the headline alone when there are no reasons', () => {
    const el = render({ text: 'Save workflow failed: Workflow validation failed' });
    expect(el.querySelector('.flowdrop-toast-headline')?.textContent).toBe(
      'Save workflow failed: Workflow validation failed'
    );
    expect(el.querySelector('.flowdrop-toast-details')).toBeNull();
  });

  it('lists every reason, including two with the same wording', () => {
    const el = render({
      text: 'Workflow validation failed',
      details: ['Required input is not connected', 'Required input is not connected', 'No model']
    });
    const items = [...el.querySelectorAll('.flowdrop-toast-details li')].map(
      (li) => li.textContent
    );
    expect(items).toEqual([
      'Required input is not connected',
      'Required input is not connected',
      'No model'
    ]);
  });

  it('dismisses its own toast from the close button', () => {
    const el = render({ text: 'x' });
    const button = el.querySelector<HTMLButtonElement>('.flowdrop-toast-close');
    expect(button?.getAttribute('aria-label')).toBe('Dismiss');
    button?.click();
    expect(dismiss).toHaveBeenCalledWith('error:x');
  });
});
