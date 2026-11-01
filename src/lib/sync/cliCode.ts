// sync-worker/src/cli.ts의 사용자 코드 알파벳과 같다.
const LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
const COMPLETE = new RegExp(`^[${LETTERS}]{4}-[${LETTERS}]{4}$`);

/** 영문자만 남겨 대문자로, 8자까지, 4자 뒤에 하이픈 */
export function formatCliCode(raw: string): string {
  const letters = raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
  return letters.length > 4 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
}
export const cliCodeComplete = (display: string): boolean => COMPLETE.test(display);

/** 승인 대화상자의 요청 시각 */
export function agoText(createdAt: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - createdAt) / 1000));
  if (sec < 60) return '방금';
  const min = Math.floor(sec / 60);
  return min < 60 ? `${min}분 전` : `${Math.floor(min / 60)}시간 전`;
}
