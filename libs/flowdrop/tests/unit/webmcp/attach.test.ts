/**
 * WebMCP registration and gate — against a real FlowDropInstance and a fake
 * `modelContext`.
 *
 * The fake records `registerTool` calls and honours the abort signal the way
 * the spec describes, so detach semantics are exercised, not mocked away.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFlowDropInstance } from '../../../src/lib/stores/instanceContainer.svelte.js';
import { attachWebMCP, detectModelContext } from '../../../src/lib/webmcp/register.js';
import { createFakeModelContext } from '../../../src/lib/webmcp/fake.js';
import { updateSettings, resetSettings } from '../../../src/lib/stores/settingsStore.svelte.js';
import { setLogLevel } from '../../../src/lib/utils/logger.js';
import type { NodeMetadata, Workflow } from '../../../src/lib/types/index.js';
import type { Command } from '../../../src/lib/commands/types.js';
import type { WebMCPOptions } from '../../../src/lib/webmcp/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const textIn: NodeMetadata = {
  node_type_id: 'text_input',
  name: 'Text Input',
  category: 'inputs',
  inputs: [],
  outputs: [{ id: 'value', name: 'Value', type: 'output', dataType: 'string' }],
  configSchema: { type: 'object', properties: { defaultValue: { type: 'string' } } }
} as NodeMetadata;

const textOut: NodeMetadata = {
  node_type_id: 'text_output',
  name: 'Text Output',
  category: 'outputs',
  inputs: [{ id: 'text', name: 'Text', type: 'input', dataType: 'string' }],
  outputs: [],
  configSchema: { type: 'object', properties: {} }
} as NodeMetadata;

const nodeTypes = [textIn, textOut];

function workflow(): Workflow {
  return {
    id: 'wf-1',
    name: 'Newsletter',
    nodes: [],
    edges: [],
    metadata: { schemaVersion: '1.0.0', createdAt: '', updatedAt: '' }
  };
}

async function setup(
  approval: 'auto' | 'confirm' | ((c: Command[]) => Promise<boolean>) = 'auto',
  extra: Partial<WebMCPOptions> = {}
) {
  const runtime = createFakeModelContext();
  const instance = createFlowDropInstance({ id: `t-${Math.random().toString(36).slice(2)}` });
  instance.workflow.initialize(workflow());
  const handle = attachWebMCP(instance, { nodeTypes, approval, modelContext: runtime, ...extra });
  if (!handle) throw new Error('attach returned null');
  await handle.ready;
  return { runtime, instance, handle };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

const nodeCount = (i: ReturnType<typeof createFlowDropInstance>) =>
  i.workflow.current?.nodes.length ?? -1;

beforeEach(async () => {
  await resetSettings();
});

afterEach(async () => {
  await resetSettings();
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('attachWebMCP — registration', () => {
  it('returns null without a runtime and stays silent', () => {
    const warn = vi.spyOn(console, 'warn');
    const instance = createFlowDropInstance();
    expect(detectModelContext()).toBeNull();
    expect(attachWebMCP(instance, { nodeTypes })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('registers every descriptor with the prefix, readOnlyHint and workflow name', async () => {
    const { runtime, handle } = await setup();
    expect(handle.tools.length).toBe(runtime.tools.size);
    expect(handle.tools).toContain('flowdrop_add_node');
    expect(handle.tools).toContain('flowdrop_batch');
    // No UI handler → no view tool.
    expect(handle.tools).not.toContain('flowdrop_view');
    expect(runtime.tools.get('flowdrop_list_nodes')?.annotations?.readOnlyHint).toBe(true);
    expect(runtime.tools.get('flowdrop_add_node')?.annotations?.readOnlyHint).toBe(false);
    expect(runtime.tools.get('flowdrop_add_node')?.description).toContain('"Newsletter"');
  });

  it('registers view when a UI handler is given', () => {
    const runtime = createFakeModelContext();
    const instance = createFlowDropInstance();
    instance.workflow.initialize(workflow());
    const onUIAction = vi.fn();
    attachWebMCP(instance, { nodeTypes, approval: 'auto', modelContext: runtime, onUIAction });
    expect(runtime.tools.has('flowdrop_view')).toBe(true);
  });

  it('throws on a second attach with the same prefix on the same runtime', async () => {
    const { runtime } = await setup();
    const other = createFlowDropInstance();
    expect(() => attachWebMCP(other, { nodeTypes, modelContext: runtime })).toThrow(
      /already registered/
    );
    // A distinct prefix is fine.
    const h2 = attachWebMCP(other, { nodeTypes, modelContext: runtime, prefix: 'second' });
    await h2?.ready;
    expect(h2?.tools).toContain('second_add_node');
  });

  it('detach removes every tool and frees the prefix', async () => {
    const { runtime, handle, instance } = await setup();
    handle.detach();
    expect(handle.attached).toBe(false);
    expect(runtime.tools.size).toBe(0);
    handle.detach(); // idempotent
    expect(attachWebMCP(instance, { nodeTypes, modelContext: runtime })).not.toBeNull();
  });

  it('detaches when the instance is destroyed', async () => {
    const { runtime, handle, instance } = await setup();
    instance.destroy();
    expect(handle.attached).toBe(false);
    expect(runtime.tools.size).toBe(0);
  });

  it('a detached adapter leaves nothing behind on the instance', async () => {
    const { handle, instance } = await setup();
    const detach = vi.spyOn(handle, 'detach');
    handle.detach();
    instance.destroy();
    // destroy() found no adapter hook left to run; detach ran once, by us.
    expect(detach).toHaveBeenCalledTimes(1);
    expect(handle.attached).toBe(false);
  });

  it('tools the runtime refuses are warned about once and not listed', async () => {
    const runtime = createFakeModelContext();
    const original = runtime.registerTool.bind(runtime);
    runtime.registerTool = (tool, options) =>
      tool.name === 'flowdrop_undo' ? Promise.reject(new Error('nope')) : original(tool, options);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setLogLevel('warn');
    const instance = createFlowDropInstance();
    instance.workflow.initialize(workflow());
    const handle = attachWebMCP(instance, { nodeTypes, approval: 'auto', modelContext: runtime });
    if (!handle) throw new Error('attach returned null');
    await handle.ready;
    setLogLevel('none');
    expect(handle.tools).toContain('flowdrop_add_node');
    expect(handle.tools).not.toContain('flowdrop_undo');
    expect(handle.tools.length).toBe(runtime.tools.size);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('flowdrop_undo');
  });

  it('reads node types from the instance when none are passed', async () => {
    const runtime = createFakeModelContext();
    const instance = createFlowDropInstance();
    instance.workflow.initialize(workflow());
    const handle = attachWebMCP(instance, { approval: 'auto', modelContext: runtime });
    await handle?.ready;
    let out = await runtime.call('flowdrop_list_types');
    expect((out.data as { types: unknown[] }).types).toHaveLength(0);
    instance.nodeTypes.set(nodeTypes);
    out = await runtime.call('flowdrop_list_types');
    expect((out.data as { types: unknown[] }).types).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

describe('attachWebMCP — execution', () => {
  it('read tools run without the gate', async () => {
    const gate = vi.fn(async () => false);
    const { runtime } = await setup(gate);
    const out = await runtime.call('flowdrop_list_types');
    expect(out.ok).toBe(true);
    expect((out.data as { types: unknown[] }).types).toHaveLength(2);
    expect(gate).not.toHaveBeenCalled();
  });

  it('mutating tools wait on the gate and apply when approved', async () => {
    const gate = vi.fn(async () => true);
    const { runtime, instance } = await setup(gate);
    const out = await runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    expect(out.ok).toBe(true);
    expect((out.data as { nodeId: string }).nodeId).toBe('text_input.1');
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate.mock.calls[0][0]).toEqual([{ type: 'add_node', nodeTypeId: 'text_input' }]);
    expect(nodeCount(instance)).toBe(1);
  });

  it('a rejected gate leaves the workflow untouched', async () => {
    const { runtime, instance } = await setup(async () => false);
    const out = await runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    expect(out).toEqual({ ok: false, code: 'REJECTED', error: expect.any(String) });
    expect(nodeCount(instance)).toBe(0);
  });

  it('a second mutating call while the gate is open gets BUSY', async () => {
    let release!: (v: boolean) => void;
    const { runtime, instance } = await setup(() => new Promise<boolean>((r) => (release = r)));
    const first = runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    await Promise.resolve();
    const second = await runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    expect(second.code).toBe('BUSY');
    release(true);
    expect((await first).ok).toBe(true);
    expect(nodeCount(instance)).toBe(1);
  });

  it('a batch with a failing third command rolls back and reports it', async () => {
    const { runtime, instance } = await setup('auto');
    const out = await runtime.call('flowdrop_batch', {
      commands: [
        { type: 'add_node', nodeTypeId: 'text_input' },
        { type: 'add_node', nodeTypeId: 'text_output' },
        {
          type: 'connect',
          sourceNodeId: 'text_input.1',
          sourcePort: 'nope',
          targetNodeId: 'text_output.1',
          targetPort: 'text'
        }
      ]
    });
    expect(out.ok).toBe(false);
    expect(out.rolledBack).toBe(true);
    expect(out.completedCount).toBe(2);
    expect(out.totalCount).toBe(3);
    const results = out.results as Array<{ ok: boolean; code?: string }>;
    expect(results[2].ok).toBe(false);
    expect(results[2].code).toBe('PORT_NOT_FOUND');
    expect(nodeCount(instance)).toBe(0);
  });

  it('a successful batch is one undo step', async () => {
    const { runtime, instance } = await setup('auto');
    const out = await runtime.call('flowdrop_batch', {
      commands: [
        { type: 'add_node', nodeTypeId: 'text_input' },
        { type: 'add_node', nodeTypeId: 'text_output' },
        {
          type: 'connect',
          sourceNodeId: 'text_input.1',
          sourcePort: 'value',
          targetNodeId: 'text_output.1',
          targetPort: 'text'
        }
      ]
    });
    expect(out.ok).toBe(true);
    expect(nodeCount(instance)).toBe(2);
    expect(instance.workflow.current?.edges).toHaveLength(1);
    const undo = await runtime.call('flowdrop_undo');
    expect(undo.ok).toBe(true);
    expect(nodeCount(instance)).toBe(0);
  });

  it('set_config stores typed values the way the DSL does', async () => {
    const { runtime, instance } = await setup('auto');
    await runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    await runtime.call('flowdrop_set_config', {
      nodeId: 'text_input.1',
      key: 'defaultValue',
      value: 'true'
    });
    expect(instance.workflow.current?.nodes[0].data.config.defaultValue).toBe('true');
    const read = await runtime.call('flowdrop_get_config', {
      nodeId: 'text_input.1',
      key: 'defaultValue'
    });
    expect((read.data as { value: unknown }).value).toBe('true');
  });

  it('invalid arguments never reach the gate', async () => {
    const gate = vi.fn(async () => true);
    const { runtime } = await setup(gate);
    const out = await runtime.call('flowdrop_add_node', { nodeTypeId: 42 });
    expect(out.code).toBe('INVALID_ARGUMENTS');
    expect(gate).not.toHaveBeenCalled();
  });

  it('executor errors come back with their code', async () => {
    const { runtime } = await setup('auto');
    const out = await runtime.call('flowdrop_info', { nodeId: 'ghost.1' });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('NODE_NOT_FOUND');
  });

  it('layout tools are skipped with the chat panel wording when the setting is off', async () => {
    const gate = vi.fn(async () => true);
    const { runtime, instance } = await setup(gate);
    await runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    const before = instance.workflow.current?.nodes[0].position;

    updateSettings({ behavior: { chatAllowLayoutChanges: false } });
    const out = await runtime.call('flowdrop_beautify_layout');
    expect(out.ok).toBe(true);
    expect(out.totalCount).toBe(0);
    expect(out.skipped).toEqual([
      { type: 'beautify_layout', reason: 'Skipped — AI layout changes are disabled in Settings' }
    ]);
    expect(instance.workflow.current?.nodes[0].position).toEqual(before);
    // Only the add_node call went through the gate.
    expect(gate).toHaveBeenCalledTimes(1);

    // Inside a batch the rest still applies.
    const mixed = await runtime.call('flowdrop_batch', {
      commands: [{ type: 'beautify_layout' }, { type: 'add_node', nodeTypeId: 'text_output' }]
    });
    expect(mixed.ok).toBe(true);
    expect(mixed.completedCount).toBe(1);
    expect(mixed.skipped).toHaveLength(1);
    expect(nodeCount(instance)).toBe(2);
  });

  it('view actions reach the UI handler', async () => {
    const runtime = createFakeModelContext();
    const instance = createFlowDropInstance();
    instance.workflow.initialize(workflow());
    const onUIAction = vi.fn();
    attachWebMCP(instance, { nodeTypes, approval: 'auto', modelContext: runtime, onUIAction });
    await runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    const out = await runtime.call('flowdrop_view', {
      action: 'select_node',
      nodeId: 'text_input.1'
    });
    expect(out.ok).toBe(true);
    expect(onUIAction).toHaveBeenCalledWith({ type: 'select_node', nodeId: 'text_input.1' });
  });

  it('view actions run without the gate; a batch mixing view and a change is gated whole', async () => {
    const gate = vi.fn(async () => true);
    const runtime = createFakeModelContext();
    const instance = createFlowDropInstance();
    instance.workflow.initialize(workflow());
    const onUIAction = vi.fn();
    const handle = attachWebMCP(instance, {
      nodeTypes,
      approval: gate,
      modelContext: runtime,
      onUIAction
    });
    await handle?.ready;

    const view = await runtime.call('flowdrop_view', { action: 'zoom_in' });
    expect(view.ok).toBe(true);
    expect(onUIAction).toHaveBeenCalledWith({ type: 'canvas_zoom_in' });
    expect(gate).not.toHaveBeenCalled();

    const mixed = await runtime.call('flowdrop_batch', {
      commands: [
        { type: 'view', action: 'fit_view' },
        { type: 'add_node', nodeTypeId: 'text_input' }
      ]
    });
    expect(mixed.ok).toBe(true);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate.mock.calls[0][0]).toEqual([
      { type: 'canvas_fit_view' },
      { type: 'add_node', nodeTypeId: 'text_input' }
    ]);

    // undo changes the document: still gated.
    await runtime.call('flowdrop_undo');
    expect(gate).toHaveBeenCalledTimes(2);
  });

  it('reports NO_WORKFLOW when nothing is loaded', async () => {
    const runtime = createFakeModelContext();
    const instance = createFlowDropInstance();
    attachWebMCP(instance, { nodeTypes, approval: 'auto', modelContext: runtime });
    const out = await runtime.call('flowdrop_list_nodes');
    expect(out.code).toBe('NO_WORKFLOW');
  });

  it('refuses calls after detach', async () => {
    const { runtime, handle } = await setup('auto');
    const tool = runtime.tools.get('flowdrop_list_nodes')!;
    handle.detach();
    const out = JSON.parse((await tool.execute({})).content[0].text);
    expect(out.code).toBe('DETACHED');
  });
});

// ---------------------------------------------------------------------------
// The built-in confirm dialog
// ---------------------------------------------------------------------------

describe('attachWebMCP — confirm dialog', () => {
  const dialog = () => document.querySelector('[data-testid="flowdrop-webmcp-confirm"]');
  const click = (testid: string) =>
    (document.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement).click();

  it('renders the commands, applies on Apply, and disappears', async () => {
    const { runtime, instance } = await setup('confirm');
    const pending = runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    await new Promise((r) => setTimeout(r, 0));

    expect(dialog()).not.toBeNull();
    expect(dialog()?.textContent).toContain('Newsletter');
    expect(dialog()?.textContent).toContain('Add node text_input');

    click('flowdrop-webmcp-approve');
    const out = await pending;
    expect(out.ok).toBe(true);
    expect(nodeCount(instance)).toBe(1);
    expect(dialog()).toBeNull();
  });

  it('never opens for a view call, even with approval: confirm', async () => {
    const runtime = createFakeModelContext();
    const instance = createFlowDropInstance();
    instance.workflow.initialize(workflow());
    const handle = attachWebMCP(instance, {
      nodeTypes,
      approval: 'confirm',
      modelContext: runtime,
      onUIAction: vi.fn()
    });
    await handle?.ready;
    const out = await runtime.call('flowdrop_view', { action: 'fit_view' });
    expect(out.ok).toBe(true);
    expect(dialog()).toBeNull();

    // A batch with a change in it lists every line, view included.
    const pending = runtime.call('flowdrop_batch', {
      commands: [
        { type: 'view', action: 'fit_view' },
        { type: 'add_node', nodeTypeId: 'text_input' }
      ]
    });
    await tick();
    expect(dialog()?.textContent).toContain('Fit view');
    expect(dialog()?.textContent).toContain('Add node text_input');
    click('flowdrop-webmcp-approve');
    expect((await pending).ok).toBe(true);
  });

  it('reads its strings from the messages option', async () => {
    const { runtime } = await setup('confirm', {
      messages: {
        webmcp: {
          confirmTitle: ({ name }) => `Ein Agent möchte „${name}“ ändern`,
          reject: 'Ablehnen',
          apply: 'Anwenden'
        }
      }
    });
    const pending = runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    await tick();
    expect(dialog()?.textContent).toContain('Ein Agent möchte „Newsletter“ ändern');
    expect(
      document.querySelector('[data-testid="flowdrop-webmcp-reject"]')?.textContent?.trim()
    ).toBe('Ablehnen');
    expect(
      document.querySelector('[data-testid="flowdrop-webmcp-approve"]')?.textContent?.trim()
    ).toBe('Anwenden');
    click('flowdrop-webmcp-reject');
    expect((await pending).code).toBe('REJECTED');
  });

  it('starts on Apply, traps Tab between the two buttons, and rejects on Escape', async () => {
    const { runtime } = await setup('confirm');
    const pending = runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    await tick();
    const approve = document.querySelector('[data-testid="flowdrop-webmcp-approve"]')!;
    const reject = document.querySelector('[data-testid="flowdrop-webmcp-reject"]')!;
    expect(document.activeElement).toBe(approve);

    const key = (k: string) =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true })
      );
    key('Tab');
    expect(document.activeElement).toBe(reject);
    key('Tab');
    expect(document.activeElement).toBe(approve);
    key('Escape');
    expect((await pending).code).toBe('REJECTED');
    expect(dialog()).toBeNull();
  });

  it('rejects on Reject and on detach', async () => {
    const { runtime, instance, handle } = await setup('confirm');

    const first = runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    await new Promise((r) => setTimeout(r, 0));
    click('flowdrop-webmcp-reject');
    expect((await first).code).toBe('REJECTED');
    expect(nodeCount(instance)).toBe(0);

    const second = runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    await new Promise((r) => setTimeout(r, 0));
    expect(dialog()).not.toBeNull();
    handle.detach();
    expect((await second).code).toBe('REJECTED');
    expect(dialog()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// save
// ---------------------------------------------------------------------------

describe('attachWebMCP — save', () => {
  const dialog = () => document.querySelector('[data-testid="flowdrop-webmcp-confirm"]');
  const click = (testid: string) =>
    (document.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement).click();

  it('is not registered without onSave', async () => {
    const { handle } = await setup('auto');
    expect(handle.tools).not.toContain('flowdrop_save');
  });

  it('is registered when onSave is given', async () => {
    const onSave = vi.fn(async () => {});
    const { handle } = await setup('auto', { onSave });
    expect(handle.tools).toContain('flowdrop_save');
  });

  it('under approval: confirm, shows the save line; Reject rejects and onSave is not called', async () => {
    const onSave = vi.fn(async () => {});
    const { runtime } = await setup('confirm', { onSave });
    const pending = runtime.call('flowdrop_save');
    await tick();

    expect(dialog()).not.toBeNull();
    expect(dialog()?.textContent).toContain('Save “Newsletter” to the server');

    click('flowdrop-webmcp-reject');
    const out = await pending;
    expect(out.code).toBe('REJECTED');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('under approval: confirm, Apply calls onSave once and reports ok', async () => {
    const onSave = vi.fn(async () => {});
    const { runtime } = await setup('confirm', { onSave });
    const pending = runtime.call('flowdrop_save');
    await tick();

    click('flowdrop-webmcp-approve');
    const out = await pending;
    expect(out.ok).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('approval: auto calls onSave without showing a dialog', async () => {
    const onSave = vi.fn(async () => {});
    const { runtime } = await setup('auto', { onSave });
    const out = await runtime.call('flowdrop_save');
    expect(out.ok).toBe(true);
    expect(dialog()).toBeNull();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('a custom approval function receives ([], { tool: "save" })', async () => {
    const onSave = vi.fn(async () => {});
    const approval = vi.fn(async () => true);
    const { runtime } = await setup(approval, { onSave });
    await runtime.call('flowdrop_save');
    expect(approval).toHaveBeenCalledWith([], { tool: 'save' });
  });

  it('a custom approval function for a normal change receives (commands, { tool: "add_node" })', async () => {
    const approval = vi.fn(async () => true);
    const { runtime } = await setup(approval);
    await runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    expect(approval).toHaveBeenCalledWith([{ type: 'add_node', nodeTypeId: 'text_input' }], {
      tool: 'add_node'
    });
  });

  it('onSave rejecting reports SAVE_FAILED', async () => {
    const onSave = vi.fn(async () => {
      throw new Error('network down');
    });
    const { runtime } = await setup('auto', { onSave });
    const out = await runtime.call('flowdrop_save');
    expect(out.ok).toBe(false);
    expect(out.code).toBe('SAVE_FAILED');
    expect(out.error).toContain('network down');
  });

  it('a second mutating call while the save dialog is open gets BUSY', async () => {
    const onSave = vi.fn(async () => {});
    const { runtime } = await setup('confirm', { onSave });
    const first = runtime.call('flowdrop_save');
    await tick();
    const second = await runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    expect(second.code).toBe('BUSY');
    click('flowdrop-webmcp-approve');
    expect((await first).ok).toBe(true);
  });

  it('rejects unknown arguments', async () => {
    const onSave = vi.fn(async () => {});
    const { runtime } = await setup('auto', { onSave });
    const out = await runtime.call('flowdrop_save', { extra: true });
    expect(out.code).toBe('INVALID_ARGUMENTS');
    expect(onSave).not.toHaveBeenCalled();
  });
});
