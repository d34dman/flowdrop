/**
 * Command Parser
 *
 * Parses DSL command strings into typed Command objects using
 * regex-based pattern matching with ordered rules (first match wins).
 *
 * @module commands/parser
 */

import type { Command, ParseResult } from './types.js';

// ============================================================================
// Parser Rules
// ============================================================================

type ParserRule = {
  pattern: RegExp;
  parse: (match: RegExpMatchArray) => Command;
};

/**
 * Count the `"""` delimiters in a string, ignoring escaped ones.
 *
 * `\"""` is the escape for a literal triple-quote inside a value (unescaped
 * when the value is parsed), so it is content, not a delimiter. Occurrences are
 * counted non-overlapping, left to right — an odd total means a value was left
 * open.
 *
 * Shared with the chat response parser, which uses the same parity rule to
 * decide where a multiline value ends.
 */
export function countTripleQuotes(input: string): number {
  let count = 0;
  let i = 0;
  while (i <= input.length - 3) {
    if (input.startsWith('"""', i)) {
      if (i === 0 || input[i - 1] !== '\\') {
        count++;
      }
      i += 3;
    } else {
      i++;
    }
  }
  return count;
}

/**
 * Parse a coordinate pair like "200,300" or "-50, 100"
 */
function parseCoords(x: string, y: string): { x: number; y: number } {
  return { x: Number(x), y: Number(y) };
}

