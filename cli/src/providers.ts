// 앱 factory.ts 대신 직접 조립해 브라우저 전용 코드가 CLI 번들에 들어오지 않게 한다.
import { createRequestQueue } from '../../src/lib/data/requestQueue';
import { createKisProvider } from '../../src/lib/providers/kis';
import { createTossProvider, TOSS_QUEUE_RATES } from '../../src/lib/providers/toss';
import type { MarketDataProvider } from '../../src/lib/providers/types';
import type { Ctx } from './context';
import { createDirectClient } from './direct';
import type { Creds, ProviderId } from './env';
import { CliError } from './errors';
import { createFileLock } from './fileLock';
import { fileIssuedAtStore, fileTokenStore, keyHashOf, type StoreHooks } from './tokenFiles';

/** 앱 factory.ts와 같은 KIS 요청 속도 */
const KIS_QUEUE_RATES = { kis: 15 };

export interface Built {
  id: ProviderId;
  provider: MarketDataProvider;
  keyHash: string;
}

const hooks = (ctx: Ctx): StoreHooks => ({ onSecret: (t) => ctx.redact.add(t), warn: ctx.warn });

export function buildProvider(ctx: Ctx, id: ProviderId, creds: Creds): Built {
  const client = createDirectClient(ctx.fetch);
  if (id === 'kis') {
    const c = creds.kis;
    if (!c) throw new CliError('no-credentials');
    ctx.redact.add(c.appKey);
    ctx.redact.add(c.appSecret);
    const keyHash = keyHashOf(c.appKey);
    return {
      id,
      keyHash,
      provider: createKisProvider({
        client,
        queue: createRequestQueue({ ratesPerSec: KIS_QUEUE_RATES }),
        creds: c,
        tokenStore: fileTokenStore(ctx.dir, 'kis', keyHash, hooks(ctx)),
        issuedAt: fileIssuedAtStore(ctx.dir, 'kis', keyHash, hooks(ctx)),
        tokenLock: createFileLock({ dir: ctx.dir, name: 'kis' }),
        now: ctx.now,
      }),
    };
  }
  const c = creds.toss;
  if (!c) throw new CliError('no-credentials');
  ctx.redact.add(c.clientId);
  ctx.redact.add(c.clientSecret);
  const keyHash = keyHashOf(c.clientId);
  return {
    id,
    keyHash,
    provider: createTossProvider({
      client,
      queue: createRequestQueue({ ratesPerSec: { ...TOSS_QUEUE_RATES } }),
      creds: c,
      tokenStore: fileTokenStore(ctx.dir, 'toss', keyHash, hooks(ctx)),
      // 재시작 뒤에도 토스 재발급 간격(60초)을 지킨다.
      issuedAt: fileIssuedAtStore(ctx.dir, 'toss', keyHash, hooks(ctx)),
      tokenLock: createFileLock({ dir: ctx.dir, name: 'toss' }),
      now: ctx.now,
    }),
  };
}
