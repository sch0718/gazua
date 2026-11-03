// 시장 파일의 수집 계정 표시(설계 2026-11-03-market-owner-tag 2절). 앱과 sync-worker가 함께 쓴다(Web Crypto만).
// 동기화 계정 식별자(users.firebase_sub = 앱의 ownerId)를 해시해 이메일 없이 같은 계정인지만 가린다.

export const OWNER_TAG_RE = /^[0-9a-f]{32}$/;

export async function marketOwnerTag(sub: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`gazua-market-owner/v1\n${sub}`));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
