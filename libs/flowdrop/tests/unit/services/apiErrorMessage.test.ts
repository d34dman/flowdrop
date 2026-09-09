/**
 * Unit Tests - API refusals
 *
 * fddo answers a refusal as `{ success: false, error, error_code?, details? }`
 * where `error` is only a headline. The client keeps the headline as the
 * message and the reasons as `ApiError.details`, so a validation failure does
 * not read as a generic "Workflow validation failed". Refusals (4xx other
 * than 408/429) are not retried; timeouts, rate limits and 5xx are.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseApiErrorBody,
  errorDetails,
  EnhancedFlowDropApiClient,
  ApiError
} from '$lib/api/enhanced-client.js';
import { createEndpointConfig } from '$lib/config/endpoints.js';

describe('parseApiErrorBody', () => {
  it('keeps the headline and lists validation detail messages', () => {
    expect(
      parseApiErrorBody(
        {
          success: false,
          error: 'Workflow validation failed',
          error_code: 'VALIDATION_FAILED',
          details: [
            { code: 'VAL-3', message: 'Edge targets a missing node', locator: 'edges[0].target' },
            { code: 'VAL-7', message: 'Node "llm" has no model', locator: 'nodes[2].config.model' }
          ]
        },
        422,
        'Unprocessable Entity'
      )
    ).toEqual({
      message: 'Workflow validation failed',
      details: ['Edge targets a missing node', 'Node "llm" has no model']
    });
  });

  it('gives no details when the body carries none for a human', () => {
    expect(
      parseApiErrorBody(
        {
          success: false,
          error: 'The workflow changed on the server since it was loaded; reload before saving',
          error_code: 'CONFLICT',
          details: { current: '2', sent: '1' }
        },
        409,
        'Conflict'
      )
    ).toEqual({
      message: 'The workflow changed on the server since it was loaded; reload before saving',
      details: []
    });
  });

  it('reads the exception subscriber envelope (error + message)', () => {
    expect(
      parseApiErrorBody(
        { error: 'Access denied', message: 'You need the "edit workflows" permission' },
        403,
        'Forbidden'
      )
    ).toEqual({
      message: 'Access denied',
      details: ['You need the "edit workflows" permission']
    });
  });

  it('falls back to the HTTP status for an empty or non-JSON body', () => {
    expect(parseApiErrorBody({}, 500, 'Internal Server Error')).toEqual({
      message: 'HTTP 500: Internal Server Error',
      details: []
    });
    expect(parseApiErrorBody(undefined, 502, 'Bad Gateway').message).toBe('HTTP 502: Bad Gateway');
  });
});

describe('errorDetails', () => {
  it('reads string details off anything shaped like an ApiError', () => {
    expect(errorDetails(new ApiError('x', 422, 'op', {}, ['a', 'b']))).toEqual(['a', 'b']);
    expect(errorDetails({ details: ['a', 1, null, 'b'] })).toEqual(['a', 'b']);
  });

  it('has nothing for a plain Error, a string or nothing at all', () => {
    expect(errorDetails(new Error('x'))).toEqual([]);
    expect(errorDetails('x')).toEqual([]);
    expect(errorDetails(undefined)).toEqual([]);
  });
});

describe('EnhancedFlowDropApiClient retries', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function client() {
    return new EnhancedFlowDropApiClient(
      createEndpointConfig('http://test.local/api/flowdrop', {
        timeout: 5000,
        retry: { enabled: true, maxAttempts: 3, delay: 1, backoff: 'linear' }
      })
    );
  }

  /** A fresh Response per attempt: a body can only be read once. */
  function respondWith(status: number, statusText: string, body: unknown) {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify(body), { status, statusText })
    );
  }

  const update = () =>
    client()
      .updateWorkflow('wf-1', { id: 'wf-1', name: 'x', nodes: [], edges: [] })
      .catch((e: unknown) => e as ApiError);

  it('does not retry a 422 and carries the details', async () => {
    respondWith(422, 'Unprocessable Entity', {
      success: false,
      error: 'Workflow validation failed',
      error_code: 'VALIDATION_FAILED',
      details: [{ code: 'VAL-1', message: 'Workflow has no nodes', locator: 'nodes' }]
    });

    const error = await update();
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(422);
    expect(error.message).toBe('Workflow validation failed');
    expect(error.details).toEqual(['Workflow has no nodes']);
    expect(error.errorData.error_code).toBe('VALIDATION_FAILED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the body of a 403: the user learns which permission is missing', async () => {
    respondWith(403, 'Forbidden', {
      error: 'Access denied',
      message: 'You need the "edit workflows" permission'
    });
    const error = await update();
    expect(error.status).toBe(403);
    expect(error.message).toBe('Access denied');
    expect(error.details).toEqual(['You need the "edit workflows" permission']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the status for a bodiless 403 and 401', async () => {
    fetchMock.mockImplementation(
      async () => new Response('', { status: 403, statusText: 'Forbidden' })
    );
    expect((await update()).message).toBe('HTTP 403: Forbidden');
    fetchMock.mockImplementation(
      async () => new Response('', { status: 401, statusText: 'Unauthorized' })
    );
    expect((await update()).message).toBe('HTTP 401: Unauthorized');
  });

  it('does not retry a 2xx whose body is not JSON', async () => {
    fetchMock.mockImplementation(
      async () => new Response('<html>login</html>', { status: 200, statusText: 'OK' })
    );
    const error = await update();
    expect(error).toBeInstanceOf(SyntaxError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a network failure', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect((await update()).message).toBe('Failed to fetch');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 404', async () => {
    respondWith(404, 'Not Found', { success: false, error: 'Workflow not found' });
    expect((await update()).message).toBe('Workflow not found');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [408, 'Request Timeout'],
    [429, 'Too Many Requests'],
    [500, 'Internal Server Error'],
    [503, 'Service Unavailable']
  ])('retries a %i', async (status, statusText) => {
    respondWith(status, statusText, { success: false, error: 'Try again' });
    expect((await update()).message).toBe('Try again');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
