/**
 * The turn driver against a scripted server and a stubbed `runTool`.
 *
 * The driver owns the loop shape: send → run each call in order → post the
 * results → until `done`. What a tool does is the runtime's business (see
 * webmcp/attach.test.ts); here every tool result is canned.
 */

import { describe, it, expect, vi } from 'vitest';
import { runTurn, parseOutcome, type TurnEvent } from '../../../src/lib/chat/turnDriver.js';
import type {
  ChatTurnRequest,
  ChatTurnResponse,
  ChatToolResultsRequest
} from '../../../src/lib/types/chat.js';
import type { ToolResult, ToolPreview } from '../../../src/lib/webmcp/types.js';

const request: ChatTurnRequest = {
  message: 'build it',
  workflowState: { nodes: [], edges: [] },
  tools: [{ name: 'batch', description: '', input_schema: {}, readOnly: false }]
};

const ok = (payload: Record<string, unknown> = {}): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ ok: true, ...payload }) }]
});
const err = (code: string, error = 'nope'): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ ok: false, code, error }) }],
  isError: true
});

/** A server that answers the scripted responses in order. */
function scriptedServer(responses: ChatTurnResponse[]) {
  const posted: ChatToolResultsRequest[] = [];
  let i = 0;
  const next = () => {
    const r = responses[i++];
    if (!r) throw new Error('script exhausted');
    return Promise.resolve(r);
  };
  return {
    posted,
    send: vi.fn(() => next()),
    sendToolResults: vi.fn((_turnId: string, body: ChatToolResultsRequest) => {
      posted.push(body);
      return next();
    })
  };
}

