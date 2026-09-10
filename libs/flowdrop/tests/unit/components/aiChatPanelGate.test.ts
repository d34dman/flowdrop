/**
 * AIChatPanel — the one shared approval gate per editor.
 *
 * The panel and the WebMCP registration share `instance.approvalGate`.
 * Whichever surface comes first publishes it; the other reuses it. These tests
 * pin the ownership rule on the panel's side: it clears the gate only when it
 * published it, and a turn still running when the panel unmounts keeps its
 * runtime until the turn ends.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import AIChatPanel from '$lib/components/chat/AIChatPanel.svelte';
import { createFlowDropInstance } from '$lib/stores/instanceContainer.svelte.js';
import { FLOWDROP_INSTANCE_KEY } from '$lib/stores/getInstance.svelte.js';
import { defaultEndpointConfig } from '$lib/config/endpoints.js';
import { chatService } from '$lib/services/chatService.js';
import { resetSettings } from '$lib/stores/settingsStore.svelte.js';
import type { ApprovalGate } from '$lib/webmcp/gate.js';
import type { ChatTurnResponse } from '$lib/types/chat.js';
import type { NodeMetadata, Workflow } from '$lib/types/index.js';

const textIn: NodeMetadata = {
  node_type_id: 'text_input',
  name: 'Text Input',
  category: 'inputs',
  inputs: [],
  outputs: [{ id: 'value', name: 'Value', type: 'output', dataType: 'string' }],
  configSchema: { type: 'object', properties: {} }
} as NodeMetadata;

function workflow(): Workflow {
  return {
    id: 'wf-1',
    name: 'Panel',
    nodes: [],
    edges: [],
    metadata: { schemaVersion: '1.0.0', createdAt: '', updatedAt: '' }
  };
}

function fakeGate(): ApprovalGate {
  return {
    request: vi.fn(async () => true),
    busy: false,
    asks: true,
    editsPreApproved: false,
    dispose: vi.fn()
  };
}

let target: HTMLElement;
let mounted: ReturnType<typeof mount> | null = null;

function render(instance: ReturnType<typeof createFlowDropInstance>) {
  target = document.createElement('div');
  document.body.appendChild(target);
  mounted = mount(AIChatPanel, {
    target,
    context: new Map<unknown, unknown>([[FLOWDROP_INSTANCE_KEY, instance]]),
    props: { nodeTypes: [textIn], workflowId: 'wf-1', endpointConfig: defaultEndpointConfig }
  });
  flushSync();
}

async function send(text: string): Promise<void> {
  const input = target.querySelector<HTMLTextAreaElement>('textarea');
  if (!input) throw new Error('no textarea');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  flushSync();
}

/** Poll until `cond` holds (the runtime is a dynamic import; its timing is not ours). */
async function waitFor(cond: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    flushSync();
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Let the turn's awaits settle. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20));
  flushSync();
}

function finalTurn(content = 'done'): ChatTurnResponse {
  return { content, turnId: 't-1', done: true };
}

beforeEach(() => {
  resetSettings();
});

afterEach(() => {
  if (mounted) {
    void unmount(mounted);
    mounted = null;
  }
  target?.remove();
  vi.restoreAllMocks();
});

describe('AIChatPanel and the shared approval gate', () => {
  it('reuses a gate another surface published and leaves it in place on unmount', async () => {
    const instance = createFlowDropInstance({ id: 'p-shared' });
    instance.workflow.initialize(workflow());
    const shared = fakeGate();
    instance.approvalGate = shared;

    const sent = vi.spyOn(chatService, 'sendMessage').mockResolvedValue(finalTurn());
    render(instance);
    await send('hello');
    await waitFor(() => sent.mock.calls.length === 1, 'the turn to be sent');
    await settle();

    expect(instance.approvalGate).toBe(shared);
    void unmount(mounted!);
    mounted = null;
    expect(instance.approvalGate).toBe(shared);
    expect(shared.dispose).not.toHaveBeenCalled();
  });

  it('publishes its own gate when none exists and clears it on unmount', async () => {
    const instance = createFlowDropInstance({ id: 'p-own' });
    instance.workflow.initialize(workflow());
    vi.spyOn(chatService, 'sendMessage').mockResolvedValue(finalTurn());

    render(instance);
    expect(instance.approvalGate).toBeNull();
    await send('hello');
    await waitFor(() => instance.approvalGate !== null, 'the panel to publish its gate');
    await settle();

    void unmount(mounted!);
    mounted = null;
    expect(instance.approvalGate).toBeNull();
  });

  it('a turn in flight at unmount finishes on a live runtime, not DETACHED', async () => {
    const instance = createFlowDropInstance({ id: 'p-inflight' });
    instance.workflow.initialize(workflow());

    let answerFirst!: (r: ChatTurnResponse) => void;
    const first = new Promise<ChatTurnResponse>((resolve) => (answerFirst = resolve));
    vi.spyOn(chatService, 'sendMessage').mockReturnValue(first);
    const results = vi.spyOn(chatService, 'sendToolResults').mockResolvedValue(finalTurn());

    render(instance);
    await send('list them');
    await waitFor(() => instance.approvalGate !== null, 'the panel to publish its gate');

    // The panel goes away while the server is still thinking.
    void unmount(mounted!);
    mounted = null;
    // Unpublished at once, so a panel mounted next builds its own gate…
    expect(instance.approvalGate).toBeNull();

    // …but the turn's own runtime is still alive when the calls arrive.
    answerFirst({
      turnId: 't-1',
      done: false,
      content: '',
      toolCalls: [{ id: 'c1', name: 'list_nodes', args: {} }]
    });
    await waitFor(() => results.mock.calls.length === 1, 'the tool results to be posted');

    expect(results).toHaveBeenCalledTimes(1);
    const posted = results.mock.calls[0][3].results[0];
    expect(posted.isError).toBeUndefined();
    expect(posted.content).not.toContain('DETACHED');
  });
});
