/**
 * WebMCP bridge — the modelContext-shaped relay onto a `@jason.today/webmcp`
 * style widget (`registerTool(name, description, schema, fn)`).
 */

import { describe, it, expect } from 'vitest';
import {
  createBridgedModelContext,
  installBridgedModelContext
} from '../../../src/lib/webmcp/bridge.js';
import type { WebMCPWidgetLike } from '../../../src/lib/webmcp/bridge.js';
import type { RegisteredToolDefinition, ToolResult } from '../../../src/lib/webmcp/types.js';

type Relayed = {
  name: string;
  description: string;
  schema: object;
  fn: (args: unknown) => unknown;
};

function widget(): WebMCPWidgetLike & { relayed: Relayed[] } {
  const relayed: Relayed[] = [];
  return {
    relayed,
    registerTool(name, description, schema, fn) {
      relayed.push({ name, description, schema, fn });
    }
  };
}

const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] });

function tool(name: string, reply = 'ok'): RegisteredToolDefinition {
  return {
    name,
    description: `does ${name}`,
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async (input) => text(`${reply}:${JSON.stringify(input)}`)
  };
}

describe('createBridgedModelContext', () => {
  it('relays name, description and schema, and forwards calls with their args', async () => {
    const w = widget();
    const ctx = createBridgedModelContext(w);
    await ctx.registerTool(tool('flowdrop_list_nodes'));

    expect(w.relayed).toHaveLength(1);
    expect(w.relayed[0].name).toBe('flowdrop_list_nodes');
    expect(w.relayed[0].description).toBe('does flowdrop_list_nodes');
    expect(w.relayed[0].schema).toEqual({ type: 'object', properties: {} });

    const result = (await w.relayed[0].fn({ a: 1 })) as ToolResult;
    expect(result.content[0].text).toBe('ok:{"a":1}');
  });

  it('passes an empty object when the bridge sends no arguments', async () => {
    const w = widget();
    const ctx = createBridgedModelContext(w);
    await ctx.registerTool(tool('t'));
    const result = (await w.relayed[0].fn(undefined)) as ToolResult;
    expect(result.content[0].text).toBe('ok:{}');
  });

  it('answers UNAVAILABLE after the registration is aborted, and relays only once per name', async () => {
    const w = widget();
    const ctx = createBridgedModelContext(w);
    const ac = new AbortController();
    await ctx.registerTool(tool('t', 'first'), { signal: ac.signal });
    ac.abort();
    expect(ctx.tools.has('t')).toBe(false);

    const gone = (await w.relayed[0].fn({})) as ToolResult;
    expect(gone.isError).toBe(true);
    expect(JSON.parse(gone.content[0].text)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });

    await ctx.registerTool(tool('t', 'second'));
    expect(w.relayed).toHaveLength(1);
    const back = (await w.relayed[0].fn({})) as ToolResult;
    expect(back.content[0].text).toBe('second:{}');
  });

  it('an abort of a stale registration does not remove a newer one under the same name', async () => {
    const w = widget();
    const ctx = createBridgedModelContext(w);
    const ac = new AbortController();
    await ctx.registerTool(tool('t', 'old'), { signal: ac.signal });
    await ctx.registerTool(tool('t', 'new'));
    ac.abort();
    expect(ctx.tools.has('t')).toBe(true);
    const result = (await w.relayed[0].fn({})) as ToolResult;
    expect(result.content[0].text).toBe('new:{}');
  });
});

describe('installBridgedModelContext', () => {
  it('installs on the target when no runtime exists, and keeps an existing one', () => {
    const w = widget();
    const target: { modelContext?: unknown } = {};
    const installed = installBridgedModelContext(w, target);
    expect(target.modelContext).toBe(installed);

    const existing = { registerTool: () => undefined };
    const target2 = { modelContext: existing };
    expect(installBridgedModelContext(w, target2)).toBe(existing);
    expect(target2.modelContext).toBe(existing);
  });

  it('returns null outside a browser', () => {
    expect(installBridgedModelContext(widget(), null)).toBeNull();
  });
});
