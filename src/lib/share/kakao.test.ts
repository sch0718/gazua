import { describe, expect, it } from 'vitest';
import { newStrategy } from '../sim/defaults';
import { kakaoCard, readKakaoConfig } from './kakao';
import { groupSnapshot, strategySnapshot } from './snapshot';

const URL_ = 'https://gazua.sch0718.dev/#/s/' + 'x'.repeat(43);

describe('readKakaoConfig', () => {
  it('키가 없거나 비면 끈다', () => {
    expect(readKakaoConfig({})).toBeNull();
    expect(readKakaoConfig({ VITE_KAKAO_JS_KEY: '  ' })).toBeNull();
  });
  it('키 앞뒤 공백을 지운다', () => {
    expect(readKakaoConfig({ VITE_KAKAO_JS_KEY: ' abc123 ' })).toEqual({ appKey: 'abc123' });
  });
});

describe('kakaoCard', () => {
  const group = groupSnapshot({
    id: 'g-secret-id',
    name: '반도체',
    items: [
      { symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 },
      { symbol: '000660', colorSlot: 2, hidden: false, addedAt: 2 },
    ],
  });

  it('그룹은 제목과 종목 「이름(코드)」만 쓰고 링크·아이콘은 공유 링크의 출처를 쓴다', () => {
    const names = new Map([['005930', '삼성전자']]);
    expect(kakaoCard(group, URL_, names)).toEqual({
      title: '그룹 공유: 반도체',
      description: '종목 2개: 삼성전자(005930), 000660',
      imageUrl: 'https://gazua.sch0718.dev/icon-512.png',
      imageWidth: 512,
      imageHeight: 512,
      url: URL_,
      buttonTitle: '열어 보기',
    });
  });

  it('스냅샷 원문이나 원본 ID를 넣지 않는다', () => {
    const card = JSON.stringify(kakaoCard(group, URL_));
    expect(card).not.toContain('g-secret-id');
    expect(card).not.toContain('"kind"');
    expect(card).not.toContain('colorSlot');
  });

  it('전략은 요약 두 줄만 쓰고 비공개 자금은 그대로 비공개다', () => {
    const st = { ...newStrategy(0, null, '눌림목'), id: 's1' };
    st.capital.initial = 123_456_789;
    const card = kakaoCard(strategySnapshot(st, { groups: [] }, { hideCapital: true }), URL_);
    expect(card.title).toBe('전략 공유: 눌림목');
    expect(card.description?.split('\n')).toHaveLength(2);
    expect(card.description).not.toContain('123,456,789');
  });
});
