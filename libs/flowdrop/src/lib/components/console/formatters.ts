/**
 * Pure formatting functions for rich command result display.
 * Converts CommandResult data into aligned table strings for console output.
 */
import type {
  ListNodesResultData,
  ListEdgesResultData,
  ListTypesResultData,
  SearchTypesResultData,
  DescribeTypeResultData,
  InfoResultData,
  HelpResultData
} from '../../commands/types.js';

/**
 * Pads a string to a given width (right-padded with spaces).
 */
function pad(str: string, width: number): string {
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

/**
 * Formats a simple table from rows with headers.
 * Each column is auto-sized to fit the widest value.
 */
function formatTable(headers: string[], rows: string[][]): string {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))
  );

  const headerLine = headers.map((h, i) => pad(h, colWidths[i])).join('  ');
  const separator = colWidths.map((w) => '-'.repeat(w)).join('  ');
  const dataLines = rows.map((row) => row.map((cell, i) => pad(cell, colWidths[i])).join('  '));

  return [headerLine, separator, ...dataLines].join('\n');
}

/**
 * Formats list nodes result as an aligned table: ID, Label, Type.
 */
export function formatListNodes(data: ListNodesResultData): string {
  if (data.nodes.length === 0) {
    return 'No nodes in workflow';
  }

  const rows = data.nodes.map((n) => [n.nodeId, n.label, n.type]);
  return formatTable(['ID', 'Label', 'Type'], rows);
}

/**
 * Formats list edges result as a table: Source, Port, ->, Target, Port.
 */
export function formatListEdges(data: ListEdgesResultData): string {
  if (data.edges.length === 0) {
    return 'No edges in workflow';
  }

  const rows = data.edges.map((e) => [
    e.sourceNodeId,
    e.sourcePort,
    '->',
    e.targetNodeId,
    e.targetPort
  ]);
  return formatTable(['Source', 'Port', '', 'Target', 'Port'], rows);
}

/**
 * Formats list types result as a table: Type ID, Name, Category.
 */
export function formatListTypes(data: ListTypesResultData): string {
  if (data.types.length === 0) {
    return 'No node types available';
  }

  const rows = data.types.map((t) => [t.typeId, t.name, t.category]);
  return formatTable(['Type ID', 'Name', 'Category'], rows);
}

/**
 * Formats search types result: the same table as list types, or a hint.
 */
export function formatSearchTypes(data: SearchTypesResultData): string {
  if (data.types.length === 0) {
    return `No node type matches "${data.query}"`;
  }
  return formatListTypes({ types: data.types });
}

/**
 * Formats describe type result: header, ports and config schema sections.
 */
export function formatDescribeType(data: DescribeTypeResultData): string {
  const lines: string[] = [];
  lines.push(`Type:        ${data.typeId}`);
  lines.push(`Name:        ${data.name}`);
  lines.push(`Category:    ${data.category}`);
  if (data.description) lines.push(`Description: ${data.description}`);
  if (data.tags && data.tags.length > 0) lines.push(`Tags:        ${data.tags.join(', ')}`);
  if (data.confirmation) lines.push(`Confirmation: ${data.confirmation.policy}`);

  lines.push('');
  lines.push('Inputs:');
  if (data.inputs.length === 0) lines.push('  (none)');
  for (const p of data.inputs) {
    lines.push(
      `  ${p.portId} (${p.dataType})${p.required ? ' required' : ''}${p.description ? ` — ${p.description}` : ''}`
    );
  }

  lines.push('');
  lines.push('Outputs:');
  if (data.outputs.length === 0) lines.push('  (none)');
  for (const p of data.outputs) {
    lines.push(`  ${p.portId} (${p.dataType})${p.description ? ` — ${p.description}` : ''}`);
  }

  lines.push('');
  lines.push('Config:');
  if (data.config.length === 0) lines.push('  (none)');
  for (const c of data.config) {
    const type = Array.isArray(c.type) ? c.type.join('|') : (c.type ?? 'any');
    const parts = [`  ${c.key} (${type})`];
    if (c.required) parts.push('required');
    if (c.enum) parts.push(`one of ${c.enum.map((v) => JSON.stringify(v)).join(', ')}`);
    if (c.default !== undefined) parts.push(`default ${JSON.stringify(c.default)}`);
    lines.push(parts.join(' ') + (c.description ? ` — ${c.description}` : ''));
  }

  return lines.join('\n');
}

/**
 * Formats info result as structured output with header fields,
 * config section, ports section, and edges section.
 */
export function formatInfo(data: InfoResultData): string {
  const lines: string[] = [];

  // Header fields
  lines.push(`Node:     ${data.nodeId}`);
  lines.push(`Label:    ${data.label}`);
  lines.push(`Type:     ${data.type}`);
  lines.push(`Position: (${Math.round(data.position.x)}, ${Math.round(data.position.y)})`);

  // Config section
  const configEntries = Object.entries(data.config);
  if (configEntries.length > 0) {
    lines.push('');
    lines.push('Config:');
    for (const [key, value] of configEntries) {
      const display = typeof value === 'string' ? `"${value}"` : (JSON.stringify(value) ?? 'null');
      lines.push(`  ${key}: ${display}`);
    }
  }

  // Ports section
  if (data.inputs.length > 0 || data.outputs.length > 0) {
    lines.push('');
    lines.push('Ports:');
    if (data.inputs.length > 0) {
      lines.push('  Inputs:');
      for (const port of data.inputs) {
        lines.push(`    ${port.portId} (${port.dataType})`);
      }
    }
    if (data.outputs.length > 0) {
      lines.push('  Outputs:');
      for (const port of data.outputs) {
        lines.push(`    ${port.portId} (${port.dataType})`);
      }
    }
  }

  // Connected edges section
  if (data.connectedEdges.length > 0) {
    lines.push('');
    lines.push('Edges:');
    for (const edge of data.connectedEdges) {
      if (edge.direction === 'incoming') {
        lines.push(`  ${edge.remoteNodeId}:${edge.remotePort} -> ${edge.localPort}`);
      } else {
        lines.push(`  ${edge.localPort} -> ${edge.remoteNodeId}:${edge.remotePort}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Formats help result as a table: Name, Syntax, Description.
 */
export function formatHelp(data: HelpResultData): string {
  if (data.commands.length === 0) {
    return 'No commands available';
  }

  const rows = data.commands.map((c) => [c.name, c.syntax, c.description]);
  return formatTable(['Name', 'Syntax', 'Description'], rows);
}
