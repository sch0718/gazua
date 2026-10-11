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
