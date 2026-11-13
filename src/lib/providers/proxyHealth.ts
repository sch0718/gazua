import { ApiError } from './errors';
import { isRedirect } from './http';

export async function proxyManagesTossToken(baseUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/health`, {
      method: 'GET', redirect: 'manual', signal: controller.signal,
    });
    if (isRedirect(response)) throw new ApiError('proxy-redirect');
    if (!response.ok) throw new ApiError('proxy-unreachable');
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || !('ok' in body) || body.ok !== true) {
      throw new ApiError('proxy-unreachable');
    }
    if (!('tossToken' in body)) return false;
    if (typeof body.tossToken !== 'boolean') throw new ApiError('proxy-unreachable');
    return body.tossToken;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))) {
      throw new ApiError('timeout');
    }
    throw new ApiError('proxy-unreachable');
  } finally {
    clearTimeout(timer);
  }
}
