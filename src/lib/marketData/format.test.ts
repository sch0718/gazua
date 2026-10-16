import { describe, expect, it } from 'vitest';
import { isV2, validateMarketData } from './format';

function sample() {
  return {
    format: 'gazua-market-data',
    version: 1,
    collectedAt: '2026-10-16T18:00:00+09:00',
    source: 'kis',
    adjusted: true,
    range: { from: '2026-10-14', to: '2026-10-15' },
    sectors: [{ code: '00013', name: '전기·전자', level: 1 }],
    stocks: [
      {
        s: '005930',
        n: '삼성전자',
        m: 'KOSPI',
        t: 'STOCK',
        sec: ['0013', '', ''],
        shares: 5846278000,
        managed: false,
        halted: false,
        d: ['20261014', '20261015'],
        o: [70000, 71000],
        h: [71000, 72000],
        l: [69000, 70000],
        c: [70500, 71500],
        v: [100, 200],
        tv: [7050000, 14300000],
      },
    ],
    indices: [{ id: 'KOSPI', d: ['20261014', '20261015'], o: [2500, 2510], c: [2505, 2515] }],
  };
}

describe('validateMarketData', () => {
  it('정상 파일은 ok다', () => {
    const r = validateMarketData(sample());
    expect(r.ok).toBe(true);
  });

  it('version 3은 version-newer다', () => {
    expect(validateMarketData({ ...sample(), version: 3 })).toEqual({ ok: false, reason: 'version-newer' });
  });

  it('format이 다르거나 객체가 아니면 format이다', () => {
    expect(validateMarketData({ ...sample(), format: 'other' })).toEqual({ ok: false, reason: 'format' });
    expect(validateMarketData(null)).toEqual({ ok: false, reason: 'format' });
    expect(validateMarketData([])).toEqual({ ok: false, reason: 'format' });
  });

  it('o와 c의 길이가 다르면 corrupt다', () => {
    const x = sample();
    x.stocks[0].o = [70000];
    expect(validateMarketData(x)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('날짜가 내림차순이면 corrupt다', () => {
    const x = sample();
    x.stocks[0].d = ['20261015', '20261014'];
    expect(validateMarketData(x)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('c에 0이나 NaN이 있으면 corrupt다', () => {
    const zero = sample();
    zero.stocks[0].c = [70500, 0];
    expect(validateMarketData(zero)).toEqual({ ok: false, reason: 'corrupt' });
    const nan = sample();
    nan.stocks[0].c = [Number.NaN, 71500];
    expect(validateMarketData(nan)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('지수의 o와 c 길이가 다르면 corrupt다', () => {
    const x = sample();
    x.indices[0].o = [2500];
    expect(validateMarketData(x)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it.each([
    ['range가 문자열 쌍이 아님', (x: any) => (x.range = { from: '2026-10-14' })],
    ['collectedAt이 문자열이 아님', (x: any) => (x.collectedAt = 123)],
    ['sectors level이 1~3 밖', (x: any) => (x.sectors[0].level = 4)],
    ['sec가 문자열 3개가 아님', (x: any) => (x.stocks[0].sec = ['0013', ''])],
    ['shares가 음수', (x: any) => (x.stocks[0].shares = -1)],
    ['shares가 NaN', (x: any) => (x.stocks[0].shares = Number.NaN)],
    ['m이 허용값이 아님', (x: any) => (x.stocks[0].m = 'NASDAQ')],
    ['t가 허용값이 아님', (x: any) => (x.stocks[0].t = 'FUND')],
  ])('%s이면 format이다', (_name, mutate) => {
    const x = sample();
    mutate(x);
    expect(validateMarketData(x)).toEqual({ ok: false, reason: 'format' });
  });
});

function sampleV2() {
  return {
    ...sample(),
    version: 2,
    macro: {
      usdkrw: { d: ['20261013', '20261014'], v: [1340.5, 1342.1] },
      wti: { d: ['20261013', '20261014'], v: [-36.98, 60.2] },
    },
    themes: [{ code: '027', name: '2018 신규 상장주', symbols: ['005930'] }],
  };
}

describe('validateMarketData v2', () => {
  it('정상 v2 파일은 ok이고 isV2가 참이다', () => {
    const r = validateMarketData(sampleV2());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(isV2(r.data)).toBe(true);
    }
  });

  it('v1은 여전히 ok이고 isV2가 거짓이다', () => {
    const r = validateMarketData(sample());
    expect(r.ok).toBe(true);
    if (r.ok) expect(isV2(r.data)).toBe(false);
  });

  it('WTI 음수는 ok다', () => {
    const x = sampleV2();
    expect(x.macro.wti.v[0]).toBe(-36.98);
    expect(validateMarketData(x).ok).toBe(true);
  });

  it('빈 macro 계열은 ok다', () => {
    const x = sampleV2();
    x.macro.usdkrw = { d: [], v: [] };
    x.macro.wti = { d: [], v: [] };
    expect(validateMarketData(x).ok).toBe(true);
  });

  it('macro 길이가 맞지 않으면 corrupt다', () => {
    const x = sampleV2();
    x.macro.usdkrw.v = [1340.5];
    expect(validateMarketData(x)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('macro 날짜가 역순이면 corrupt다', () => {
    const x = sampleV2();
    x.macro.wti.d = ['20261014', '20261013'];
    expect(validateMarketData(x)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('환율이 0 이하면 corrupt다', () => {
    const x = sampleV2();
    x.macro.usdkrw.v = [1340.5, 0];
    expect(validateMarketData(x)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('WTI가 NaN이면 corrupt다', () => {
    const x = sampleV2();
    x.macro.wti.v = [60, NaN];
    expect(validateMarketData(x)).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('macro나 themes가 없으면 format이다', () => {
    const a = sampleV2() as Record<string, unknown>;
    delete a.macro;
    expect(validateMarketData(a)).toEqual({ ok: false, reason: 'format' });
    const b = sampleV2() as Record<string, unknown>;
    delete b.themes;
    expect(validateMarketData(b)).toEqual({ ok: false, reason: 'format' });
  });

  it('themes 모양이 틀리면 format이다', () => {
    const x = sampleV2();
    (x.themes[0] as { symbols: unknown }).symbols = 'x';
    expect(validateMarketData(x)).toEqual({ ok: false, reason: 'format' });
  });
});
