import { takeUnseenReleases, watchAppUpdate } from '@sch0718/app-update';
import { createSeenStore } from '@sch0718/seen-store';
import { showSnackbar } from '@sch0718/ui-svelte';
import { RELEASE_NOTES } from './help/release-notes';

export const RELEASE_SEEN_KEY = 'gazua:release-seen:v1';
// 새 버전 안내는 사용자가 볼 때까지 오래 둔다.
const NOTICE_MS = 10 * 60_000;

/**
 * 업데이트 뒤 첫 실행이면 「바뀐 점」을 한 번 알리고, 배포된 새 버전을 지켜본다.
 * 접속 직후면 자동으로 새로고침하고, 쓰는 중이면 새로고침 안내만 띄운다. 지켜보기를 멈추는 함수를 돌려준다.
 */
export function startAppUpdate(openReleaseNotes: () => void, storage?: () => Storage): () => void {
  const seen = createSeenStore({
    key: RELEASE_SEEN_KEY,
    ids: RELEASE_NOTES.map((n) => n.version),
    ...(storage ? { storage } : {}),
  });
  const [latest] = takeUnseenReleases(RELEASE_NOTES, seen);
  if (latest) showSnackbar(`업데이트했어요 (${latest.version})`, { label: '바뀐 점', run: openReleaseNotes }, NOTICE_MS);
  return watchAppUpdate({
    onUpdate: (reload) => showSnackbar('새 버전이 있어요', { label: '새로고침', run: reload }, NOTICE_MS),
  });
}
