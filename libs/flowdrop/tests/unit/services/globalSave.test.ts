/**
 * Unit Tests - Global Save Service
 *
 * Tests for the globalSaveWorkflow() function, focusing on correct routing
 * between saveWorkflow (POST/create) and updateWorkflow (PUT) based on whether
 * the workflow already has a backend-assigned id.
 *
 * In 2.0 globalSave persists through the instance's API client (fd.api.client)
 * — the legacy module workflowApi path was removed. The create-vs-update
 * decision still hinges on id presence, not the id's format.
 *
 * Regression coverage for: UUID Workflow ID Bug (issue #26)
 * Previously a UUID regex was used to detect new workflows, which caused
 * backends that use UUIDs as primary keys to always POST instead of PUT.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { globalSaveWorkflow } from '$lib/services/globalSave.js';
import { createTestWorkflow } from '../../utils/index.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// vi.mock factories are hoisted to the top of the file, so variables they
// reference must be initialised with vi.hoisted() to be available in time.
const {
  mockGetWorkflowStore,
  mockWorkflowActionsBatchUpdate,
  mockStoreMarkAsSaved,
  mockClientSave,
  mockClientUpdate,
  mockApiIsConfigured,
  mockApiConfigure,
  mockStoreAcknowledgeServer
} = vi.hoisted(() => ({
  mockGetWorkflowStore: vi.fn(),
  mockWorkflowActionsBatchUpdate: vi.fn(),
  mockStoreMarkAsSaved: vi.fn(),
  mockClientSave: vi.fn(),
  mockClientUpdate: vi.fn(),
  mockApiIsConfigured: vi.fn(),
  mockApiConfigure: vi.fn(),
  mockStoreAcknowledgeServer: vi.fn()
}));

// globalSave resolves its target via getDefaultInstance(). Mock the instance
// container so the fake workflow store's `current` getter reads from
// mockGetWorkflowStore, mutations route to the mock fns, and the API context
// exposes a client whose save/update route to mockClientSave/mockClientUpdate.
vi.mock('$lib/stores/instanceContainer.svelte.js', () => ({
  getDefaultInstance: () => ({
    workflow: {
      get current() {
        return mockGetWorkflowStore();
      },
      batchUpdate: (...args: unknown[]) => mockWorkflowActionsBatchUpdate(...args),
      markAsSaved: (...args: unknown[]) => mockStoreMarkAsSaved(...args),
      acknowledgeServer: (...args: unknown[]) => mockStoreAcknowledgeServer(...args)
    },
    api: {
      isConfigured: (...args: unknown[]) => mockApiIsConfigured(...args),
      get config() {
        return { baseUrl: '/api/flowdrop' };
      },
      configure: (...args: unknown[]) => mockApiConfigure(...args),
      get client() {
        return {
          saveWorkflow: (...args: unknown[]) => mockClientSave(...args),
          updateWorkflow: (...args: unknown[]) => mockClientUpdate(...args)
        };
      }
    }
  })
}));

vi.mock('$lib/services/toastService.js', () => ({
  apiToasts: { loading: vi.fn(() => 'toast-id'), error: vi.fn() },
  workflowToasts: { saved: vi.fn() },
  dismissToast: vi.fn()
}));

vi.mock('$lib/config/endpoints.js', () => ({
  createEndpointConfig: vi.fn(() => ({ baseUrl: '/api/flowdrop' }))
}));

vi.mock('svelte', () => ({
  tick: () => Promise.resolve()
}));

const FIXED_UUID = 'aaaabbbb-cccc-dddd-eeee-ffffaaaabbbb';
vi.mock('uuid', () => ({ v4: () => FIXED_UUID }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a workflow with the given id (use '' or undefined for new) */
function storeWorkflow(id: string) {
  return createTestWorkflow({ id });
}