describe('runTurn', () => {
  it('returns legacy when the first response has no turnId, without touching tools', async () => {
    const server = scriptedServer([{ content: 'Here is a ```flowdrop block' }]);
    const runTool = vi.fn();
    const out = await runTurn(request, { ...server, runTool });
    expect(out).toEqual({ kind: 'legacy', content: 'Here is a ```flowdrop block' });
    expect(runTool).not.toHaveBeenCalled();
    expect(server.sendToolResults).not.toHaveBeenCalled();
  });

  it('finishes at once when the server answers text with done', async () => {
    const server = scriptedServer([{ turnId: 't1', content: 'Hello', done: true }]);
    const out = await runTurn(request, { ...server, runTool: vi.fn() });
    expect(out).toEqual({ kind: 'final', content: 'Hello', rounds: 0, turnId: 't1' });
  });

  it('runs each call in order, posts the results with their ids, and loops until done', async () => {
    const server = scriptedServer([
      {
        turnId: 't1',
        done: false,
        toolCalls: [
          { id: 'c1', name: 'describe_type', args: { nodeTypeId: 'http_request' } },
          { id: 'c2', name: 'search_types', args: { query: 'markdown' } }
        ]
      },
      {
        turnId: 't1',
        done: false,
        toolCalls: [{ id: 'c3', name: 'batch', args: { commands: [] } }]
      },
      { turnId: 't1', content: 'Built.', done: true }
    ]);
    const order: string[] = [];
    const runTool = vi.fn(async (name: string) => {
      order.push(name);
      return ok({ message: `${name} done` });
    });

    const out = await runTurn(request, { ...server, runTool });

    expect(order).toEqual(['describe_type', 'search_types', 'batch']);
    expect(server.posted).toHaveLength(2);
    expect(server.posted[0].results.map((r) => r.toolCallId)).toEqual(['c1', 'c2']);
    expect(JSON.parse(server.posted[0].results[0].content)).toEqual({
      ok: true,
      message: 'describe_type done'
    });
    expect(server.posted[0].results[0].isError).toBeUndefined();
    expect(server.sendToolResults).toHaveBeenCalledWith('t1', expect.anything());
    expect(out).toEqual({ kind: 'final', content: 'Built.', rounds: 2, turnId: 't1' });
  });

  it('a rejected call is a result, not an end: the loop continues and the model reads REJECTED', async () => {
    const server = scriptedServer([
      {
        turnId: 't1',
        done: false,
        toolCalls: [{ id: 'c1', name: 'batch', args: {} }]
      },
      { turnId: 't1', content: 'Understood, I will not change it.', done: true }
    ]);
    const events: TurnEvent[] = [];
    const out = await runTurn(request, {
      ...server,
      runTool: async () => err('REJECTED', 'The user rejected the change'),
      preview: (): ToolPreview => ({
        commands: [],
        skipped: [],
        mutating: true,
        consequential: false,
        asks: true
      }),
      onEvent: (e) => events.push(e)
    });

    expect(out.kind).toBe('final');
    const posted = server.posted[0].results[0];
    expect(posted.isError).toBe(true);
    expect(JSON.parse(posted.content).code).toBe('REJECTED');
    expect(events.map((e) => e.type)).toEqual([
      'awaiting-approval',
      'rejected',
      'round-complete',
      'final'
    ]);
  });

  it('emits reading for a read call and failed for any other error, with the outcome', async () => {
    const server = scriptedServer([
      {
        turnId: 't1',
        done: false,
        toolCalls: [
          { id: 'c1', name: 'list_nodes', args: {} },
          { id: 'c2', name: 'add_node', args: { nodeTypeId: 'nope' } }
        ]
      },
      { turnId: 't1', content: 'done', done: true }
    ]);
    const events: TurnEvent[] = [];
    await runTurn(request, {
      ...server,
      runTool: async (name) =>
        name === 'list_nodes' ? ok({ data: { nodes: [] } }) : err('NOT_FOUND', 'no such type'),
      preview: (name): ToolPreview => ({
        commands: [],
        skipped: [],
        mutating: name !== 'list_nodes',
        consequential: false,
        asks: name !== 'list_nodes'
      }),
      onEvent: (e) => events.push(e)
    });
    expect(events.map((e) => e.type)).toEqual([
      'reading',
      'applied',
      'awaiting-approval',
      'failed',
      'round-complete',
      'final'
    ]);
    const failed = events.find((e) => e.type === 'failed');
    expect(failed && 'outcome' in failed ? failed.outcome : null).toEqual({
      ok: false,
      code: 'NOT_FOUND',
      error: 'no such type'
    });
  });

  it('a call to an unknown tool still produces a result the server receives', async () => {
    const server = scriptedServer([
      { turnId: 't1', done: false, toolCalls: [{ id: 'c1', name: 'teleport', args: {} }] },
      { turnId: 't1', content: 'ok', done: true }
    ]);
    await runTurn(request, {
      ...server,
      runTool: async () => err('UNKNOWN_TOOL', 'No tool named "teleport"')
    });
    expect(JSON.parse(server.posted[0].results[0].content).code).toBe('UNKNOWN_TOOL');
  });

  it('stops itself past maxRounds when the server never finishes', async () => {
    const forever: ChatTurnResponse = {
      turnId: 't1',
      done: false,
      toolCalls: [{ id: 'c', name: 'list_nodes', args: {} }]
    };
    const server = scriptedServer(Array.from({ length: 10 }, () => forever));
    const out = await runTurn(request, { ...server, runTool: async () => ok(), maxRounds: 3 });
    expect(out.kind).toBe('aborted');
    expect(out.kind === 'aborted' && out.rounds).toBe(3);
    expect(server.sendToolResults).toHaveBeenCalledTimes(3);
  });

  it('names a continued turn with no tool calls as a protocol error, not an empty reply', async () => {
    const server = scriptedServer([
      { turnId: 't1', done: false, toolCalls: [{ id: 'c', name: 'list_nodes', args: {} }] },
      { turnId: 't1', done: false, toolCalls: [] }
    ]);
    const events: TurnEvent[] = [];
    const out = await runTurn(request, {
      ...server,
      runTool: async () => ok(),
      onEvent: (e) => events.push(e)
    });
    expect(out.kind).toBe('aborted');
    expect(out.kind === 'aborted' && out.rounds).toBe(1);
    expect(out.kind === 'aborted' && out.reason).toMatch(/without any tool calls/);
    expect(events.some((e) => e.type === 'final')).toBe(false);
  });

  it('announces awaiting-approval from the preview, not from a guess', async () => {
    const server = scriptedServer([
      {
        turnId: 't1',
        done: false,
        toolCalls: [
          { id: 'a', name: 'add_node', args: {} },
          { id: 'b', name: 'beautify_layout', args: {} }
        ]
      },
      { turnId: 't1', done: true, content: 'done' }
    ]);
    // Edits pre-approved: a mutating call no longer asks. A layout call with
    // the opt-out on maps to nothing and asks nobody either.
    const previews: Record<string, ToolPreview> = {
      add_node: { commands: [], skipped: [], mutating: true, consequential: false, asks: false },
      beautify_layout: {
        commands: [],
        skipped: [],
        mutating: false,
        consequential: false,
        asks: false
      }
    };
    const events: TurnEvent[] = [];
    await runTurn(request, {
      ...server,
      runTool: async () => ok(),
      preview: (name) => previews[name] ?? null,
      onEvent: (e) => events.push(e)
    });
    expect(events.filter((e) => e.type === 'awaiting-approval')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'reading')).toHaveLength(2);
  });

  it('rejects when a request fails, so the panel shows the error', async () => {
    const send = vi.fn(async () => {
      throw new Error('HTTP 500');
    });
    await expect(
      runTurn(request, { send, sendToolResults: vi.fn(), runTool: vi.fn() })
    ).rejects.toThrow('HTTP 500');
  });
});

describe('parseOutcome', () => {
  it('reads ok, code, message and error from the runtime payload', () => {
    expect(parseOutcome(ok({ message: 'Added' }))).toEqual({ ok: true, message: 'Added' });
    expect(parseOutcome(err('BUSY', 'waiting'))).toEqual({
      ok: false,
      code: 'BUSY',
      error: 'waiting'
    });
  });

  it('treats non-JSON text as an opaque result whose isError decides', () => {
    expect(parseOutcome({ content: [{ type: 'text', text: 'plain' }] })).toEqual({ ok: true });
    expect(parseOutcome({ content: [{ type: 'text', text: 'plain' }], isError: true })).toEqual({
      ok: false
    });
  });
});
