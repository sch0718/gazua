// 앱이 쓰는 운영 의존성의 라이선스 전문을 모아 public/licenses.txt를 만든다(설정 → 정보 → 오픈소스와 데이터 출처).
// 생성은 @sch0718/license-notices가 한다. 여기서는 가즈아 값(번들되는 devDependencies, upstream 원문)만 정한다.
import { fileURLToPath } from 'node:url';
import { writeNotices } from '@sch0718/license-notices';

// devDependencies지만 런타임 코드가 번들에 들어가는 패키지(Svelte 런타임, PWA 서비스 워커의 Workbox,
// 번들되는 @sch0718 패키지). @sch0718/vite-app·license-notices는 빌드 전용이라 넣지 않는다.
export const BUNDLED_DEV = (name) =>
  ['svelte', 'clsx', 'esm-env', '@sch0718/firebase-session', '@sch0718/ui-svelte'].includes(name) ||
  /^workbox-(?!build$)/.test(name);

// 배포본에 라이선스 파일이 없는 패키지는 upstream 저장소의 원문을 scripts/licenses/에 두고 쓴다.
export function upstreamFile(name) {
  if (name === 'firebase' || name.startsWith('@firebase/')) return 'firebase.txt';
  if (name === 'fancy-canvas') return 'fancy-canvas.txt';
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { count } = writeNotices({
    out: fileURLToPath(new URL('../public/licenses.txt', import.meta.url)),
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    appName: '가즈아',
    licenseUrl: 'https://github.com/sch0718/gazua/blob/main/LICENSE',
    upstreamDir: fileURLToPath(new URL('./licenses/', import.meta.url)),
    upstream: upstreamFile,
    bundledDev: BUNDLED_DEV,
  });
  console.log(`licenses.txt: 패키지 ${count}개`);
}
