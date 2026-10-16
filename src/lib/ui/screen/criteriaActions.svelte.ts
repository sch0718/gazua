// 선정 기준 목록·편집 화면이 함께 쓰는 동작.
import { MAX_CRITERIA, NAME_MAX } from '../../screen/defaults';
import type { SelectionCriteria } from '../../screen/types';
import type { App } from '../../state/app.svelte';

/** 원본 바로 뒤에 `… 사본`을 새 id로 넣고 그 id를 돌려준다. 가득 찼으면 null. */
export function duplicateCriteria(app: App, c: SelectionCriteria): string | null {
  if (app.criteria.length >= MAX_CRITERIA) return null;
  const name = `${c.name.slice(0, NAME_MAX - 3)} 사본`;
  const copy: SelectionCriteria = { ...($state.snapshot(c) as SelectionCriteria), id: crypto.randomUUID(), name, updatedAt: Date.now() };
  const i = app.criteria.findIndex((x) => x.id === c.id);
  const next = [...app.criteria];
  next.splice(i + 1, 0, copy);
  app.setCriteria(next);
  return copy.id;
}
