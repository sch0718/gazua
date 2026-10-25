// 로컬 스모크 전용 진입점(배포 금지): Google 인증서 대신 TEST_PUBLIC_JWK의 지어낸 공개키로 서명을 검증한다.
// wrangler.toml의 main은 src/worker.ts다. 이 파일은 `pnpm smoke`가 wrangler dev에만 넘긴다.
import { importJWK } from 'jose';
import type { SyncEnv } from '../src/env';
import { handle } from '../src/handler';
import { purge } from '../src/purge';

type Env = SyncEnv & { TEST_PUBLIC_JWK: string };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const key = (await importJWK(JSON.parse(env.TEST_PUBLIC_JWK), 'RS256')) as CryptoKey;
    return handle(req, env, {
      now: Date.now,
      certs: { key: async (kid) => (kid === 'smoke' ? key : null) },
      random: (n) => crypto.getRandomValues(new Uint8Array(n)),
      uuid: () => crypto.randomUUID(),
      log: (l) => console.log(l),
    });
  },
  async scheduled(_c: unknown, env: Env): Promise<void> {
    console.log(JSON.stringify(await purge(env, Date.now())));
  },
};
