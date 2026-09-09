/**
 * The `webmcp` option of `mountFlowDropApp`: attaching adds no request and
 * does not hold up the mount, and the tools see the node types the editor
 * itself was given.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountFlowDropApp } from '../../../src/lib/svelte-app.js';
import { createFakeModelContext } from '../../../src/lib/webmcp/fake.js';
import type { NodeMetadata, Workflow } from '../../../src/lib/types/index.js';
import { DEFAULT_PORT_CONFIG } from '../../../src/lib/config/defaultPortConfig.js';
import * as globalSaveModule from '../../../src/lib/services/globalSave.js';

// The mount path's default `onSave` is `mountedApp.save()`, which delegates
// to globalSaveWorkflow(). Mock it here rather than exercise the real API
// client — the seam this suite already uses for fetch.
vi.mock('../../../src/lib/services/globalSave.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/services/globalSave.js')>();
  return { ...actual, globalSaveWorkflow: vi.fn(async () => true) };
});

const textIn = {
  node_type_id: 'text_input',
  name: 'Text Input',
  category: 'inputs',
  inputs: [],
  outputs: [{ id: 'value', name: 'Value', type: 'output', dataType: 'string' }],
  configSchema: { type: 'object', properties: {} }
} as NodeMetadata;

const workflow: Workflow = {
  id: 'wf-mount',
  name: 'Mounted Newsletter',
  nodes: [],
  edges: [],
  metadata: { schemaVersion: '1.0.0', createdAt: '', updatedAt: '' }
};

/** Poll until the adapter has attached (its module is imported on demand). */
async function untilAttached(app: { webmcp?: unknown }): Promise<void> {
  for (let i = 0; i < 200 && !app.webmcp; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

// The theme initialiser reads matchMedia; the shared mock is a vi.fn whose
// implementation the mock reset between tests can strip, so give it a real one.
beforeEach(() => {
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {}
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
});

afterEach(() => {
  delete (document as unknown as { modelContext?: unknown }).modelContext;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('mountFlowDropApp({ webmcp })', () => {
  it('attaches in the background with no extra request and the editor node types', async () => {
    const runtime = createFakeModelContext();
    Object.defineProperty(document, 'modelContext', { value: runtime, configurable: true });
    // Nothing here should need the network; anything that tries fails fast.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));
    const windowFetch = vi.spyOn(window, 'fetch').mockRejectedValue(new Error('no network'));

    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = await mountFlowDropApp(el, {
      workflow,
      nodes: [textIn],
      portConfig: DEFAULT_PORT_CONFIG,
      categories: [],
      webmcp: true,
      features: { showToasts: false, autoSaveDraft: false },
      instanceId: `mount-${Math.random().toString(36).slice(2)}`
    });

    // Mount resolved without waiting for the adapter; the handle arrives later.
    expect(app.webmcp).toBeUndefined();
    await untilAttached(app);
    expect(app.webmcp).toBeDefined();
    await app.webmcp!.ready;

    // No request for node types (or anything else) was made on our account:
    // `nodes` was given, so App skipped its fetch, and the adapter never fetches.
    const requests = [...fetchSpy.mock.calls, ...windowFetch.mock.calls].map((c) => String(c[0]));
    expect(requests.filter((url) => url.includes('nodes'))).toEqual([]);

    expect(runtime.tools.get('flowdrop_add_node')?.description).toContain('"Mounted Newsletter"');
    const out = await runtime.call('flowdrop_list_types');
    expect((out.data as { types: Array<{ typeId: string }> }).types.map((t) => t.typeId)).toContain(
      'text_input'
    );

    app.destroy();
    expect(app.webmcp?.attached).toBe(false);
    expect(runtime.tools.size).toBe(0);
  });

  it('publishes the host hooks on the instance whether or not WebMCP is on', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));
    vi.spyOn(window, 'fetch').mockRejectedValue(new Error('no network'));
    vi.mocked(globalSaveModule.globalSaveWorkflow).mockClear();

    const el = document.createElement('div');
    document.body.appendChild(el);
    const onRun = vi.fn(async () => ({ ok: true, data: { runId: 'r1' } }));
    const app = await mountFlowDropApp(el, {
      workflow,
      nodes: [textIn],
      portConfig: DEFAULT_PORT_CONFIG,
      categories: [],
      // No WebMCP runtime on this page and the option is off — the chat panel
      // still needs the same save the registration would get.
      features: { showToasts: false, autoSaveDraft: false },
      instanceId: `mount-host-${Math.random().toString(36).slice(2)}`
    });
    expect(app.webmcp).toBeUndefined();
    const hooks = app.instance.host.current;
    expect(typeof hooks.onSave).toBe('function');
    expect(hooks.onRun).toBeUndefined();
    await hooks.onSave?.();
    expect(globalSaveModule.globalSaveWorkflow).toHaveBeenCalledTimes(1);
    app.destroy();

    // With a webmcp option carrying run hooks, the instance carries them too.
    const el2 = document.createElement('div');
    document.body.appendChild(el2);
    const app2 = await mountFlowDropApp(el2, {
      workflow,
      nodes: [textIn],
      portConfig: DEFAULT_PORT_CONFIG,
      categories: [],
      webmcp: { onRun },
      features: { showToasts: false, autoSaveDraft: false },
      instanceId: `mount-host2-${Math.random().toString(36).slice(2)}`
    });
    expect(app2.instance.host.current.onRun).toBe(onRun);
    expect(typeof app2.instance.host.current.onSave).toBe('function');
    app2.destroy();
  });

  it("registers flowdrop_save and calling it invokes the mount's save path", async () => {
    const runtime = createFakeModelContext();
    Object.defineProperty(document, 'modelContext', { value: runtime, configurable: true });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));
    vi.spyOn(window, 'fetch').mockRejectedValue(new Error('no network'));
    vi.mocked(globalSaveModule.globalSaveWorkflow).mockClear();

    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = await mountFlowDropApp(el, {
      workflow,
      nodes: [textIn],
      portConfig: DEFAULT_PORT_CONFIG,
      categories: [],
      webmcp: { approval: 'auto' },
      features: { showToasts: false, autoSaveDraft: false },
      instanceId: `mount-save-${Math.random().toString(36).slice(2)}`
    });

    await untilAttached(app);
    await app.webmcp!.ready;

    expect(runtime.tools.has('flowdrop_save')).toBe(true);
    const out = await runtime.call('flowdrop_save');
    expect(out.ok).toBe(true);
    expect(globalSaveModule.globalSaveWorkflow).toHaveBeenCalledTimes(1);

    app.destroy();
  });

  it('reports UNAVAILABLE, not "saved", when the mount save path saved nothing', async () => {
    const runtime = createFakeModelContext();
    Object.defineProperty(document, 'modelContext', { value: runtime, configurable: true });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network'));
    vi.spyOn(window, 'fetch').mockRejectedValue(new Error('no network'));
    // The host's onBeforeSave said no: globalSaveWorkflow resolves false.
    vi.mocked(globalSaveModule.globalSaveWorkflow).mockClear();
    vi.mocked(globalSaveModule.globalSaveWorkflow).mockResolvedValueOnce(false);

    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = await mountFlowDropApp(el, {
      workflow,
      nodes: [textIn],
      portConfig: DEFAULT_PORT_CONFIG,
      categories: [],
      webmcp: { approval: 'auto' },
      features: { showToasts: false, autoSaveDraft: false },
      instanceId: `mount-save-cancel-${Math.random().toString(36).slice(2)}`
    });

    await untilAttached(app);
    await app.webmcp!.ready;

    const out = await runtime.call('flowdrop_save');
    expect(out.ok).toBe(false);
    expect(out.code).toBe('UNAVAILABLE');
    expect(globalSaveModule.globalSaveWorkflow).toHaveBeenCalledTimes(1);

    app.destroy();
  });
});
