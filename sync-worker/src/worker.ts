import { googleCerts } from './auth/certs';
import type { SyncDeps, SyncEnv } from './env';
import { handle } from './handler';
import { purge } from './purge';

// isolate마다 하나. 공개 인증서를 max-age 동안 재사용한다.
const certs = googleCerts();

const deps = (): SyncDeps => ({
  now: Date.now,
  certs,
  random: (n) => crypto.getRandomValues(new Uint8Array(n)),
  uuid: () => crypto.randomUUID(),
  log: (line) => console.log(line),
});

export default {
  fetch: (req: Request, env: SyncEnv): Promise<Response> => handle(req, env, deps()),
  async scheduled(_controller: unknown, env: SyncEnv): Promise<void> {
    const r = await purge(env, Date.now());
    console.log(`purge profiles=${r.profiles} shares=${r.shares} sessions=${r.sessions}`);
  },
};
