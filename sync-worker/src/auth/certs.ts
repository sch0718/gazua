// Firebase ID 토큰 서명용 Google 공개 인증서. 응답의 Cache-Control max-age만큼 isolate 메모리에 둔다.
import { importX509, type CryptoKey as JoseKey } from 'jose';

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export interface CertSource {
  /** kid에 맞는 공개키. 모르는 kid면 null. 인증서를 받지 못하면 던진다. */
  key(kid: string): Promise<JoseKey | null>;
}

export class CertsUnavailableError extends Error {}

const DEFAULT_MAX_AGE = 60 * 60 * 1000;

export function googleCerts(fetchImpl: typeof fetch = fetch, now: () => number = Date.now, url = GOOGLE_CERTS_URL): CertSource {
  let cached: { until: number; keys: Map<string, JoseKey> } | null = null;
  let inflight: Promise<Map<string, JoseKey>> | null = null;

  async function load(): Promise<Map<string, JoseKey>> {
    let res: Response;
    try {
      res = await fetchImpl(url);
    } catch {
      throw new CertsUnavailableError('fetch failed');
    }
    if (!res.ok) throw new CertsUnavailableError(`status ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    const keys = new Map<string, JoseKey>();
    for (const [kid, pem] of Object.entries(body)) {
      if (typeof pem === 'string') keys.set(kid, await importX509(pem, 'RS256'));
    }
    const m = /max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '');
    cached = { until: now() + (m ? Number(m[1]) * 1000 : DEFAULT_MAX_AGE), keys };
    return keys;
  }

  return {
    async key(kid) {
      if (!cached || now() >= cached.until) {
        inflight ??= load().finally(() => {
          inflight = null;
        });
        await inflight;
      }
      return cached!.keys.get(kid) ?? null;
    },
  };
}
