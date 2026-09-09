/**
 * WebMCP adapter — a bridge to a desktop MCP client for browsers without the
 * origin trial.
 *
 * Chrome's `document.modelContext` is the runtime the adapter was written for,
 * but it sits behind a flag and only Chrome's own agent consumes it. This
 * module presents the same {@link ModelContextLike} surface over a *widget*
 * that relays tools to a local MCP server — the shape of
 * `@jason.today/webmcp`'s page-side `WebMCP` class:
 * `registerTool(name, description, inputSchema, execute)`, with tool calls
 * arriving over its websocket and the returned value passed to the MCP client
 * as the tool result. The adapter's tools already return MCP-shaped
 * `{content: [{type: 'text', text}]}` results, so nothing is translated.
 *
 * Install it before the editor mounts:
 *
 * ```ts
 * import { installBridgedModelContext } from '@flowdrop/flowdrop/webmcp';
 * const widget = new WebMCP(); // the bridge's page-side script
 * installBridgedModelContext(widget); // no-op when a real runtime exists
 * ```
 *
 * The widget cannot unregister a tool. When the adapter aborts a
 * registration (editor destroyed), the relayed function keeps answering — with
 * a structured `UNAVAILABLE` error — until the page unloads. A re-registration
 * under the same name takes over again.
 *
 * The relay's MCP server answers a tool call with a timeout after 30 seconds.
 * A confirm dialog left open longer than that returns a timeout to the agent
 * while the dialog stays up; approving it then still applies the change. Hosts
 * that expect slow approvals should say so in the dialog copy or use a custom
 * `approval` callback.
 *
 * Nothing here decides *who* may reach the page: the bridge is localhost-only
 * and token-gated by design, and the adapter's confirm dialog and the
 * server's permissions still gate every mutation. Hosts should still make the
 * bridge an explicit opt-in rather than a default.
 *
 * @module webmcp/bridge
 */

import type {
  ModelContextLike,
  RegisteredToolDefinition,
  RegisterToolOptions,
  ToolInputSchema,
  ToolResult
} from './types.js';

/** The page-side widget surface the bridge relays to (`@jason.today/webmcp`). */
export interface WebMCPWidgetLike {
  registerTool(
    name: string,
    description: string,
    inputSchema: ToolInputSchema,
    execute: (args: unknown) => unknown
  ): unknown;
}

export interface BridgedModelContext extends ModelContextLike {
  /** Tools currently registered through the bridge, by name. */
  readonly tools: ReadonlyMap<string, RegisteredToolDefinition>;
}

function unavailable(name: string): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          ok: false,
          code: 'UNAVAILABLE',
          error: `Tool "${name}" is no longer registered; the editor that offered it was closed. Reload the page and try again.`
        })
      }
    ],
    isError: true
  };
}

/**
 * Wrap a bridge widget as a `modelContext`-shaped runtime.
 *
 * Each `registerTool` is relayed once per name; the relayed function looks the
 * tool up at call time so aborts and re-registrations are honoured without the
 * widget having to know about them.
 */
export function createBridgedModelContext(widget: WebMCPWidgetLike): BridgedModelContext {
  const tools = new Map<string, RegisteredToolDefinition>();
  const relayed = new Set<string>();

  return {
    tools,
    registerTool(tool: RegisteredToolDefinition, options?: RegisterToolOptions): Promise<void> {
      tools.set(tool.name, tool);
      options?.signal?.addEventListener(
        'abort',
        () => {
          if (tools.get(tool.name) === tool) tools.delete(tool.name);
        },
        { once: true }
      );
      if (!relayed.has(tool.name)) {
        relayed.add(tool.name);
        widget.registerTool(tool.name, tool.description, tool.inputSchema, (args: unknown) => {
          const live = tools.get(tool.name);
          if (!live) return unavailable(tool.name);
          return live.execute((args ?? {}) as Record<string, unknown>);
        });
      }
      return Promise.resolve();
    }
  };
}

/**
 * Install a bridged runtime as `document.modelContext` unless a runtime is
 * already present (Chrome's, or one installed earlier). Returns the runtime
 * in effect, or null outside a browser (or when `target` is null).
 */
export function installBridgedModelContext(
  widget: WebMCPWidgetLike,
  target: object | null = typeof document === 'undefined' ? null : document
): ModelContextLike | null {
  if (!target) return null;
  const host = target as { modelContext?: ModelContextLike };
  if (host.modelContext) return host.modelContext;
  const nav =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as { modelContext?: ModelContextLike });
  if (nav?.modelContext) return nav.modelContext;
  const bridged = createBridgedModelContext(widget);
  Object.defineProperty(target, 'modelContext', { value: bridged, configurable: true });
  return bridged;
}
