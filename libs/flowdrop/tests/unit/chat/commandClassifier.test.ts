import { describe, it, expect } from 'vitest';
import { isMutatingCommand, isLayoutCommand } from '../../../src/lib/chat/commandClassifier.js';
import { parseCommand } from '../../../src/lib/commands/parser.js';

describe('isMutatingCommand', () => {
  describe('read-only commands return false', () => {
    it.each([
      'list_nodes',
      'list_edges',
      'list_types',
      'describe_type',
      'search_types',
      'info',
      'get_config',
      'help'
    ])('%s is read-only', (commandType) => {
      expect(isMutatingCommand(commandType)).toBe(false);
    });
  });

  describe('mutating commands return true', () => {
    it.each([
      'add',
      'remove',
      'connect',
      'disconnect',
      'set_config',
      'layout',
      'rename',
      'move',
      'swap'
    ])('%s is mutating', (commandType) => {
      expect(isMutatingCommand(commandType)).toBe(true);
    });
  });

  it('treats unknown commands as mutating', () => {
    expect(isMutatingCommand('unknown_command')).toBe(true);
  });
});

describe('isLayoutCommand', () => {
  it.each(['auto_layout', 'beautify_layout'])('%s re-positions nodes', (commandType) => {
    expect(isLayoutCommand(commandType)).toBe(true);
  });

  // Viewport commands only move the camera — they must stay runnable even when
  // AI layout changes are disabled (issue #36).
  it.each(['canvas_action', 'add_node', 'move_node', 'set_config', 'unknown_command'])(
    '%s is not a layout command',
    (commandType) => {
      expect(isLayoutCommand(commandType)).toBe(false);
    }
  );

  it('matches the parsed command types for the layout DSL commands', () => {
    for (const input of ['layout beautify', 'layout auto', 'layout auto --direction vertical']) {
      const parsed = parseCommand(input);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(isLayoutCommand(parsed.command.type)).toBe(true);
    }

    // `canvas fitview` must NOT be classified as a layout change.
    const fitview = parseCommand('canvas fitview');
    expect(fitview.ok).toBe(true);
    if (!fitview.ok) return;
    expect(isLayoutCommand(fitview.command.type)).toBe(false);
  });
});
