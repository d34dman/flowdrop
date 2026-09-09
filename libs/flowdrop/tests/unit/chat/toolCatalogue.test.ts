/**
 * The tool catalogue the chat panel sends to the server (D2 of the chat
 * tool-loop plan): projected from the runtime's descriptors, bare verbs,
 * host tools only for the hooks that exist, and small enough to travel with
 * every first request of a turn.
 */

import { describe, it, expect } from 'vitest';
import { createFlowDropInstance } from '../../../src/lib/stores/instanceContainer.svelte.js';
import { createToolRuntime } from '../../../src/lib/webmcp/runtime.js';
import { toToolDefinitions, catalogueBytes } from '../../../src/lib/chat/toolCatalogue.js';
import { buildToolDescriptors } from '../../../src/lib/webmcp/descriptors.js';
import type { Workflow } from '../../../src/lib/types/index.js';

function workflow(): Workflow {
  return {
    id: 'wf-1',
    name: 'Catalogue',
    nodes: [],
    edges: [],
    metadata: { schemaVersion: '1.0.0', createdAt: '', updatedAt: '' }
  };
}

function runtimeWith(hooks: Parameters<typeof createToolRuntime>[0]['hooks'], view = false) {
  const instance = createFlowDropInstance({ id: `cat-${Math.random().toString(36).slice(2)}` });
  instance.workflow.initialize(workflow());
  return createToolRuntime({
    instance,
    nodeTypes: [],
    approval: 'auto',
    hooks,
    ...(view ? { onUIAction: () => undefined } : {})
  });
}

describe('toToolDefinitions', () => {
  it('projects every editor descriptor to {name, description, input_schema, readOnly} with bare verbs', () => {
    const rt = runtimeWith({});
    const defs = toToolDefinitions(rt);
    const descriptors = buildToolDescriptors({ view: false });

    expect(defs.map((d) => d.name)).toEqual(descriptors.map((d) => d.verb));
    for (const def of defs) {
      expect(def.name).not.toMatch(/^flowdrop_/);
      expect(Object.keys(def).sort()).toEqual(['description', 'input_schema', 'name', 'readOnly']);
      expect(def.input_schema).toMatchObject({ type: 'object', additionalProperties: false });
    }
    const describe = defs.find((d) => d.name === 'describe_type');
    expect(describe?.readOnly).toBe(true);
    expect(defs.find((d) => d.name === 'batch')?.readOnly).toBe(false);
  });

  it('adds host tools only for the hooks present, after the editor tools', () => {
    const none = toToolDefinitions(runtimeWith({})).map((d) => d.name);
    expect(none).not.toContain('save');
    expect(none).not.toContain('run');

    const saveOnly = toToolDefinitions(runtimeWith({ onSave: async () => undefined })).map(
      (d) => d.name
    );
    expect(saveOnly.slice(-1)).toEqual(['save']);

    const all = toToolDefinitions(
      runtimeWith({
        onSave: async () => undefined,
        onRun: async () => ({ ok: true, data: { runId: 'r' } }),
        onRunStatus: async () => ({ ok: true, data: { runId: 'r', status: 'completed' } })
      })
    );
    expect(all.slice(-3).map((d) => d.name)).toEqual(['save', 'run', 'run_status']);
    expect(all.find((d) => d.name === 'run_status')?.readOnly).toBe(true);
    expect(all.find((d) => d.name === 'run')?.description).toContain('run_status');
  });

  it('includes view only when a UI handler exists, mirroring registration', () => {
    expect(toToolDefinitions(runtimeWith({})).map((d) => d.name)).not.toContain('view');
    expect(toToolDefinitions(runtimeWith({}, true)).map((d) => d.name)).toContain('view');
  });

  it('is a stable shape (snapshot of names and read-only flags)', () => {
    const defs = toToolDefinitions(
      runtimeWith(
        {
          onSave: async () => undefined,
          onRun: async () => ({ ok: true, data: { runId: 'r' } }),
          onRunStatus: async () => ({ ok: true, data: { runId: 'r', status: 'completed' } })
        },
        true
      )
    );
    expect(defs.map((d) => `${d.name}${d.readOnly ? ' (ro)' : ''}`)).toMatchInlineSnapshot(`
      [
        "add_node",
        "delete_node",
        "rename_node",
        "move_node",
        "swap_node",
        "set_config",
        "get_config (ro)",
        "connect",
        "disconnect_ports",
        "disconnect_node",
        "list_nodes (ro)",
        "list_edges (ro)",
        "list_types (ro)",
        "describe_type (ro)",
        "search_types (ro)",
        "info (ro)",
        "undo",
        "redo",
        "auto_layout",
        "beautify_layout",
        "view",
        "batch",
        "save",
        "run",
        "run_status (ro)",
      ]
    `);
  });

  it('serializes small enough to travel with every turn (10–20 kB expected)', () => {
    const defs = toToolDefinitions(
      runtimeWith(
        {
          onSave: async () => undefined,
          onRun: async () => ({ ok: true, data: { runId: 'r' } }),
          onRunStatus: async () => ({ ok: true, data: { runId: 'r', status: 'completed' } })
        },
        true
      )
    );
    const bytes = catalogueBytes(defs);
    // Recorded 2026-09-09; a jump past 24 kB means a schema grew and the plan's
    // "hash it client-side" fallback (§5) is due.
    expect(bytes).toBeGreaterThan(8_000);
    expect(bytes).toBeLessThan(24_000);
    expect(JSON.parse(JSON.stringify(defs))).toEqual(defs);
  });
});
