/**
 * E2E Test: WebMCP editor tools
 *
 * A fake `document.modelContext` is installed before the page loads (the way
 * Chrome's origin trial would provide the real one). The page attaches the
 * editor tools; the test plays the browser agent: it invokes
 * `flowdrop_add_node`, approves the change in the in-page dialog, checks the
 * node exists, then undoes through the tool and checks it is gone.
 *
 * Run with: pnpm exec playwright test tests/e2e/webmcp.spec.ts --project=chromium --reporter=line
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __webmcp: {
      tools: Record<string, { readOnly: boolean }>;
      pending: Promise<string> | null;
      call(name: string, input: unknown): void;
    };
  }
}

/** Installed via addInitScript — runs before any page script. */
function installFakeModelContext(): void {
  const registry = new Map<
    string,
    {
      annotations?: { readOnlyHint?: boolean };
      execute(input: unknown): Promise<{ content: Array<{ text: string }> }>;
    }
  >();
  const api = {
    registerTool(
      tool: {
        name: string;
        annotations?: { readOnlyHint?: boolean };
        execute(input: unknown): Promise<{ content: Array<{ text: string }> }>;
      },
      options?: { signal?: AbortSignal }
    ) {
      registry.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => registry.delete(tool.name));
      return Promise.resolve();
    }
  };
  Object.defineProperty(document, 'modelContext', { value: api, configurable: true });
  window.__webmcp = {
    get tools() {
      const out: Record<string, { readOnly: boolean }> = {};
      registry.forEach((t, name) => (out[name] = { readOnly: !!t.annotations?.readOnlyHint }));
      return out;
    },
    pending: null,
    call(name: string, input: unknown) {
      const tool = registry.get(name);
      if (!tool) throw new Error(`no tool ${name}`);
      window.__webmcp.pending = tool.execute(input).then((r) => r.content[0].text);
    }
  };
}

async function expectNodeCount(page: Page, expected: number): Promise<void> {
  await expect(page.locator('.flowdrop-status-bar')).toContainText(`${expected} nodes`, {
    timeout: 5000
  });
}

/** Start a tool call; resolve it later with `awaitResult`. */
async function startCall(page: Page, name: string, input: unknown): Promise<void> {
  await page.evaluate(([n, i]) => window.__webmcp.call(n as string, i), [name, input]);
}

async function awaitResult(page: Page): Promise<Record<string, unknown>> {
  const text = await page.evaluate(() => window.__webmcp.pending!);
  return JSON.parse(text);
}

