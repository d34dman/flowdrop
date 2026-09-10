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

  it('publishes its gate on the instance, reuses one already there, and clears only its own', async () => {
    const { handle, instance } = await setup('auto');
    expect(instance.approvalGate).not.toBeNull();
    const own = instance.approvalGate;
    handle?.detach();
    expect(instance.approvalGate).toBeNull();

    // Another surface published first: the registration asks that gate, and
    // detaching leaves it in place — it is not ours.
    const request = vi.fn(async () => true);
    const shared = { request, busy: false, editsPreApproved: false, dispose: vi.fn() };
    const runtime = createFakeModelContext();
    const other = createFlowDropInstance({ id: `t-${Math.random().toString(36).slice(2)}` });
    other.workflow.initialize(workflow());
    other.approvalGate = shared;
    const h2 = attachWebMCP(other, { nodeTypes, approval: 'confirm', modelContext: runtime });
    await h2?.ready;
    await runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toEqual({ tool: 'add_node' });
    h2?.detach();
    expect(other.approvalGate).toBe(shared);
    expect(shared.dispose).not.toHaveBeenCalled();
    expect(own).not.toBe(shared);
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

  it('starts on Apply, traps Tab inside the dialog, and rejects on Escape', async () => {
    const { runtime } = await setup('confirm');
    const pending = runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    await tick();
    const approve = document.querySelector('[data-testid="flowdrop-webmcp-approve"]')!;
    const reject = document.querySelector('[data-testid="flowdrop-webmcp-reject"]')!;
    const remember = document.querySelector('[data-testid="flowdrop-webmcp-remember"]')!;
    expect(document.activeElement).toBe(approve);

    const key = (k: string, shiftKey = false) =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true })
      );
    // Apply → Reject → remember-edits → Apply, and back with Shift+Tab.
    key('Tab');
    expect(document.activeElement).toBe(reject);
    key('Tab');
    expect(document.activeElement).toBe(remember);
    key('Tab');
    expect(document.activeElement).toBe(approve);
    key('Tab', true);
    expect(document.activeElement).toBe(remember);
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

// ---------------------------------------------------------------------------
// Read before you write — describe → batch → save (agent-authoring plan, Phase 1)
// ---------------------------------------------------------------------------

describe('attachWebMCP — describe, then build, then save', () => {
  it('describe_type answers ports and config schema without the gate, then a batch builds and save persists', async () => {
    const gate = vi.fn(async () => true);
    const onSave = vi.fn(async () => {});
    const { runtime, instance } = await setup(gate, { onSave });

    const described = await runtime.call('flowdrop_describe_type', { nodeTypeId: 'text_input' });
    expect(described.ok).toBe(true);
    const data = described.data as {
      typeId: string;
      outputs: Array<{ portId: string; dataType: string }>;
      config: Array<{ key: string; type: string }>;
    };
    expect(data.typeId).toBe('text_input');
    expect(data.outputs).toEqual([{ portId: 'value', name: 'Value', dataType: 'string' }]);
    expect(data.config).toEqual([{ key: 'defaultValue', type: 'string' }]);
    expect(gate).not.toHaveBeenCalled();

    const found = await runtime.call('flowdrop_search_types', { query: 'OUTPUT' });
    expect((found.data as { types: Array<{ typeId: string }> }).types.map((t) => t.typeId)).toEqual(
      ['text_output']
    );

    const built = await runtime.call('flowdrop_batch', {
      commands: [
        { type: 'add_node', nodeTypeId: 'text_input' },
        { type: 'add_node', nodeTypeId: 'text_output' },
        {
          type: 'connect',
          sourceNodeId: 'text_input.1',
          sourcePort: 'value',
          targetNodeId: 'text_output.1',
          targetPort: 'text'
        },
        { type: 'set_config', nodeId: 'text_input.1', key: 'defaultValue', value: 'hello' }
      ]
    });
    expect(built.ok).toBe(true);
    expect(nodeCount(instance)).toBe(2);
    expect(instance.workflow.current?.edges).toHaveLength(1);

    const cfg = await runtime.call('flowdrop_get_config', { nodeId: 'text_input.1' });
    expect((cfg.data as { values: Record<string, unknown> }).values).toEqual({
      defaultValue: 'hello'
    });
    expect((cfg.data as { schema: unknown[] }).schema).toEqual([
      { key: 'defaultValue', type: 'string' }
    ]);

    const saved = await runtime.call('flowdrop_save');
    expect(saved.ok).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
    // One approval per mutating call: the batch and the save.
    expect(gate).toHaveBeenCalledTimes(2);
  });

  it('describe_type and get_config pass the host fields through untouched', async () => {
    const withHost: NodeMetadata = {
      ...textIn,
      confirmation: { policy: 'ask', source: 'plugin' },
      can: { add: true },
      agent: { usage: 'Start of most flows.' }
    };
    const { runtime } = await setup('auto', { nodeTypes: [withHost, textOut] });
    const out = await runtime.call('flowdrop_describe_type', { nodeTypeId: 'text_input' });
    expect(out.data).toMatchObject({
      confirmation: { policy: 'ask', source: 'plugin' },
      can: { add: true },
      agent: { usage: 'Start of most flows.' }
    });
  });

  it('an unknown type teaches: names near misses and list_types', async () => {
    const { runtime } = await setup('auto');
    const out = await runtime.call('flowdrop_add_node', { nodeTypeId: 'text' });
    expect(out.code).toBe('NODE_TYPE_NOT_FOUND');
    expect(String(out.error)).toContain('Did you mean: text_input, text_output');
  });
});

// ---------------------------------------------------------------------------
// Host tools — run / run_status, envelope, can, CONFLICT (Phases 2–3)
// ---------------------------------------------------------------------------

describe('attachWebMCP — run and run_status', () => {
  it('registers run only with onRun, and run_status only with both hooks', async () => {
    const a = await setup('auto');
    expect(a.runtime.tools.has('flowdrop_run')).toBe(false);
    expect(a.runtime.tools.has('flowdrop_run_status')).toBe(false);

    const b = await setup('auto', { onRun: async () => ({ ok: true, data: { runId: '1' } }) });
    expect(b.runtime.tools.has('flowdrop_run')).toBe(true);
    expect(b.runtime.tools.has('flowdrop_run_status')).toBe(false);
    expect(b.runtime.tools.get('flowdrop_run')?.annotations?.consequentialHint).toBe(true);

    const c = await setup('auto', {
      onRun: async () => ({ ok: true, data: { runId: '1' } }),
      onRunStatus: async (runId) => ({ ok: true, data: { runId, status: 'running' } })
    });
    expect(c.runtime.tools.has('flowdrop_run_status')).toBe(true);
    expect(c.runtime.tools.get('flowdrop_run_status')?.annotations?.readOnlyHint).toBe(true);
  });

  it('run is gated, passes inputs to the hook, and relays the envelope', async () => {
    const gate = vi.fn(async () => true);
    const onRun = vi.fn(async (_inputs: Record<string, unknown>) => ({
      ok: true,
      data: { runId: '42', status: 'pending', queued: true },
      message: 'Run started'
    }));
    const { runtime } = await setup(gate, { onRun });
    const out = await runtime.call('flowdrop_run', { inputs: { url: 'https://x' } });
    expect(out).toEqual({
      ok: true,
      message: 'Run started',
      data: { runId: '42', status: 'pending', queued: true }
    });
    expect(onRun).toHaveBeenCalledWith({ url: 'https://x' });
    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate.mock.calls[0][1]).toEqual({ tool: 'run' });
  });

  it('a host refusal comes back with the host code, not a thrown error', async () => {
    const { runtime } = await setup('auto', {
      onRun: async () => ({ ok: false, code: 'UNAVAILABLE', message: 'Save the workflow first' })
    });
    const out = await runtime.call('flowdrop_run');
    expect(out).toEqual({ ok: false, code: 'UNAVAILABLE', error: 'Save the workflow first' });
  });

  it('run_status is a read and relays a paused run as PENDING with node and message', async () => {
    const gate = vi.fn(async () => true);
    const { runtime } = await setup(gate, {
      onRun: async () => ({ ok: true, data: { runId: '7' } }),
      onRunStatus: async (runId) => ({
        ok: true,
        data: {
          runId,
          status: 'paused',
          pending: {
            interruptId: 'i-1',
            type: 'confirmation',
            nodeId: 'http_request.1',
            message: 'Allow the request?'
          }
        }
      })
    });
    const out = await runtime.call('flowdrop_run_status', { runId: '7' });
    expect(gate).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
    expect(out.code).toBe('PENDING');
    expect(String(out.message)).toContain('http_request.1');
    expect(String(out.message)).toContain('Allow the request?');
    expect(String(out.message)).toContain('person');
    expect((out.data as { pending: { interruptId: string } }).pending.interruptId).toBe('i-1');
  });

  it('run_status relays a completed run with its outputs', async () => {
    const { runtime } = await setup('auto', {
      onRun: async () => ({ ok: true, data: { runId: '7' } }),
      onRunStatus: async (runId) => ({
        ok: true,
        data: { runId, status: 'completed', outputs: { markdown: '# Hi' } }
      })
    });
    const out = await runtime.call('flowdrop_run_status', { runId: '7' });
    expect(out.ok).toBe(true);
    expect(out.code).toBeUndefined();
    expect(out.message).toBe('Run 7: completed');
    expect((out.data as { outputs: unknown }).outputs).toEqual({ markdown: '# Hi' });
  });

  it('run_status without a runId is an argument error', async () => {
    const { runtime } = await setup('auto', {
      onRun: async () => ({ ok: true, data: { runId: '7' } }),
      onRunStatus: async (runId) => ({ ok: true, data: { runId, status: 'running' } })
    });
    const out = await runtime.call('flowdrop_run_status', {});
    expect(out.code).toBe('INVALID_ARGUMENTS');
  });
});

