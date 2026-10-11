// 시트 테스트용 앱: 데모 공급자, 메모리 저장소, 고정 시각.
import { memoryCache } from '../lib/data/testCache';
import { createApp, type App } from '../lib/state/app.svelte';
import { DEFAULT_SETTINGS, type Group, type Meta, type Settings, type WatchItem } from '../lib/state/schema';
import { createSafeStorage } from '../lib/state/storage';
import { memoryBacking, seed } from '../lib/state/testStorage';

const META: Meta = { schemaVersion: 1, activeProfileId: 'p1', profiles: [{ id: 'p1', name: '내 프로필', createdAt: 1 }] };

export const itemsOf = (symbols: string[]): WatchItem[] =>
  symbols.map((symbol, i) => ({ symbol, colorSlot: (i + 1) as WatchItem['colorSlot'], hidden: false, addedAt: 1 }));

export function makeTestApp(opts: {
  groups: Group[];
  now: number;
  settings?: Partial<Settings>;
  recent?: string[];
}): App {
  const backing = memoryBacking();
  seed(backing, 'meta', META);
  seed(backing, 'p:p1:settings', { ...DEFAULT_SETTINGS, onboarded: true, ...opts.settings });
  seed(backing, 'p:p1:watchlists', { groups: opts.groups });
  if (opts.recent) seed(backing, 'p:p1:recent', opts.recent);
  location.hash = `#/compare/${opts.groups[0]?.id ?? ''}`;
  return createApp({ storage: createSafeStorage(backing), now: () => opts.now, cache: memoryCache() });
}
