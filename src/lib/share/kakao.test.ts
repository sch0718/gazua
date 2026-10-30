import { afterEach, describe, expect, it, vi } from 'vitest';
import { newStrategy } from '../sim/defaults';
import { deleteCardImage, kakaoCard, readKakaoConfig, uploadCardImage } from './kakao';
import { groupSnapshot, strategySnapshot } from './snapshot';
import { simResultFixture } from './testFixtures';

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

  it('이미지가 없으면 종류별 고정 이미지(800×400), 설명은 카드 두 줄', () => {
    const names = new Map([['005930', '삼성전자']]);
    expect(kakaoCard(group, URL_, { names })).toEqual({
      title: '그룹 공유: 반도체',
      description: '종목 2개: 삼성전자, 000660',
      imageUrl: 'https://gazua.sch0718.dev/share/group.png',
      imageWidth: 800,
      imageHeight: 400,
      url: URL_,
      buttonTitle: '열어 보기',
    });
  });

  it('올린 캡처가 있으면 그 주소와 크기, 결과 종류는 두 줄 요약', () => {
    const card = kakaoCard(simResultFixture(), URL_, { image: { url: 'https://k.kakaocdn.net/dn/abc.jpg', width: 1600, height: 800 } });
    expect(card).toMatchObject({ title: '시뮬레이션 결과 공유: 눌림목', imageUrl: 'https://k.kakaocdn.net/dn/abc.jpg', imageWidth: 1600, imageHeight: 800 });
    expect(card.description!.split('\n')).toHaveLength(2);
    expect(card.description).toContain('총수익률');
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

describe('카드 이미지 업로드', () => {
  const file = new File(['x'], 'gazua-card.jpg', { type: 'image/jpeg' });
  const share = (o: Record<string, unknown>) => Object.assign(globalThis, { Kakao: { Share: o } });
  afterEach(() => Reflect.deleteProperty(globalThis, 'Kakao'));

  it('파일 배열로 올리고 https·200×200 이상만 받는다', async () => {
    const uploadImage = vi.fn(async () => ({ infos: { original: { url: 'https://k.kakaocdn.net/a.jpg', width: 1600, height: 800 } } }));
    share({ uploadImage });
    expect(await uploadCardImage(file)).toEqual({ url: 'https://k.kakaocdn.net/a.jpg', width: 1600, height: 800 });
    expect(uploadImage).toHaveBeenCalledWith({ file: [file] });
    share({ uploadImage: async () => ({ infos: { original: { url: 'http://k.kakaocdn.net/a.jpg', width: 1600, height: 800 } } }) });
    expect(await uploadCardImage(file)).toBeNull();
    share({ uploadImage: async () => ({ infos: { original: { url: 'https://k.kakaocdn.net/a.jpg', width: 150, height: 150 } } }) });
    expect(await uploadCardImage(file)).toBeNull();
  });

  it('SDK에 uploadImage가 없거나 실패하면 null', async () => {
    share({});
    expect(await uploadCardImage(file)).toBeNull();
    share({ uploadImage: async () => Promise.reject(new Error('403')) });
    expect(await uploadCardImage(file)).toBeNull();
  });

  it('시간이 지나면 null이고, 늦게 온 응답의 이미지는 지운다', async () => {
    let resolve!: (v: unknown) => void;
    const deleteImage = vi.fn(async () => ({}));
    share({ uploadImage: () => new Promise((r) => (resolve = r)), deleteImage });
    expect(await uploadCardImage(file, 5)).toBeNull();
    resolve({ infos: { original: { url: 'https://k.kakaocdn.net/late.jpg', width: 1600, height: 800 } } });
    await new Promise((r) => setTimeout(r, 0));
    expect(deleteImage).toHaveBeenCalledWith({ imageUrl: 'https://k.kakaocdn.net/late.jpg' });
  });

  it('지우기 실패는 무시한다', async () => {
    share({ deleteImage: async () => Promise.reject(new Error('x')) });
    expect(() => deleteCardImage('https://k.kakaocdn.net/a.jpg')).not.toThrow();
    share({});
    expect(() => deleteCardImage('https://k.kakaocdn.net/a.jpg')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
