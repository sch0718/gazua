/** 테스트용 메모리 localStorage. `dump()`은 저장된 모든 키와 값을 한 문자열로 돌려준다. */
export function memoryBacking(): Storage & { dump(): string } {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, String(v));
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    clear: () => m.clear(),
    dump: () => [...m.entries()].map(([k, v]) => `${k}=${v}`).join('\n'),
  };
}

export function seed(backing: Storage, key: string, value: unknown): void {
  backing.setItem(`gazua:v1:${key}`, typeof value === 'string' ? value : JSON.stringify(value));
}

/**
 * 전체 사용량(키 + 값 글자 수 합)이 한도를 넘으면 setItem이 QuotaExceededError를 던지는 localStorage(브라우저와 같은 방식).
 * removeItem은 언제나 된다. `limit`은 나중에 바꿀 수 있다.
 */
export function totalQuotaBacking(limit = Infinity): Storage & { dump(): string; used(): number; limit: number } {
  const m = new Map<string, string>();
  const used = () => [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  const store = {
    limit,
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const value = String(v);
      const next = used() - (m.has(k) ? k.length + m.get(k)!.length : 0) + k.length + value.length;
      if (next > store.limit) throw new DOMException('quota', 'QuotaExceededError');
      m.set(k, value);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    clear: () => m.clear(),
    dump: () => [...m.entries()].map(([k, v]) => `${k}=${v}`).join('\n'),
    used,
  };
  return store;
}
