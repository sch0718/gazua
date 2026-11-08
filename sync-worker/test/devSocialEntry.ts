// 로컬 화면 시험 전용 진입점이다. 지어낸 공급자와 키를 쓰므로 절대 배포하지 않는다.
import { createFakeSocial } from '@sch0718/firebase-session/testing';
import { parseRedirectUris } from '@sch0718/firebase-session/worker';
import type { SyncEnv } from '../src/env';
import { handle } from '../src/handler';
import { purge } from '../src/purge';

const fake = createFakeSocial({ basePath: '/__dev/social' });

export default {
  async fetch(req: Request, env: SyncEnv): Promise<Response> {
    const res = await fake.handle(req, parseRedirectUris(env.SOCIAL_REDIRECT_URIS));
    if (res) return res;
    return handle(req, env, {
      now: Date.now,
      certs: { key: async () => null },
      socialKeys: fake.keys,
      socialFetch: fake.fetch,
      random: (n) => crypto.getRandomValues(new Uint8Array(n)),
      uuid: () => crypto.randomUUID(),
      log: (line) => console.log(line),
    });
  },
  async scheduled(_controller: unknown, env: SyncEnv): Promise<void> {
    console.log(JSON.stringify(await purge(env, Date.now())));
  },
};
