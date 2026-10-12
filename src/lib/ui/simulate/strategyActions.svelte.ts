// 전략 목록·편집 화면이 함께 쓰는 동작.
import type { App } from '../../state/app.svelte';
import { MAX_STRATEGIES, NAME_MAX } from '../../sim/defaults';
import type { Strategy } from '../../sim/types';

export const STRATEGIES_FULL_TEXT = `전략은 ${MAX_STRATEGIES}개까지 저장할 수 있어요`;

/** 원본 바로 뒤에 `… 사본`을 새 id로 넣고 그 id를 돌려준다. 가득 찼으면 null. */
export function duplicateStrategy(app: App, s: Strategy): string | null {
  if (app.strategies.length >= MAX_STRATEGIES) return null;
  const name = `${s.name.slice(0, NAME_MAX - 3)} 사본`;
  const copy: Strategy = { ...structuredClone($state.snapshot(s)), id: crypto.randomUUID(), name, updatedAt: Date.now() };
  const i = app.strategies.findIndex((x) => x.id === s.id);
  const next = [...app.strategies];
  next.splice(i + 1, 0, copy);
  app.setStrategies(next);
  return copy.id;
}
