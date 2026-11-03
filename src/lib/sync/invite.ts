// 초대 링크(#/join/<코드>)로 받은 코드를 로그인할 때까지 둔다(설계 2026-11-03-invite-signup 3절).
// 저장소를 쓸 수 없는 브라우저(사생활 보호 모드 등)에서는 조용히 넘어간다. 그때는 초대 없이 로그인하게 된다.
export const INVITE_KEY = 'gazua:invite';
export const INVITE_RE = /^[A-Za-z0-9_-]{32,128}$/;

export function saveInvite(code: string): void {
  if (!INVITE_RE.test(code)) return;
  try {
    localStorage.setItem(INVITE_KEY, code);
  } catch { /* 저장하지 못하면 초대 없이 이어 간다 */ }
}

export function readInvite(): string | null {
  try {
    const code = localStorage.getItem(INVITE_KEY);
    return code !== null && INVITE_RE.test(code) ? code : null;
  } catch {
    return null;
  }
}

export function clearInvite(): void {
  try {
    localStorage.removeItem(INVITE_KEY);
  } catch { /* 지우지 못해도 다음 로그인에서 서버가 다시 판단한다 */ }
}
