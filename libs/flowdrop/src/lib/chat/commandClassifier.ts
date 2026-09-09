/**
 * Command Classifier for LLM Chat Interface
 *
 * Determines whether a DSL command is read-only or mutating,
 * so the UI knows which commands can auto-execute and which
 * need user approval.
 *
 * @module chat/commandClassifier
 */

import type { Command } from '../commands/types.js';

/** Commands that only read workflow state without modifying it */
const READ_ONLY_COMMANDS = new Set([
  'list_nodes',
  'list_edges',
  'list_types',
  'describe_type',
  'search_types',
  'info',
  'get_config',
  'help'
]);

/**
 * Determine whether a DSL command type is mutating (modifies workflow state).
 *
 * Read-only commands (list_nodes, list_edges, list_types, describe_type,
 * search_types, info, get_config, help)
 * return false. All other commands are considered mutating and return true.
 *
 * @param commandType - The command type string (e.g., "add", "list_nodes")
 * @returns true if the command modifies workflow state, false if read-only
 */
export function isMutatingCommand(commandType: string): boolean {
  return !READ_ONLY_COMMANDS.has(commandType);
}

/**
 * Commands that rewrite the position of *existing* nodes.
 *
 * Viewport commands (`canvas fitview`, zoom, pan) are deliberately absent —
 * they only move the camera and leave the stored arrangement intact.
 */
const LAYOUT_COMMANDS = new Set(['auto_layout', 'beautify_layout']);

/**
 * Determine whether a DSL command type re-arranges existing node positions.
 *
 * Used by the AI panel to honour the `chatAllowLayoutChanges` behaviour setting:
 * when layout changes are disallowed, these commands are skipped instead of
 * executed so a hand-crafted layout survives an assistant batch (issue #36).
 *
 * @param commandType - The command type string (e.g., "beautify_layout")
 * @returns true if the command repositions existing nodes
 */
export function isLayoutCommand(commandType: string): boolean {
  return LAYOUT_COMMANDS.has(commandType);
}

/**
 * Commands that drive the editor's *view* — selection, the config panel, the
 * canvas viewport — and touch nothing in the workflow document.
 *
 * They are still mutating in {@link isMutatingCommand}'s sense (the chat panel
 * keeps them click-to-apply), but a consumer that gates on "can this alter the
 * user's document" can let them through: there is nothing to undo.
 */
export const VIEW_COMMAND_TYPES = [
  'select_node',
  'config_open',
  'canvas_fit_view',
  'canvas_zoom_in',
  'canvas_zoom_out',
  'canvas_zoom_to',
  'canvas_pan_to',
  'canvas_reset_view'
] as const satisfies readonly Command['type'][];

const VIEW_COMMANDS: ReadonlySet<string> = new Set(VIEW_COMMAND_TYPES);

/**
 * Determine whether a DSL command type only changes what the editor shows —
 * selection, an open panel, the viewport — and leaves the workflow itself as it was.
 *
 * @param commandType - The command type string (e.g., "canvas_zoom_in")
 * @returns true if the command changes the view and not the document
 */
export function isViewCommand(commandType: string): boolean {
  return VIEW_COMMANDS.has(commandType);
}