test.describe('WebMCP editor tools', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'Mobile Chrome', 'Editor requires desktop-width viewport');
    await page.addInitScript(installFakeModelContext);
    await page.goto('/test/webmcp');
    await page.waitForSelector('[data-testid="webmcp-test"][data-webmcp="attached"]', {
      timeout: 15000
    });
    await page.waitForSelector('.svelte-flow__node', { timeout: 15000 });
  });

  test('registers the tools with read-only hints', async ({ page }) => {
    const tools = await page.evaluate(() => window.__webmcp.tools);
    expect(Object.keys(tools)).toContain('flowdrop_add_node');
    expect(Object.keys(tools)).toContain('flowdrop_batch');
    expect(Object.keys(tools)).not.toContain('flowdrop_clear');
    expect(tools.flowdrop_list_nodes.readOnly).toBe(true);
    expect(tools.flowdrop_add_node.readOnly).toBe(false);
  });

  test('a read tool answers without a dialog', async ({ page }) => {
    await startCall(page, 'flowdrop_list_nodes', {});
    const out = await awaitResult(page);
    expect(out.ok).toBe(true);
    expect((out.data as { nodes: unknown[] }).nodes).toHaveLength(2);
    await expect(page.getByTestId('flowdrop-webmcp-confirm')).toHaveCount(0);
  });

  test('add_node waits for approval, applies, and one undo removes it', async ({ page }) => {
    await expectNodeCount(page, 2);

    await startCall(page, 'flowdrop_add_node', { nodeTypeId: 'text_input' });
    const dialog = page.getByTestId('flowdrop-webmcp-confirm');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('WebMCP E2E');
    await expect(dialog).toContainText('Add node text_input');

    // Nothing changed while the dialog is open.
    await expectNodeCount(page, 2);

    await page.getByTestId('flowdrop-webmcp-approve').click();
    const added = await awaitResult(page);
    expect(added.ok).toBe(true);
    expect((added.data as { nodeId: string }).nodeId).toBe('text_input.2');
    await expectNodeCount(page, 3);
    await expect(dialog).toHaveCount(0);

    // Undo is a mutation too: it asks, then reverts the whole tool call.
    await startCall(page, 'flowdrop_undo', {});
    await expect(page.getByTestId('flowdrop-webmcp-confirm')).toContainText('Undo');
    await page.getByTestId('flowdrop-webmcp-approve').click();
    const undone = await awaitResult(page);
    expect(undone.ok).toBe(true);
    await expectNodeCount(page, 2);
  });

  test('save asks, then runs the host save once', async ({ page }) => {
    const tools = await page.evaluate(() => window.__webmcp.tools);
    expect(tools.flowdrop_save.readOnly).toBe(false);

    await startCall(page, 'flowdrop_save', {});
    const dialog = page.getByTestId('flowdrop-webmcp-confirm');
    await expect(dialog).toContainText('Save “WebMCP E2E” to the server');
    await expect(dialog).toContainText('cannot be undone');
    await expect(page.getByTestId('webmcp-test')).toHaveAttribute('data-saves', '0');

    await page.getByTestId('flowdrop-webmcp-approve').click();
    const out = await awaitResult(page);
    expect(out.ok).toBe(true);
    await expect(page.getByTestId('webmcp-test')).toHaveAttribute('data-saves', '1');

    // A rejected save does not touch the host.
    await startCall(page, 'flowdrop_save', {});
    await page.getByTestId('flowdrop-webmcp-reject').click();
    const rejected = await awaitResult(page);
    expect(rejected.code).toBe('REJECTED');
    await expect(page.getByTestId('webmcp-test')).toHaveAttribute('data-saves', '1');
  });

  test('describe → batch → save → run → run_status, one approval per consequential step', async ({
    page
  }) => {
    // Read before you write: describe_type answers ports and schema, no dialog.
    await startCall(page, 'flowdrop_describe_type', { nodeTypeId: 'text_input' });
    const described = await awaitResult(page);
    expect(described.ok).toBe(true);
    const data = described.data as {
      outputs: Array<{ portId: string }>;
      config: Array<{ key: string; type: string }>;
    };
    expect(data.outputs.map((p) => p.portId)).toEqual(['value']);
    expect(data.config).toEqual([
      { key: 'defaultValue', type: 'string', title: 'Default Value', default: '' }
    ]);
    await expect(page.getByTestId('flowdrop-webmcp-confirm')).toHaveCount(0);

    // One batch, one dialog, with a summary of what changes.
    await startCall(page, 'flowdrop_batch', {
      commands: [
        { type: 'add_node', nodeTypeId: 'text_input' },
        { type: 'set_config', nodeId: 'text_input.2', key: 'defaultValue', value: 'hi' }
      ]
    });
    const dialog = page.getByTestId('flowdrop-webmcp-confirm');
    await expect(dialog).toContainText('2 changes — adds 1 node, sets 1 config key.');
    await expect(page.getByTestId('flowdrop-webmcp-remember')).toBeVisible();
    await page.getByTestId('flowdrop-webmcp-approve').click();
    expect((await awaitResult(page)).ok).toBe(true);
    await expectNodeCount(page, 3);

    // Save asks (and does not offer "don't ask again").
    await startCall(page, 'flowdrop_save', {});
    await expect(dialog).toContainText('Save “WebMCP E2E” to the server');
    await expect(page.getByTestId('flowdrop-webmcp-remember')).toHaveCount(0);
    await page.getByTestId('flowdrop-webmcp-approve').click();
    expect((await awaitResult(page)).ok).toBe(true);
    await expect(page.getByTestId('webmcp-test')).toHaveAttribute('data-saves', '1');

    // Run asks too, then hands back a run id.
    await startCall(page, 'flowdrop_run', { inputs: { greeting: 'hi' } });
    await expect(dialog).toContainText('Run “WebMCP E2E” on the server');
    await page.getByTestId('flowdrop-webmcp-approve').click();
    const started = await awaitResult(page);
    expect(started.ok).toBe(true);
    expect((started.data as { runId: string }).runId).toBe('run-1');
    await expect(page.getByTestId('webmcp-test')).toHaveAttribute('data-runs', '1');

    // run_status is a read: a paused run is PENDING with the node and message …
    await startCall(page, 'flowdrop_run_status', { runId: 'run-1' });
    const paused = await awaitResult(page);
    expect(paused.ok).toBe(true);
    expect(paused.code).toBe('PENDING');
    expect(String(paused.message)).toContain('text_output.1');
    expect(String(paused.message)).toContain('Approve?');
    await expect(page.getByTestId('flowdrop-webmcp-confirm')).toHaveCount(0);

    // … and a completed run carries its outputs.
    await startCall(page, 'flowdrop_run_status', { runId: 'run-1' });
    const done = await awaitResult(page);
    expect(done.code).toBeUndefined();
    expect((done.data as { status: string; outputs: unknown }).status).toBe('completed');
    expect((done.data as { outputs: unknown }).outputs).toEqual({ text: 'hello' });
  });

  test('"apply further edits" skips later edit dialogs, never the save dialog', async ({
    page
  }) => {
    await startCall(page, 'flowdrop_add_node', { nodeTypeId: 'text_input' });
    await page.getByTestId('flowdrop-webmcp-remember').check();
    await page.getByTestId('flowdrop-webmcp-approve').click();
    expect((await awaitResult(page)).ok).toBe(true);
    await expectNodeCount(page, 3);

    await startCall(page, 'flowdrop_add_node', { nodeTypeId: 'text_output' });
    expect((await awaitResult(page)).ok).toBe(true);
    await expectNodeCount(page, 4);
    await expect(page.getByTestId('flowdrop-webmcp-confirm')).toHaveCount(0);

    await startCall(page, 'flowdrop_save', {});
    await expect(page.getByTestId('flowdrop-webmcp-confirm')).toBeVisible();
    await page.getByTestId('flowdrop-webmcp-reject').click();
    expect((await awaitResult(page)).code).toBe('REJECTED');
  });

  test('rejecting leaves the workflow untouched', async ({ page }) => {
    await startCall(page, 'flowdrop_delete_node', { nodeId: 'text_output.1' });
    await page.getByTestId('flowdrop-webmcp-reject').click();
    const out = await awaitResult(page);
    expect(out.ok).toBe(false);
    expect(out.code).toBe('REJECTED');
    await expectNodeCount(page, 2);
  });
});
