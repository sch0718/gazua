import type { ReleaseNote } from '@sch0718/app-update';

// 도움말 「최근 바뀐 점」과 업데이트 뒤 첫 실행 안내에 쓰는 사용자용 릴리스 내용. 새것부터 적는다.
// 웹 앱 화면이 바뀐 릴리스만 적는다(CLI·맥 자동 실행기만 바뀐 릴리스는 GitHub Release에만 둔다).
// 릴리스를 만들 때 여기에 한 줄~세 줄을 더한다.
export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: 'v0.9.0',
    date: '2026-11-14',
    items: [
      '설정 › 표시에서 강조색 팔레트 10종을 골라요. 등락색은 그대로예요.',
      '시장 파일이 없는 휴대폰에서도 맥 프록시에 물어 선정 기준 미리 보기·검증을 해요.',
    ],
  },
];
