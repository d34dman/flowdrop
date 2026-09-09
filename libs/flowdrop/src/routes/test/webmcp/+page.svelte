<!--
  WebMCP E2E Test Page

  Mounts the FlowDrop App with a two-node workflow and attaches the WebMCP
  editor tools with the default confirm gate. The Playwright spec installs a
  fake `document.modelContext` via addInitScript *before* this page runs, so
  `attachWebMCP` finds it exactly as it would find Chrome's.

  Used by: tests/e2e/webmcp.spec.ts
-->

<script lang="ts">
  import { onMount } from 'svelte';
  import App from '$lib/components/App.svelte';
  import { createFlowDropInstance } from '$lib/stores/instanceContainer.svelte.js';
  import { attachWebMCP } from '$lib/webmcp/index.js';
  import type { NodeMetadata, Workflow } from '$lib/types/index.js';

  const nodeTypes: NodeMetadata[] = [
    {
      node_type_id: 'text_input',
      name: 'Text Input',
      description: 'Accept text input from user',
      category: 'inputs',
      version: '1.0.0',
      type: 'default',
      icon: 'mdi:text-box',
      color: '#3b82f6',
      inputs: [],
      outputs: [{ id: 'value', name: 'Value', type: 'output', dataType: 'string' }],
      configSchema: {
        type: 'object',
        properties: { defaultValue: { type: 'string', title: 'Default Value', default: '' } }
      }
    },
    {
      node_type_id: 'text_output',
      name: 'Text Output',
      description: 'Display text output',
      category: 'outputs',
      version: '1.0.0',
      type: 'default',
      icon: 'mdi:text-box-check',
      color: '#10b981',
      inputs: [{ id: 'text', name: 'Text', type: 'input', dataType: 'string' }],
      outputs: [],
      configSchema: { type: 'object', properties: {} }
    }
  ];

  const workflow: Workflow = {
    id: 'webmcp-e2e',
    name: 'WebMCP E2E',
    nodes: [
      {
        id: 'text_input.1',
        type: 'default',
        position: { x: 100, y: 100 },
        data: { label: 'Text Input', config: {}, metadata: nodeTypes[0] }
      },
      {
        id: 'text_output.1',
        type: 'default',
        position: { x: 400, y: 100 },
        data: { label: 'Text Output', config: {}, metadata: nodeTypes[1] }
      }
    ],
    edges: [
      {
        id: 'e1',
        source: 'text_input.1',
        sourceHandle: 'value',
        target: 'text_output.1',
        targetHandle: 'text'
      }
    ],
    metadata: {
      schemaVersion: '1.0.0',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    }
  };

  const fd = createFlowDropInstance({ id: 'webmcp-e2e' });
  fd.workflow.initialize(workflow);

  let attached = $state<'pending' | 'attached' | 'no-runtime'>('pending');
  // The page has no server; `save` counts calls so the spec can see the
  // gate → onSave chain end to end.
  let saves = $state(0);

  onMount(() => {
    const handle = attachWebMCP(fd, {
      nodeTypes,
      onSave: async () => {
        saves += 1;
      }
    });
    attached = handle ? 'attached' : 'no-runtime';
    return () => handle?.detach();
  });
</script>

<div data-testid="webmcp-test" data-webmcp={attached} data-saves={saves} style="height: 100vh;">
  <App instance={fd} nodes={nodeTypes} {workflow} height="100%" />
</div>
