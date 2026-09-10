/**
 * The tool runtime on its own — `runTool(name, input)` without a WebMCP
 * registration, the way the chat panel uses it. The registration's behaviour
 * (gate, batch, host tools) is pinned in attach.test.ts through the same
 * runtime; this file covers what only a direct caller sees.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFlowDropInstance } from '../../../src/lib/stores/instanceContainer.svelte.js';
import { createToolRuntime, buildHostToolDescriptors } from '../../../src/lib/webmcp/runtime.js';
import { resetSettings, updateSettings } from '../../../src/lib/stores/settingsStore.svelte.js';
import type { NodeMetadata, Workflow } from '../../../src/lib/types/index.js';

const textIn: NodeMetadata = {
  node_type_id: 'text_input',
  name: 'Text Input',
  category: 'inputs',
  inputs: [],
  outputs: [{ id: 'value', name: 'Value', type: 'output', dataType: 'string' }],
  configSchema: { type: 'object', properties: { defaultValue: { type: 'string' } } }
} as NodeMetadata;

function workflow(): Workflow {
  return {
    id: 'wf-1',
    name: 'Runtime',
    nodes: [],
    edges: [],
    metadata: { schemaVersion: '1.0.0', createdAt: '', updatedAt: '' }
  };
}

function setup(extra: Partial<Parameters<typeof createToolRuntime>[0]> = {}) {
  const instance = createFlowDropInstance({ id: `rt-${Math.random().toString(36).slice(2)}` });
  instance.workflow.initialize(workflow());
  const runtime = createToolRuntime({ instance, nodeTypes: [textIn], approval: 'auto', ...extra });
  return { instance, runtime };
}

const parse = (r: { content: Array<{ text: string }> }) =>
  JSON.parse(r.content[0].text) as Record<string, unknown>;

beforeEach(async () => {
  await resetSettings();
});
afterEach(async () => {
  await resetSettings();
});

describe('createToolRuntime', () => {
  it('runs an editor tool by bare verb and answers the stripped result', async () => {
    const { instance, runtime } = setup();
    const out = parse(await runtime.runTool('add_node', { nodeTypeId: 'text_input' }));
    expect(out.ok).toBe(true);
    expect(instance.workflow.current?.nodes).toHaveLength(1);
  });

  it('answers UNKNOWN_TOOL for a name it has not got, listing what it has', async () => {
    const { runtime } = setup();
    const res = await runtime.runTool('teleport', {});
    expect(res.isError).toBe(true);
    const out = parse(res);
    expect(out.code).toBe('UNKNOWN_TOOL');
    expect(String(out.error)).toContain('add_node');
  });

  it('answers UNKNOWN_TOOL for a host tool whose hook is missing', async () => {
    const { runtime } = setup();
    expect(parse(await runtime.runTool('save', {})).code).toBe('UNKNOWN_TOOL');
    expect(runtime.hostTools).toEqual([]);
  });

  it('runs save through the hook once it is present', async () => {
    const onSave = vi.fn(async () => undefined);
    const { runtime } = setup({ hooks: { onSave } });
    expect(runtime.hostTools.map((t) => t.verb)).toEqual(['save']);
    const out = parse(await runtime.runTool('save', {}));
    expect(out.ok).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('asks the gate for a mutating call and relays a rejection as REJECTED', async () => {
    const approval = vi.fn(async () => false);
    const { instance, runtime } = setup({ approval });
    const out = parse(await runtime.runTool('add_node', { nodeTypeId: 'text_input' }));
    expect(out.code).toBe('REJECTED');
    expect(approval).toHaveBeenCalledTimes(1);
    expect(instance.workflow.current?.nodes).toHaveLength(0);
    // A read never asks.
    parse(await runtime.runTool('list_nodes', {}));
    expect(approval).toHaveBeenCalledTimes(1);
  });

  it('preview says what a call would do without doing it', () => {
    const { instance, runtime } = setup({
      hooks: { onSave: async () => undefined },
      approval: 'confirm'
    });
    const single = runtime.preview('add_node', { nodeTypeId: 'text_input' });
    expect(single?.mutating).toBe(true);
    expect(single?.asks).toBe(true);
    expect(single?.commands.map((c) => c.type)).toEqual(['add_node']);
    expect(runtime.preview('list_nodes', {})?.mutating).toBe(false);
    expect(runtime.preview('list_nodes', {})?.asks).toBe(false);
    expect(runtime.preview('save', {})).toEqual({
      commands: [],
      skipped: [],
      mutating: true,
      consequential: true,
      asks: true
    });
    expect(runtime.preview('nope', {})).toBeNull();
    expect(runtime.preview('add_node', { bogus: 1 })).toBeNull();
    expect(instance.workflow.current?.nodes).toHaveLength(0);
  });

  it('preview reports what runTool will do: the layout opt-out and an auto policy', () => {
    const { runtime } = setup();
    // approval: 'auto' — a mutating call never waits on anyone.
    expect(runtime.preview('add_node', { nodeTypeId: 'text_input' })?.asks).toBe(false);

    updateSettings({ behavior: { chatAllowLayoutChanges: false } });
    const skipped = runtime.preview('beautify_layout', {});
    expect(skipped?.commands).toEqual([]);
    expect(skipped?.skipped.map((c) => c.type)).toEqual(['beautify_layout']);
    // Nothing left to gate, so it neither mutates nor asks.
    expect(skipped?.mutating).toBe(false);
    expect(skipped?.asks).toBe(false);

    const mixed = runtime.preview('batch', {
      commands: [{ type: 'beautify_layout' }, { type: 'add_node', nodeTypeId: 'text_input' }]
    });
    expect(mixed?.commands.map((c) => c.type)).toEqual(['add_node']);
    expect(mixed?.skipped).toHaveLength(1);
    expect(mixed?.mutating).toBe(true);
  });

  it('preview.asks goes false once the person pre-approved edits, never for save', () => {
    const request = vi.fn(async () => true);
    const gate = { request, busy: false, editsPreApproved: true, dispose: vi.fn() };
    const { runtime } = setup({ gate, hooks: { onSave: async () => undefined } });
    expect(runtime.preview('add_node', { nodeTypeId: 'text_input' })?.asks).toBe(false);
    expect(runtime.preview('save', {})?.asks).toBe(true);
  });

  it('passes its dialog title to the gate so a shared gate says who is asking', async () => {
    const request = vi.fn(async () => true);
    const gate = { request, busy: false, editsPreApproved: false, dispose: vi.fn() };
    const { runtime } = setup({
      gate,
      hooks: { onSave: async () => undefined },
      dialogTitle: (name) => `The assistant wants to change ${name}`
    });
    await runtime.runTool('add_node', { nodeTypeId: 'text_input' });
    await runtime.runTool('save', {});
    expect(request).toHaveBeenLastCalledWith([], {
      tool: 'save',
      title: 'The assistant wants to change Runtime'
    });
    expect(request.mock.calls[0][1]).toEqual({
      tool: 'add_node',
      title: 'The assistant wants to change Runtime'
    });
    // Without one, the request carries no title and the gate uses its own.
    const plain = vi.fn(async () => true);
    const { runtime: bare } = setup({ gate: { ...gate, request: plain } });
    await bare.runTool('add_node', { nodeTypeId: 'text_input' });
    expect(plain).toHaveBeenCalledWith(expect.anything(), { tool: 'add_node' });
  });

  it('answers DETACHED after dispose and disposes once', async () => {
    const { runtime } = setup();
    runtime.dispose();
    runtime.dispose();
    expect(runtime.disposed).toBe(true);
    expect(parse(await runtime.runTool('list_nodes', {})).code).toBe('DETACHED');
  });

  it('uses a supplied gate instead of making its own', async () => {
    const request = vi.fn(async () => true);
    const gate = {
      request,
      busy: false,
      editsPreApproved: false,
      dispose: vi.fn()
    };
    const { runtime } = setup({ gate });
    await runtime.runTool('add_node', { nodeTypeId: 'text_input' });
    expect(request).toHaveBeenCalledTimes(1);
    runtime.dispose();
    // Not ours to dispose.
    expect(gate.dispose).not.toHaveBeenCalled();
  });
});

describe('buildHostToolDescriptors', () => {
  it('run_status needs both onRun and onRunStatus', () => {
    const statusOnly = buildHostToolDescriptors({
      onRunStatus: async () => ({ ok: true, data: { runId: 'r', status: 'completed' } })
    });
    expect(statusOnly).toEqual([]);
    const both = buildHostToolDescriptors({
      onRun: async () => ({ ok: true, data: { runId: 'r' } }),
      onRunStatus: async () => ({ ok: true, data: { runId: 'r', status: 'completed' } })
    });
    expect(both.map((t) => [t.verb, t.readOnly, t.consequential])).toEqual([
      ['run', false, true],
      ['run_status', true, false]
    ]);
  });
});
