// 공유 종류와 표시 이름(설계 2.1). ShareDialog·kakao·SharedView·SyncManage·sync-worker가 함께 쓴다(DOM 의존 없음).
export const SHARE_KINDS = ['group', 'strategy', 'criteria', 'compare', 'simResult', 'validation'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

export const SHARE_KIND_LABEL: Record<ShareKind, string> = {
  group: '그룹',
  strategy: '전략',
  criteria: '선정 기준',
  compare: '비교 화면',
  simResult: '시뮬레이션 결과',
  validation: '검증 결과',
};

export const isShareKind = (k: unknown): k is ShareKind => typeof k === 'string' && (SHARE_KINDS as readonly string[]).includes(k);

/** 모르는 종류(새 버전 앱이 만든 공유)도 화면이 깨지지 않게 */
export const kindLabel = (k: string): string => (isShareKind(k) ? SHARE_KIND_LABEL[k] : '공유');
