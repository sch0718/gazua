// 서버 프로필 문서 읽기: v1이면 v2로 옮겨 읽고(저장하지 않는다), 프로필·전략을 이름이나 ID로 찾는다.
import { sanitizeStrategiesV1, toV2 } from '../../src/lib/sim/strategyV1';
import { sanitizeStrategiesV2, type StrategyV2 } from '../../src/lib/sim/strategyV2';
import type { WatchItem, Watchlists } from '../../src/lib/state/schema';
import { CliError } from './errors';
import type { SyncClient } from './syncClient';

export interface ProfileData {
  id: string;
  name: string;
  revision: number;
  watchlists: Watchlists;
  strategies: StrategyV2[];
}

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 서버가 이미 검증한 문서라 필요한 필드만 방어적으로 읽는다(색 칸·추가 시각은 CLI가 쓰지 않는다) */
function readWatchlists(raw: unknown): Watchlists {
  const groups = isRecord(raw) && Array.isArray(raw.groups) ? raw.groups.filter(isRecord) : [];
  return {
    groups: groups.map((g) => ({
      id: String(g.id),
      name: String(g.name),
      items: (Array.isArray(g.items) ? g.items.filter(isRecord) : [])
        .filter((i) => typeof i.symbol === 'string')
        .map((i): WatchItem => ({ symbol: i.symbol as string, colorSlot: 1, hidden: i.hidden === true, addedAt: typeof i.addedAt === 'number' ? i.addedAt : 0 })),
    })),
  };
}

export function normalizeDoc(doc: unknown, now: number): { name: string; watchlists: Watchlists; strategies: StrategyV2[] } {
  if (!isRecord(doc) || typeof doc.v !== 'number') throw new CliError('internal', '프로필 문서 모양이 맞지 않아요');
  if (doc.v > 2) throw new CliError('app-outdated');
  const strategies =
    doc.v === 1
      ? sanitizeStrategiesV1({ strategies: doc.strategies }, now).strategies.map(toV2)
      : sanitizeStrategiesV2({ strategies: doc.strategies }, now).strategies;
  return { name: typeof doc.name === 'string' ? doc.name : '(이름 없음)', watchlists: readWatchlists(doc.watchlists), strategies };
}

async function read(client: SyncClient, id: string, now: number): Promise<ProfileData> {
  const r = await client.profile(id);
  return { id, revision: r.revision, ...normalizeDoc(r.doc, now) };
}

const liveRows = async (client: SyncClient) => (await client.profiles()).filter((r) => r.deletedAt === null);

/** 삭제 안 된 프로필 전부(서버 색인에는 이름이 없어 문서를 하나씩 읽는다) */
export async function loadAllProfiles(client: SyncClient, now: number): Promise<ProfileData[]> {
  return Promise.all((await liveRows(client)).map((r) => read(client, r.profileId, now)));
}

export async function pickProfile(client: SyncClient, flag: string | undefined, now: number): Promise<ProfileData> {
  const rows = await liveRows(client);
  if (rows.length === 0) throw new CliError('profile-not-found', '서버에 프로필이 없어요. 앱에서 동기화를 켜 주세요');
  if (flag !== undefined) {
    const byId = rows.find((r) => r.profileId === flag);
    if (byId) return read(client, byId.profileId, now);
  } else if (rows.length === 1) {
    return read(client, rows[0].profileId, now);
  }
  const all = await Promise.all(rows.map((r) => read(client, r.profileId, now)));
  const list = all.map((p) => ({ id: p.id, name: p.name }));
  if (flag === undefined) throw new CliError('profile-required', undefined, { profiles: list });
  const hits = all.filter((p) => p.name === flag);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new CliError('profile-required', '같은 이름의 프로필이 여럿이에요. ID로 골라 주세요', { profiles: hits.map((p) => ({ id: p.id, name: p.name })) });
  throw new CliError('profile-not-found');
}

/** 이름 정확 일치가 먼저, 없으면 ID */
export function findStrategy(strategies: StrategyV2[], ref: string): StrategyV2 {
  const byName = strategies.filter((s) => s.name === ref);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) throw new CliError('ambiguous-strategy', undefined, { matches: byName.map((s) => ({ id: s.id, name: s.name })) });
  const byId = strategies.find((s) => s.id === ref);
  if (byId) return byId;
  throw new CliError('strategy-not-found');
}
