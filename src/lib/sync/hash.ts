// 문서 해시: 키 순서를 정렬한 JSON의 SHA-256. 로컬 문서와 마지막 확인 문서가 같은지 볼 때만 쓴다.

export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (typeof v === 'object' && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export async function docHash(v: unknown): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(v)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