/** Saved workflow returned by the backend */
function backendWorkflow(id: string) {
  return createTestWorkflow({ id });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('globalSaveWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Simulate a configured API context so ensureApiConfiguration exits early.
    mockApiIsConfigured.mockReturnValue(true);
  });

  // -------------------------------------------------------------------------
  // create vs update routing (id-presence decides — never UUID-regex)
  // -------------------------------------------------------------------------

  describe('create vs update routing', () => {
    it('calls client.saveWorkflow when workflow has no id (new workflow)', async () => {
      const workflow = storeWorkflow('');
      mockGetWorkflowStore.mockReturnValue(workflow);
      mockClientSave.mockResolvedValue(backendWorkflow('server-assigned-id'));

      await globalSaveWorkflow({});

      expect(mockClientSave).toHaveBeenCalledTimes(1);
      expect(mockClientUpdate).not.toHaveBeenCalled();

      // The new workflow is sent with the client-generated uuid fallback as its id.
      const [postedWorkflow] = mockClientSave.mock.calls[0];
      expect(postedWorkflow.id).toBe(FIXED_UUID);
    });

    it('calls client.updateWorkflow when workflow has a non-UUID id (existing workflow)', async () => {
      const workflow = storeWorkflow('123');
      mockGetWorkflowStore.mockReturnValue(workflow);
      mockClientUpdate.mockResolvedValue(backendWorkflow('123'));

      await globalSaveWorkflow({});

      expect(mockClientUpdate).toHaveBeenCalledTimes(1);
      expect(mockClientUpdate).toHaveBeenCalledWith('123', expect.objectContaining({ id: '123' }));
      expect(mockClientSave).not.toHaveBeenCalled();
    });

    it('calls client.updateWorkflow when workflow has a UUID id (regression: issue #26)', async () => {
      const uuidId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
      const workflow = storeWorkflow(uuidId);
      mockGetWorkflowStore.mockReturnValue(workflow);
      mockClientUpdate.mockResolvedValue(backendWorkflow(uuidId));

      await globalSaveWorkflow({});

      expect(mockClientUpdate).toHaveBeenCalledTimes(1);
      expect(mockClientUpdate).toHaveBeenCalledWith(
        uuidId,
        expect.objectContaining({ id: uuidId })
      );
      expect(mockClientSave).not.toHaveBeenCalled();
    });

    it('calls client.updateWorkflow when workflow has a slug id', async () => {
      mockGetWorkflowStore.mockReturnValue(storeWorkflow('slug-workflow'));
      mockClientUpdate.mockResolvedValue(backendWorkflow('slug-workflow'));

      await globalSaveWorkflow({});

      expect(mockClientUpdate).toHaveBeenCalledWith(
        'slug-workflow',
        expect.objectContaining({ id: 'slug-workflow' })
      );
    });
  });

  // -------------------------------------------------------------------------
  // Event handler hooks
  // -------------------------------------------------------------------------

  describe('event handlers', () => {
    it('cancels save when onBeforeSave returns false', async () => {
      mockGetWorkflowStore.mockReturnValue(storeWorkflow(''));
      const onBeforeSave = vi.fn().mockResolvedValue(false);

      await globalSaveWorkflow({ eventHandlers: { onBeforeSave } });

      expect(mockClientSave).not.toHaveBeenCalled();
      expect(mockClientUpdate).not.toHaveBeenCalled();
    });

    it('proceeds with save when onBeforeSave returns true', async () => {
      mockGetWorkflowStore.mockReturnValue(storeWorkflow(''));
      mockClientSave.mockResolvedValue(backendWorkflow('new-id'));
      const onBeforeSave = vi.fn().mockResolvedValue(true);

      await globalSaveWorkflow({ eventHandlers: { onBeforeSave } });

      expect(mockClientSave).toHaveBeenCalledTimes(1);
    });

    it('calls onAfterSave with the saved workflow on success', async () => {
      const saved = backendWorkflow('backend-id');
      mockGetWorkflowStore.mockReturnValue(storeWorkflow(''));
      mockClientSave.mockResolvedValue(saved);
      const onAfterSave = vi.fn().mockResolvedValue(undefined);

      await globalSaveWorkflow({ eventHandlers: { onAfterSave } });

      expect(onAfterSave).toHaveBeenCalledWith(saved);
    });
  });

  // -------------------------------------------------------------------------
  // Guard: no workflow in store
  // -------------------------------------------------------------------------

  it('returns early without making any API call when store is empty', async () => {
    mockGetWorkflowStore.mockReturnValue(null);

    await globalSaveWorkflow({});

    expect(mockClientSave).not.toHaveBeenCalled();
    expect(mockClientUpdate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // onSaved callback
  // -------------------------------------------------------------------------

  describe('onSaved callback', () => {
    it('is called with the server-returned workflow after a create', async () => {
      const serverWorkflow = backendWorkflow('server-assigned-id');
      mockGetWorkflowStore.mockReturnValue(storeWorkflow(''));
      mockClientSave.mockResolvedValue(serverWorkflow);
      const onSaved = vi.fn();

      await globalSaveWorkflow({ onSaved });

      expect(onSaved).toHaveBeenCalledOnce();
      expect(onSaved).toHaveBeenCalledWith(serverWorkflow);
    });

    it('receives the server-assigned ID, not the client UUID, for new workflows', async () => {
      const serverWorkflow = backendWorkflow('server-integer-42');
      mockGetWorkflowStore.mockReturnValue(storeWorkflow(''));
      mockClientSave.mockResolvedValue(serverWorkflow);
      const onSaved = vi.fn();

      await globalSaveWorkflow({ onSaved });

      const [calledWith] = onSaved.mock.calls[0];
      expect(calledWith.id).toBe('server-integer-42');
      expect(calledWith.id).not.toBe(FIXED_UUID);
    });

    it('is called with the server-returned workflow after an update', async () => {
      const serverWorkflow = backendWorkflow('existing-id');
      mockGetWorkflowStore.mockReturnValue(storeWorkflow('existing-id'));
      mockClientUpdate.mockResolvedValue(serverWorkflow);
      const onSaved = vi.fn();

      await globalSaveWorkflow({ onSaved });

      expect(onSaved).toHaveBeenCalledWith(serverWorkflow);
    });

    it('is not called when the API call fails', async () => {
      mockGetWorkflowStore.mockReturnValue(storeWorkflow(''));
      mockClientSave.mockRejectedValue(new Error('Network error'));
      const onSaved = vi.fn();

      await expect(globalSaveWorkflow({ onSaved })).rejects.toThrow('Network error');
      expect(onSaved).not.toHaveBeenCalled();
    });

    it('is not called when cancelled by onBeforeSave returning false', async () => {
      mockGetWorkflowStore.mockReturnValue(storeWorkflow(''));
      const onSaved = vi.fn();

      await globalSaveWorkflow({
        eventHandlers: { onBeforeSave: vi.fn().mockResolvedValue(false) },
        onSaved
      });

      expect(onSaved).not.toHaveBeenCalled();
      expect(mockClientSave).not.toHaveBeenCalled();
    });

    it('is not called when the store is empty', async () => {
      mockGetWorkflowStore.mockReturnValue(null);
      const onSaved = vi.fn();

      await globalSaveWorkflow({ onSaved });

      expect(onSaved).not.toHaveBeenCalled();
    });

    it('is called after onMarkAsSaved', async () => {
      const callOrder: string[] = [];
      mockGetWorkflowStore.mockReturnValue(storeWorkflow(''));
      mockClientSave.mockResolvedValue(backendWorkflow('new-id'));

      await globalSaveWorkflow({
        onMarkAsSaved: () => callOrder.push('markAsSaved'),
        onSaved: () => callOrder.push('onSaved')
      });

      expect(callOrder).toEqual(['markAsSaved', 'onSaved']);
    });
  });

  // -------------------------------------------------------------------------
  // interface round-trip (the payload is an explicit key list — a contract
  // field missing from it is silently stripped on every save)
  // -------------------------------------------------------------------------

  describe('revision round trip', () => {
    it('sends the loaded revision on update and takes the new one from the response', async () => {
      mockGetWorkflowStore.mockReturnValue({ ...storeWorkflow('wf-1'), revision: '100' });
      mockClientUpdate.mockResolvedValue({
        ...backendWorkflow('wf-1'),
        revision: '101',
        can: { save: true, run: false }
      });

      await globalSaveWorkflow();

      expect(mockClientUpdate).toHaveBeenCalledWith(
        'wf-1',
        expect.objectContaining({ revision: '100' })
      );
      expect(mockStoreAcknowledgeServer).toHaveBeenCalledWith({
        revision: '101',
        can: { save: true, run: false }
      });
    });

    it('omits revision when the workflow carries none', async () => {
      mockGetWorkflowStore.mockReturnValue(storeWorkflow('wf-1'));
      mockClientUpdate.mockResolvedValue(backendWorkflow('wf-1'));

      await globalSaveWorkflow();

      const sent = mockClientUpdate.mock.calls[0][1] as Record<string, unknown>;
      expect(sent).not.toHaveProperty('revision');
      expect(sent).not.toHaveProperty('can');
    });
  });

  describe('workflow interface serialization', () => {
    const iface = {
      inputs: [
        {
          id: 'customer_name',
          dataType: 'string',
          required: true,
          bindings: [{ nodeId: 'node-1', portId: 'name' }]
        }
      ],
      outputs: []
    };

    it('sends interface on update when the workflow declares one', async () => {
      mockGetWorkflowStore.mockReturnValue({ ...storeWorkflow('wf-1'), interface: iface });
      mockClientUpdate.mockResolvedValue(backendWorkflow('wf-1'));

      await globalSaveWorkflow();

      expect(mockClientUpdate).toHaveBeenCalledWith(
        'wf-1',
        expect.objectContaining({ interface: iface })
      );
    });

    it('sends interface on create when the workflow declares one', async () => {
      mockGetWorkflowStore.mockReturnValue({ ...storeWorkflow(''), interface: iface });
      mockClientSave.mockResolvedValue(backendWorkflow('new-id'));

      await globalSaveWorkflow();

      expect(mockClientSave).toHaveBeenCalledWith(expect.objectContaining({ interface: iface }));
    });

    it('omits the interface key entirely when the workflow declares none', async () => {
      mockGetWorkflowStore.mockReturnValue(storeWorkflow('wf-1'));
      mockClientUpdate.mockResolvedValue(backendWorkflow('wf-1'));

      await globalSaveWorkflow();

      const payload = mockClientUpdate.mock.calls[0][1] as Record<string, unknown>;
      expect('interface' in payload).toBe(false);
    });
  });
});
