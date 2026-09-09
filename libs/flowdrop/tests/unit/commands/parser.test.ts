import { describe, it, expect } from 'vitest';
import { parseCommand } from '../../../src/lib/commands/parser.js';

describe('parseCommand', () => {
  // ==========================================================================
  // add_node
  // ==========================================================================
  describe('add', () => {
    it('parses add <type>', () => {
      const result = parseCommand('add llm_node');
      expect(result).toEqual({
        ok: true,
        command: { type: 'add_node', nodeTypeId: 'llm_node' }
      });
    });

    it('parses add <type> at <x>,<y>', () => {
      const result = parseCommand('add llm_node at 200,300');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'add_node',
          nodeTypeId: 'llm_node',
          position: { x: 200, y: 300 }
        }
      });
    });

    it('parses add with negative coordinates', () => {
      const result = parseCommand('add llm_node at -50,-100');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'add_node',
          nodeTypeId: 'llm_node',
          position: { x: -50, y: -100 }
        }
      });
    });

    it('parses add with spaces around comma in coords', () => {
      const result = parseCommand('add llm_node at 200 , 300');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'add_node',
          nodeTypeId: 'llm_node',
          position: { x: 200, y: 300 }
        }
      });
    });

    it('parses add with decimal coordinates', () => {
      const result = parseCommand('add llm_node at 200.5,300.7');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'add_node',
          nodeTypeId: 'llm_node',
          position: { x: 200.5, y: 300.7 }
        }
      });
    });

    it('is case-insensitive for verb', () => {
      expect(parseCommand('ADD llm_node')).toEqual({
        ok: true,
        command: { type: 'add_node', nodeTypeId: 'llm_node' }
      });
      expect(parseCommand('Add llm_node')).toEqual({
        ok: true,
        command: { type: 'add_node', nodeTypeId: 'llm_node' }
      });
    });

    it('preserves case of identifiers', () => {
      const result = parseCommand('add LLM_Node');
      expect(result).toEqual({
        ok: true,
        command: { type: 'add_node', nodeTypeId: 'LLM_Node' }
      });
    });

    it('returns error for add with no type', () => {
      const result = parseCommand('add');
      expect(result).toEqual({
        ok: false,
        error: "Invalid syntax for 'add' command",
        input: 'add'
      });
    });
  });

  // ==========================================================================
  // delete_node
  // ==========================================================================
  describe('delete', () => {
    it('parses delete <nodeId>', () => {
      const result = parseCommand('delete llm_node.1');
      expect(result).toEqual({
        ok: true,
        command: { type: 'delete_node', nodeId: 'llm_node.1' }
      });
    });

    it('is case-insensitive for verb', () => {
      const result = parseCommand('DELETE llm_node.1');
      expect(result).toEqual({
        ok: true,
        command: { type: 'delete_node', nodeId: 'llm_node.1' }
      });
    });
  });

  // ==========================================================================
  // rename_node
  // ==========================================================================
  describe('rename', () => {
    it('parses rename <nodeId> <label>', () => {
      const result = parseCommand('rename llm_node.1 My Node');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'rename_node',
          nodeId: 'llm_node.1',
          label: 'My Node'
        }
      });
    });

    it('parses rename with single-word label', () => {
      const result = parseCommand('rename llm_node.1 ChatBot');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'rename_node',
          nodeId: 'llm_node.1',
          label: 'ChatBot'
        }
      });
    });

    it('parses rename with multi-word label', () => {
      const result = parseCommand('rename llm_node.1 My Awesome Chat Bot');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'rename_node',
          nodeId: 'llm_node.1',
          label: 'My Awesome Chat Bot'
        }
      });
    });
  });

  // ==========================================================================
  // set_config
  // ==========================================================================
  describe('set', () => {
    it('parses set <nodeId>:<key> <value>', () => {
      const result = parseCommand('set llm_node.1:model gpt-4');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'set_config',
          nodeId: 'llm_node.1',
          key: 'model',
          value: 'gpt-4'
        }
      });
    });

    it('parses set with value containing spaces', () => {
      const result = parseCommand('set llm_node.1:system_prompt You are a helpful assistant');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'set_config',
          nodeId: 'llm_node.1',
          key: 'system_prompt',
          value: 'You are a helpful assistant'
        }
      });
    });

    it('parses set with quoted value', () => {
      const result = parseCommand('set llm_node.1:name "42"');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'set_config',
          nodeId: 'llm_node.1',
          key: 'name',
          value: '"42"'
        }
      });
    });

    it('parses set with numeric value', () => {
      const result = parseCommand('set llm_node.1:temperature 0.7');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'set_config',
          nodeId: 'llm_node.1',
          key: 'temperature',
          value: '0.7'
        }
      });
    });

    it('returns error for set with missing value', () => {
      const result = parseCommand('set llm_node.1:model');
      expect(result).toEqual({
        ok: false,
        error: "Invalid syntax for 'set' command",
        input: 'set llm_node.1:model'
      });
    });

    // -------------------------------------------------------------------------
    // triple-quote multiline values
    // -------------------------------------------------------------------------
    describe('triple-quote multiline values', () => {
      it('parses a multiline triple-quote value', () => {
        const input = 'set llm_node.1:system_prompt """\nYou are helpful.\nAnswer concisely.\n"""';
        expect(parseCommand(input)).toEqual({
          ok: true,
          command: {
            type: 'set_config',
            nodeId: 'llm_node.1',
            key: 'system_prompt',
            value: 'You are helpful.\nAnswer concisely.'
          }
        });
      });

      it('trims exactly one leading and one trailing newline', () => {
        // Extra leading/trailing newlines beyond the first are preserved
        const input = 'set note.1:content """\n\nTwo leading newlines.\n\n"""';
        expect(parseCommand(input)).toEqual({
          ok: true,
          command: {
            type: 'set_config',
            nodeId: 'note.1',
            key: 'content',
            value: '\nTwo leading newlines.\n'
          }
        });
      });

      it('parses a triple-quote value containing embedded triple-quotes in content', () => {
        const input = 'set note.1:content """\nUse Python """docstrings""" for docs.\n"""';
        expect(parseCommand(input)).toEqual({
          ok: true,
          command: {
            type: 'set_config',
            nodeId: 'note.1',
            key: 'content',
            value: 'Use Python """docstrings""" for docs.'
          }
        });
      });

      it('unescapes \\""" to """ in the value', () => {
        const input = 'set note.1:content """\nThe delimiter is \\""" in DSL.\n"""';
        expect(parseCommand(input)).toEqual({
          ok: true,
          command: {
            type: 'set_config',
            nodeId: 'note.1',
            key: 'content',
            value: 'The delimiter is """ in DSL.'
          }
        });
      });

      it('parses an empty triple-quote value (inline)', () => {
        expect(parseCommand('set note.1:content """"""')).toEqual({
          ok: true,
          command: {
            type: 'set_config',
            nodeId: 'note.1',
            key: 'content',
            value: ''
          }
        });
      });

      it('parses a value whose """ delimiters sit inline with the content', () => {
        // How LLMs actually write it — no newline after the opener, closer at
        // the end of the last content line (issue #35).
        const input = 'set template.1:template """{{prefix}}\n\n{{summary}}"""';
        expect(parseCommand(input)).toEqual({
          ok: true,
          command: {
            type: 'set_config',
            nodeId: 'template.1',
            key: 'template',
            value: '{{prefix}}\n\n{{summary}}'
          }
        });
      });

      it('returns a clear error when an inline """ value is never closed', () => {
        const input = 'set template.1:template """{{prefix}}\n\n{{summary}}';
        expect(parseCommand(input)).toEqual({
          ok: false,
          error: 'Unclosed """ block — no matching closing """',
          input
        });
      });

      it('returns a clear error when """ block is opened but never closed', () => {
        // responseParser surfaces dangling multiline buffers as commands so
        // that the parser can flag them here instead of failing silently.
        const input = 'set llm_node.1:system_prompt """\nThis value is never closed';
        const result = parseCommand(input);
        expect(result).toEqual({
          ok: false,
          error: 'Unclosed """ block — no matching closing """',
          input
        });
      });
    });
  });

  // ==========================================================================
  // get_config
  // ==========================================================================
  describe('get', () => {
    it('parses get <nodeId>:<key>', () => {
      const result = parseCommand('get llm_node.1:model');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'get_config',
          nodeId: 'llm_node.1',
          key: 'model'
        }
      });
    });

    it('get without a key reads every value plus the schema', () => {
      const result = parseCommand('get llm_node.1');
      expect(result).toEqual({
        ok: true,
        command: { type: 'get_config', nodeId: 'llm_node.1' }
      });
    });

    it('a trailing colon with no key is still a syntax error', () => {
      const result = parseCommand('get llm_node.1:');
      expect(result).toEqual({
        ok: false,
        error: "Invalid syntax for 'get' command",
        input: 'get llm_node.1:'
      });
    });
  });

  // ==========================================================================
  // describe / search
  // ==========================================================================

  describe('describe and search', () => {
    it('parses describe <type>', () => {
      expect(parseCommand('describe http_request')).toEqual({
        ok: true,
        command: { type: 'describe_type', nodeTypeId: 'http_request' }
      });
    });

    it('parses search <text> with spaces', () => {
      expect(parseCommand('search html to markdown')).toEqual({
        ok: true,
        command: { type: 'search_types', query: 'html to markdown' }
      });
    });

    it('describe without a type is a syntax error, not an unknown command', () => {
      expect(parseCommand('describe')).toEqual({
        ok: false,
        error: "Invalid syntax for 'describe' command",
        input: 'describe'
      });
    });
  });

  // ==========================================================================
  // info
  // ==========================================================================
  describe('info', () => {
    it('parses info <nodeId>', () => {
      const result = parseCommand('info llm_node.1');
      expect(result).toEqual({
        ok: true,
        command: { type: 'info', nodeId: 'llm_node.1' }
      });
    });
  });

  // ==========================================================================
  // config_open
  // ==========================================================================
  describe('config', () => {
    it('parses config <nodeId>', () => {
      const result = parseCommand('config llm_node.1');
      expect(result).toEqual({
        ok: true,
        command: { type: 'config_open', nodeId: 'llm_node.1' }
      });
    });
  });

  // ==========================================================================
  // select_node
  // ==========================================================================
  describe('select', () => {
    it('parses select <nodeId>', () => {
      const result = parseCommand('select llm_node.1');
      expect(result).toEqual({
        ok: true,
        command: { type: 'select_node', nodeId: 'llm_node.1' }
      });
    });
  });

  // ==========================================================================
  // connect
  // ==========================================================================
  describe('connect', () => {
    it('parses connect <nid>:<port> to <nid>:<port>', () => {
      const result = parseCommand('connect llm_node.1:llm_output to api_node.1:body');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'connect',
          sourceNodeId: 'llm_node.1',
          sourcePort: 'llm_output',
          targetNodeId: 'api_node.1',
          targetPort: 'body'
        }
      });
    });

    it('is case-insensitive for verb', () => {
      const result = parseCommand('CONNECT llm_node.1:out to api_node.1:in');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'connect',
          sourceNodeId: 'llm_node.1',
          sourcePort: 'out',
          targetNodeId: 'api_node.1',
          targetPort: 'in'
        }
      });
    });

    it('preserves case of identifiers', () => {
      const result = parseCommand('connect LLM_Node.1:Output to API_Node.1:Input');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'connect',
          sourceNodeId: 'LLM_Node.1',
          sourcePort: 'Output',
          targetNodeId: 'API_Node.1',
          targetPort: 'Input'
        }
      });
    });

    it('returns error for connect with missing target', () => {
      const result = parseCommand('connect llm_node.1:out');
      expect(result).toEqual({
        ok: false,
        error: "Invalid syntax for 'connect' command",
        input: 'connect llm_node.1:out'
      });
    });

    it('returns error for connect without port specification', () => {
      const result = parseCommand('connect llm_node.1 to api_node.1');
      expect(result).toEqual({
        ok: false,
        error: "Invalid syntax for 'connect' command",
        input: 'connect llm_node.1 to api_node.1'
      });
    });
  });

  // ==========================================================================
  // disconnect_ports
  // ==========================================================================
  describe('disconnect (port-specific)', () => {
    it('parses disconnect <nid>:<port> from <nid>:<port>', () => {
      const result = parseCommand('disconnect llm_node.1:llm_output from api_node.1:body');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'disconnect_ports',
          sourceNodeId: 'llm_node.1',
          sourcePort: 'llm_output',
          targetNodeId: 'api_node.1',
          targetPort: 'body'
        }
      });
    });

    it('is case-insensitive for verb', () => {
      const result = parseCommand('DISCONNECT llm_node.1:out from api_node.1:in');
      expect(result).toEqual({
        ok: true,
        command: {
          type: 'disconnect_ports',
          sourceNodeId: 'llm_node.1',
          sourcePort: 'out',
          targetNodeId: 'api_node.1',
          targetPort: 'in'
        }
      });
    });
  });

  // ==========================================================================
  // disconnect_node
  // ==========================================================================
  describe('disconnect (all edges)', () => {
    it('parses disconnect <nodeId>', () => {
      const result = parseCommand('disconnect llm_node.1');
      expect(result).toEqual({
        ok: true,
        command: { type: 'disconnect_node', nodeId: 'llm_node.1' }
      });
    });

    it('is case-insensitive for verb', () => {
      const result = parseCommand('DISCONNECT api_node.2');
      expect(result).toEqual({
        ok: true,
        command: { type: 'disconnect_node', nodeId: 'api_node.2' }
      });
    });
  });

  // ==========================================================================
  // list_nodes
  // ==========================================================================
  describe('list nodes', () => {
    it('parses list nodes', () => {
      const result = parseCommand('list nodes');
      expect(result).toEqual({
        ok: true,
        command: { type: 'list_nodes' }
      });
    });

    it('is case-insensitive', () => {
      expect(parseCommand('LIST NODES')).toEqual({
        ok: true,
        command: { type: 'list_nodes' }
      });
      expect(parseCommand('List Nodes')).toEqual({
        ok: true,
        command: { type: 'list_nodes' }
      });
    });
  });

  // ==========================================================================
  // list_edges
  // ==========================================================================
  describe('list edges', () => {
    it('parses list edges', () => {
      const result = parseCommand('list edges');
      expect(result).toEqual({
        ok: true,
        command: { type: 'list_edges' }
      });
    });

    it('is case-insensitive', () => {
      expect(parseCommand('LIST EDGES')).toEqual({
        ok: true,
        command: { type: 'list_edges' }
      });
    });
  });

  // ==========================================================================
  // list_types
  // ==========================================================================
  describe('list types', () => {
    it('parses list types', () => {
      const result = parseCommand('list types');
      expect(result).toEqual({
        ok: true,
        command: { type: 'list_types' }
      });
    });

    it('is case-insensitive', () => {
      expect(parseCommand('LIST TYPES')).toEqual({
        ok: true,
        command: { type: 'list_types' }
      });
    });

    it('returns error for list with unknown subcommand', () => {
      const result = parseCommand('list connections');
      expect(result).toEqual({
        ok: false,
        error: "Invalid syntax for 'list' command",
        input: 'list connections'
      });
    });
  });

  // ==========================================================================
  // undo
  // ==========================================================================
  describe('undo', () => {
    it('parses undo', () => {
      expect(parseCommand('undo')).toEqual({
        ok: true,
        command: { type: 'undo' }
      });
    });

    it('is case-insensitive', () => {
      expect(parseCommand('UNDO')).toEqual({
        ok: true,
        command: { type: 'undo' }
      });
    });
  });

  // ==========================================================================
  // redo
  // ==========================================================================
  describe('redo', () => {
    it('parses redo', () => {
      expect(parseCommand('redo')).toEqual({
        ok: true,
        command: { type: 'redo' }
      });
    });

    it('is case-insensitive', () => {
      expect(parseCommand('REDO')).toEqual({
        ok: true,
        command: { type: 'redo' }
      });
    });
  });

  // ==========================================================================
  // help
  // ==========================================================================
  describe('help', () => {
    it('parses help with no args', () => {
      expect(parseCommand('help')).toEqual({
        ok: true,
        command: { type: 'help' }
      });
    });

    it('parses help <command>', () => {
      expect(parseCommand('help connect')).toEqual({
        ok: true,
        command: { type: 'help', command: 'connect' }
      });
    });

    it('parses help with different commands', () => {
      expect(parseCommand('help add')).toEqual({
        ok: true,
        command: { type: 'help', command: 'add' }
      });
      expect(parseCommand('help delete')).toEqual({
        ok: true,
        command: { type: 'help', command: 'delete' }
      });
    });

    it('is case-insensitive for verb', () => {
      expect(parseCommand('HELP')).toEqual({
        ok: true,
        command: { type: 'help' }
      });
      expect(parseCommand('HELP connect')).toEqual({
        ok: true,
        command: { type: 'help', command: 'connect' }
      });
    });
  });

  // ==========================================================================
  // clear
  // ==========================================================================
  describe('clear', () => {
    it('parses clear', () => {
      expect(parseCommand('clear')).toEqual({
        ok: true,
        command: { type: 'clear' }
      });
    });

    it('is case-insensitive', () => {
      expect(parseCommand('CLEAR')).toEqual({
        ok: true,
        command: { type: 'clear' }
      });
    });
  });

  // ==========================================================================
  // Error cases
  // ==========================================================================
  describe('error handling', () => {
    it('returns error for empty input', () => {
      const result = parseCommand('');
      expect(result).toEqual({
        ok: false,
        error: 'Empty command',
        input: ''
      });
    });

    it('returns error for whitespace-only input', () => {
      const result = parseCommand('   ');
      expect(result).toEqual({
        ok: false,
        error: 'Empty command',
        input: '   '
      });
    });

    it('returns error for unknown command', () => {
      const result = parseCommand('fly llm_node.1');
      expect(result).toEqual({
        ok: false,
        error: 'Unknown command: fly',
        input: 'fly llm_node.1'
      });
    });

    it('returns error for malformed known command', () => {
      const result = parseCommand('delete');
      expect(result).toEqual({
        ok: false,
        error: "Invalid syntax for 'delete' command",
        input: 'delete'
      });
    });

    it('trims leading/trailing whitespace before parsing', () => {
      const result = parseCommand('  add llm_node  ');
      expect(result).toEqual({
        ok: true,
        command: { type: 'add_node', nodeTypeId: 'llm_node' }
      });
    });
  });
});
