/**
 * Chat — the tool catalogue the panel sends to the server.
 *
 * fdnpm owns the tool catalogue (D2 of the chat tool-loop plan): the editor's
 * tool descriptors are the single source, and the server holds no copy of
 * their schemas. This module projects a tool runtime's descriptors — editor
 * tools and the host tools its hooks make available — into the shape a
 * function-calling reasoner takes: `{name, description, input_schema}`, plus
 * the read-only flag the server may use to order or summarise calls.
 *
 * Names are the bare verbs (`describe_type`, `batch`, `save`). The WebMCP
 * prefix belongs to the page's tool namespace, not to a conversation.
 *
 * @module chat/toolCatalogue
 */

import type { HostToolDescriptor, ToolDescriptor, ToolRuntime } from '../webmcp/types.js';
import type { ChatToolDefinition } from '../types/chat.js';

/** What the projection needs from a runtime: its two descriptor lists. */
export type ToolCatalogueSource = Pick<ToolRuntime, 'descriptors' | 'hostTools'>;

function project(d: ToolDescriptor | HostToolDescriptor): ChatToolDefinition {
  return {
    name: d.verb,
    description: d.description,
    input_schema: d.inputSchema as unknown as Record<string, unknown>,
    readOnly: d.readOnly
  };
}

/**
 * Project a runtime's tools into chat tool definitions, editor tools first,
 * then the host tools present for the runtime's hooks (the same set the
 * WebMCP registration would register).
 */
export function toToolDefinitions(source: ToolCatalogueSource): ChatToolDefinition[] {
  return [...source.descriptors.map(project), ...source.hostTools.map(project)];
}

/** Serialized size of a catalogue in bytes, as it travels on the wire. */
export function catalogueBytes(tools: ChatToolDefinition[]): number {
  return new TextEncoder().encode(JSON.stringify(tools)).length;
}
