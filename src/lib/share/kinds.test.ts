import { describe, expect, it } from 'vitest';
import { isShareKind, kindLabel, SHARE_KIND_LABEL, SHARE_KINDS } from './kinds';

describe('공유 종류', () => {
  it('여섯 종류와 표시 이름', () => {
    expect(SHARE_KINDS).toEqual(['group', 'strategy', 'criteria', 'compare', 'simResult', 'validation']);
    expect(SHARE_KINDS.map((k) => SHARE_KIND_LABEL[k])).toEqual(['그룹', '전략', '선정 기준', '비교 화면', '시뮬레이션 결과', '검증 결과']);
  });

  it('모르는 종류는 공유로 보인다', () => {
    expect(kindLabel('simResult')).toBe('시뮬레이션 결과');
    expect(kindLabel('future')).toBe('공유');
    expect(kindLabel('__proto__')).toBe('공유');
    expect(isShareKind('compare')).toBe(true);
    expect(isShareKind('toString')).toBe(false);
    expect(isShareKind(1)).toBe(false);
  });
});
