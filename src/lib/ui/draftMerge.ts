// 편집기 작업본과 바깥 변경(원격 동기화 적용·다른 탭)의 3방향 병합.
// 작업본에서 고치지 않은 값은 바깥 값을, 고친 값은 작업본 값을 쓴다. 객체는 필드마다, 배열·기본값은 통째로 본다.

const isPlain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function mergeDraft<T>(base: T, draft: T, remote: T): T {
  if (isPlain(base) && isPlain(draft) && isPlain(remote)) {
    const out: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(remote), ...Object.keys(draft)])) {
      if (!(k in remote)) {
        if (!same(draft[k], base[k])) out[k] = draft[k]; // 작업본에서 새로 넣은 값
        continue;
      }
      out[k] = mergeDraft(base[k], draft[k], remote[k]);
    }
    return out as T;
  }
  return same(draft, base) ? remote : draft;
}
