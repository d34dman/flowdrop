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

  test('rejecting leaves the workflow untouched', async ({ page }) => {
    await startCall(page, 'flowdrop_delete_node', { nodeId: 'text_output.1' });
    await page.getByTestId('flowdrop-webmcp-reject').click();
    const out = await awaitResult(page);
    expect(out.ok).toBe(false);
    expect(out.code).toBe('REJECTED');
    await expectNodeCount(page, 2);
  });
});