const rules: ParserRule[] = [
  // add <type> at <x>,<y>
  {
    pattern: /^add\s+(\S+)\s+at\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/i,
    parse: (m) => ({
      type: 'add_node',
      nodeTypeId: m[1],
      position: parseCoords(m[2], m[3])
    })
  },
  // add <type>
  {
    pattern: /^add\s+(\S+)$/i,
    parse: (m) => ({
      type: 'add_node',
      nodeTypeId: m[1]
    })
  },
  // delete <nodeId>
  {
    pattern: /^delete\s+(\S+)$/i,
    parse: (m) => ({
      type: 'delete_node',
      nodeId: m[1]
    })
  },
  // rename <nodeId> <label...>
  {
    pattern: /^rename\s+(\S+)\s+(.+)$/i,
    parse: (m) => ({
      type: 'rename_node',
      nodeId: m[1],
      label: m[2].trim()
    })
  },
  // set <nodeId>:<key> """<multiline value>"""
  {
    pattern: /^set\s+(\S+?):(\S+)\s+"""([\s\S]*)"""$/,
    parse: (m) => ({
      type: 'set_config',
      nodeId: m[1],
      key: m[2],
      // trim one leading/trailing newline added by the textarea wrapper,
      // then unescape \""" → """ (escape sequence for literal triple-quotes in content)
      value: m[3].replace(/^\n|\n$/g, '').replace(/\\"""/g, '"""')
    })
  },
  // set <nodeId>:<key> <value...>
  {
    pattern: /^set\s+(\S+?):(\S+)\s+(.+)$/i,
    parse: (m) => ({
      type: 'set_config',
      nodeId: m[1],
      key: m[2],
      value: m[3]
    })
  },
  // get <nodeId>:<key>
  {
    pattern: /^get\s+(\S+?):(\S+)$/i,
    parse: (m) => ({
      type: 'get_config',
      nodeId: m[1],
      key: m[2]
    })
  },
  // get <nodeId> — every config value plus the schema
  {
    pattern: /^get\s+([^\s:]+)$/i,
    parse: (m) => ({
      type: 'get_config',
      nodeId: m[1]
    })
  },
  // info <nodeId>
  {
    pattern: /^info\s+(\S+)$/i,
    parse: (m) => ({
      type: 'info',
      nodeId: m[1]
    })
  },
  // config <nodeId>
  {
    pattern: /^config\s+(\S+)$/i,
    parse: (m) => ({
      type: 'config_open',
      nodeId: m[1]
    })
  },
  // select <nodeId>
  {
    pattern: /^select\s+(\S+)$/i,
    parse: (m) => ({
      type: 'select_node',
      nodeId: m[1]
    })
  },
  // connect <nid>:<port> to <nid>:<port>
  {
    pattern: /^connect\s+(\S+?):(\S+)\s+to\s+(\S+?):(\S+)$/i,
    parse: (m) => ({
      type: 'connect',
      sourceNodeId: m[1],
      sourcePort: m[2],
      targetNodeId: m[3],
      targetPort: m[4]
    })
  },
  // disconnect <nid>:<port> from <nid>:<port>
  {
    pattern: /^disconnect\s+(\S+?):(\S+)\s+from\s+(\S+?):(\S+)$/i,
    parse: (m) => ({
      type: 'disconnect_ports',
      sourceNodeId: m[1],
      sourcePort: m[2],
      targetNodeId: m[3],
      targetPort: m[4]
    })
  },
  // disconnect <nodeId> (disconnect all)
  {
    pattern: /^disconnect\s+(\S+)$/i,
    parse: (m) => ({
      type: 'disconnect_node',
      nodeId: m[1]
    })
  },
  // list nodes
  {
    pattern: /^list\s+nodes$/i,
    parse: () => ({ type: 'list_nodes' })
  },
  // list edges
  {
    pattern: /^list\s+edges$/i,
    parse: () => ({ type: 'list_edges' })
  },
  // list types
  {
    pattern: /^list\s+types$/i,
    parse: () => ({ type: 'list_types' })
  },
  // describe <type>
  {
    pattern: /^describe\s+(\S+)$/i,
    parse: (m) => ({ type: 'describe_type', nodeTypeId: m[1] })
  },
  // search <text...>
  {
    pattern: /^search\s+(.+)$/i,
    parse: (m) => ({ type: 'search_types', query: m[1].trim() })
  },
  // undo
  {
    pattern: /^undo$/i,
    parse: () => ({ type: 'undo' })
  },
  // redo
  {
    pattern: /^redo$/i,
    parse: () => ({ type: 'redo' })
  },
  // help <command>
  {
    pattern: /^help\s+(\S+)$/i,
    parse: (m) => ({
      type: 'help',
      command: m[1]
    })
  },
  // help
  {
    pattern: /^help$/i,
    parse: () => ({ type: 'help' })
  },
  // clear
  {
    pattern: /^clear$/i,
    parse: () => ({ type: 'clear' })
  },
  // swap <nodeId> with <type> (Phase 2)
  {
    pattern: /^swap\s+(\S+)\s+with\s+(\S+)$/i,
    parse: (m) => ({
      type: 'swap_node',
      nodeId: m[1],
      newTypeId: m[2]
    })
  },
  // move <nodeId> to <x>,<y> (Phase 2)
  {
    pattern: /^move\s+(\S+)\s+to\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/i,
    parse: (m) => ({
      type: 'move_node',
      nodeId: m[1],
      position: parseCoords(m[2], m[3])
    })
  },
  // layout auto [--direction horizontal|vertical] (Phase 2)
  {
    pattern: /^layout\s+auto\s+--direction\s+(horizontal|vertical)$/i,
    parse: (m) => ({
      type: 'auto_layout',
      direction: m[1].toLowerCase() as 'horizontal' | 'vertical'
    })
  },
  // layout auto (Phase 2)
  {
    pattern: /^layout\s+auto$/i,
    parse: () => ({ type: 'auto_layout' })
  },
  // layout beautify — preserve relative positions, normalize spacing
  {
    pattern: /^layout\s+beautify$/i,
    parse: () => ({ type: 'beautify_layout' })
  },
  // canvas fitview | canvas fit
  {
    pattern: /^canvas\s+fit(?:\s*view)?$/i,
    parse: () => ({ type: 'canvas_fit_view' })
  },
  // canvas zoom in
  {
    pattern: /^canvas\s+zoom\s+in$/i,
    parse: () => ({ type: 'canvas_zoom_in' })
  },
  // canvas zoom out
  {
    pattern: /^canvas\s+zoom\s+out$/i,
    parse: () => ({ type: 'canvas_zoom_out' })
  },
  // canvas zoom <level>
  {
    pattern: /^canvas\s+zoom\s+(\d+(?:\.\d+)?)$/i,
    parse: (m) => ({ type: 'canvas_zoom_to', level: Number(m[1]) })
  },
  // canvas pan <x>,<y>
  {
    pattern: /^canvas\s+pan\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/i,
    parse: (m) => ({
      type: 'canvas_pan_to',
      position: parseCoords(m[1], m[2])
    })
  },
  // canvas reset
  {
    pattern: /^canvas\s+reset$/i,
    parse: () => ({ type: 'canvas_reset_view' })
  }
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a command string into a typed Command object.
 *
 * Command verbs are case-insensitive; identifiers are case-sensitive.
 * Returns ParseResult with ok: true on success, ok: false on failure.
 */
export function parseCommand(input: string): ParseResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { ok: false, error: 'Empty command', input };
  }

  // Detect an unclosed multiline """ block — common when a low-quality LLM
  // omits the closing """. Delimiters come in pairs (escaped `\"""` excluded),
  // so an odd count means a value was left open, whether it was opened on its
  // own line or inline after the key. Surface a clear error instead of falling
  // through to a generic "Invalid syntax".
  if (countTripleQuotes(trimmed) % 2 === 1) {
    return {
      ok: false,
      error: 'Unclosed """ block — no matching closing """',
      input
    };
  }

  for (const rule of rules) {
    const match = trimmed.match(rule.pattern);
    if (match) {
      return { ok: true, command: rule.parse(match) };
    }
  }

  // Extract verb for better error message
  const verb = trimmed.split(/\s+/)[0].toLowerCase();
  const knownVerbs = [
    'add',
    'delete',
    'rename',
    'set',
    'get',
    'info',
    'config',
    'select',
    'connect',
    'disconnect',
    'list',
    'describe',
    'search',
    'undo',
    'redo',
    'help',
    'clear',
    'swap',
    'move',
    'layout',
    'canvas'
  ];

  if (knownVerbs.includes(verb)) {
    return { ok: false, error: `Invalid syntax for '${verb}' command`, input };
  }

  return { ok: false, error: `Unknown command: ${verb}`, input };
}
