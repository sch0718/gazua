// 응답 도우미. 모든 응답은 캐시하지 않는다(개인 데이터·공유 스냅샷 모두).

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export const errorBody = (code: string, extra: Record<string, unknown> = {}) => ({ error: code, ...extra });

/** 요청 본문 상한(문서 256 KiB + 여유). */
export const MAX_BODY_BYTES = 300 * 1024;

/** 본문을 상한까지만 읽어 JSON으로. 넘으면 413, JSON이 아니면 400. */
export async function readJson(req: Request, max = MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(req.headers.get('Content-Length') ?? '0');
  if (declared > max) throw new HttpError(413, 'too-large');
  if (!req.body) throw new HttpError(400, 'bad-json');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, 'too-large');
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new HttpError(400, 'bad-json');
  }
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 256비트 base64url(43자)인지. */
export const isCapability = (s: string | null): s is string => s !== null && /^[A-Za-z0-9_-]{43}$/.test(s);