describe('attachWebMCP — can and CONFLICT', () => {
  it('pre-empts save and run with FORBIDDEN when the workflow says the user may not', async () => {
    const gate = vi.fn(async () => true);
    const onSave = vi.fn(async () => {});
    const onRun = vi.fn(async () => ({ ok: true, data: { runId: '1' } }));
    const { runtime, instance } = await setup(gate, { onSave, onRun });
    instance.workflow.acknowledgeServer({ can: { save: false, run: false } });

    expect(await runtime.call('flowdrop_save')).toEqual({
      ok: false,
      code: 'FORBIDDEN',
      error: expect.stringContaining('not permitted')
    });
    expect((await runtime.call('flowdrop_run')).code).toBe('FORBIDDEN');
    expect(onSave).not.toHaveBeenCalled();
    expect(onRun).not.toHaveBeenCalled();
    // Pre-empted before the gate: the person is not asked to approve a refusal.
    expect(gate).not.toHaveBeenCalled();
  });

  it('when the host says nothing about can, the server decides', async () => {
    const onSave = vi.fn(async () => {});
    const { runtime } = await setup('auto', { onSave });
    expect((await runtime.call('flowdrop_save')).ok).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('a thrown 409 from onSave is relayed as CONFLICT with a reload hint', async () => {
    const conflict = Object.assign(new Error('The workflow changed on the server'), {
      status: 409,
      errorData: { error_code: 'CONFLICT' }
    });
    const { runtime } = await setup('auto', {
      onSave: async () => {
        throw conflict;
      }
    });
    const out = await runtime.call('flowdrop_save');
    expect(out.code).toBe('CONFLICT');
    expect(String(out.error)).toContain('reload');
  });

  it('a 409 whose message already says to reload is not told twice', async () => {
    const conflict = Object.assign(
      new Error('The workflow changed on the server since it was loaded; reload before saving'),
      { status: 409 }
    );
    const { runtime } = await setup('auto', {
      onSave: async () => {
        throw conflict;
      }
    });
    const out = await runtime.call('flowdrop_save');
    expect(out.code).toBe('CONFLICT');
    expect(out.error).toBe(
      'The workflow changed on the server since it was loaded; reload before saving'
    );
  });

  it('an envelope returned by onSave is relayed as-is', async () => {
    const { runtime } = await setup('auto', {
      onSave: async () => ({
        ok: false,
        code: 'INVALID',
        message: 'Port text on text_output.1 is not connected',
        can: { save: true }
      })
    });
    const out = await runtime.call('flowdrop_save');
    expect(out).toEqual({
      ok: false,
      code: 'INVALID',
      error: 'Port text on text_output.1 is not connected',
      can: { save: true }
    });
  });

  it('any other thrown error stays SAVE_FAILED', async () => {
    const { runtime } = await setup('auto', {
      onSave: async () => {
        throw new Error('boom');
      }
    });
    expect(await runtime.call('flowdrop_save')).toEqual({
      ok: false,
      code: 'SAVE_FAILED',
      error: 'boom'
    });
  });
});

// ---------------------------------------------------------------------------
// Dialog ergonomics — batch summary, remember edits (Phase 3)
// ---------------------------------------------------------------------------

describe('attachWebMCP — batch summary and remembered edits', () => {
  const dialog = () => document.querySelector('[data-testid="flowdrop-webmcp-confirm"]');
  const click = (testid: string) =>
    (document.querySelector(`[data-testid="${testid}"]`) as HTMLElement).click();

  it('a batch shows a change summary above the lines', async () => {
    const { runtime } = await setup('confirm');
    const pending = runtime.call('flowdrop_batch', {
      commands: [
        { type: 'add_node', nodeTypeId: 'text_input' },
        { type: 'add_node', nodeTypeId: 'text_output' },
        {
          type: 'connect',
          sourceNodeId: 'text_input.1',
          sourcePort: 'value',
          targetNodeId: 'text_output.1',
          targetPort: 'text'
        },
        { type: 'set_config', nodeId: 'text_input.1', key: 'defaultValue', value: 'x' }
      ]
    });
    await tick();
    expect(dialog()?.textContent).toContain(
      '4 changes — adds 2 nodes, connects 1 edge, sets 1 config key.'
    );
    expect(dialog()?.textContent).toContain('Add node text_input');
    click('flowdrop-webmcp-approve');
    expect((await pending).ok).toBe(true);
  });

  it('a single change keeps the one-change hint', async () => {
    const { runtime } = await setup('confirm');
    const pending = runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    await tick();
    expect(dialog()?.textContent).toContain('1 change — applied together');
    click('flowdrop-webmcp-reject');
    await pending;
  });

  it('ticking "apply further edits" skips the dialog for later edits but never for save or run', async () => {
    const onSave = vi.fn(async () => {});
    const { runtime, instance } = await setup('confirm', { onSave });

    // The checkbox is offered for an edit …
    const first = runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    await tick();
    const box = document.querySelector(
      '[data-testid="flowdrop-webmcp-remember"]'
    ) as HTMLInputElement;
    expect(box).not.toBeNull();
    box.click();
    expect(box.checked).toBe(true);
    click('flowdrop-webmcp-approve');
    expect((await first).ok).toBe(true);

    // … and a later edit runs without a dialog.
    const second = await runtime.call('flowdrop_add_node', { nodeTypeId: 'text_output' });
    expect(second.ok).toBe(true);
    expect(dialog()).toBeNull();
    expect(nodeCount(instance)).toBe(2);

    // Save still asks, and does not offer the checkbox.
    const save = runtime.call('flowdrop_save');
    await tick();
    expect(dialog()).not.toBeNull();
    expect(document.querySelector('[data-testid="flowdrop-webmcp-remember"]')).toBeNull();
    click('flowdrop-webmcp-approve');
    expect((await save).ok).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('rejecting with the box ticked remembers nothing', async () => {
    const { runtime } = await setup('confirm');
    const first = runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    await tick();
    (
      document.querySelector('[data-testid="flowdrop-webmcp-remember"]') as HTMLInputElement
    ).click();
    click('flowdrop-webmcp-reject');
    expect((await first).code).toBe('REJECTED');

    const second = runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    await tick();
    expect(dialog()).not.toBeNull();
    click('flowdrop-webmcp-reject');
    await second;
  });

  it('rememberEdits: false hides the checkbox', async () => {
    const { runtime } = await setup('confirm', { rememberEdits: false });
    const pending = runtime.call('flowdrop_add_node', { nodeTypeId: 'text_input' });
    await tick();
    expect(document.querySelector('[data-testid="flowdrop-webmcp-remember"]')).toBeNull();
    click('flowdrop-webmcp-reject');
    await pending;
  });
});
