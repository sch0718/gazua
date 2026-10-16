import { describe, expect, it } from 'vitest';
import { hasMacroFormat, isV3, validateMarketData } from './format';

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

  it('version 4는 version-newer다', () => {
    expect(validateMarketData({ ...sample(), version: 4 })).toEqual({ ok: false, reason: 'version-newer' });
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
  it('정상 v2 파일은 ok이고 hasMacroFormat이 참, isV3는 거짓이다', () => {
    const r = validateMarketData(sampleV2());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(hasMacroFormat(r.data)).toBe(true);
      expect(isV3(r.data)).toBe(false);
    }
  });

  it('v1은 여전히 ok이고 hasMacroFormat이 거짓이다', () => {
    const r = validateMarketData(sample());
    expect(r.ok).toBe(true);
    if (r.ok) expect(hasMacroFormat(r.data)).toBe(false);
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

function sampleV3(flow?: unknown) {
  const x = sampleV2() as Record<string, any>;
  x.version = 3;
  if (flow !== undefined) x.stocks[0].flow = flow;
  return x;
}

describe('validateMarketData v3', () => {
  it('정상 v3 파일은 ok이고 isV3·hasMacroFormat이 참이다', () => {
    const r = validateMarketData(sampleV3({ from: '20261014', f: [1, -2], i: [3, 4], p: [-4, -2] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(isV3(r.data)).toBe(true);
      expect(hasMacroFormat(r.data)).toBe(true);
    }
  });

  it('v1은 hasMacroFormat이 거짓, v2는 참이다', () => {
    const a = validateMarketData(sample());
    const b = validateMarketData(sampleV2());
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(hasMacroFormat(a.data)).toBe(false);
      expect(hasMacroFormat(b.data)).toBe(true);
    }
  });

  it('v3에서 macro가 없으면 format이다', () => {
    const x = sampleV3();
    delete x.macro;
    expect(validateMarketData(x)).toEqual({ ok: false, reason: 'format' });
  });

  it('v3에서 themes가 없으면 format이다', () => {
    const x = sampleV3();
    delete x.themes;
    expect(validateMarketData(x)).toEqual({ ok: false, reason: 'format' });
  });

  it('v3에서 macro가 깨지면 v2와 같은 이유(corrupt)다', () => {
    const v2 = sampleV2();
    v2.macro.usdkrw.v = [1340.5, 0];
    const v3 = sampleV3();
    v3.macro.usdkrw.v = [1340.5, 0];
    const r2 = validateMarketData(v2);
    expect(r2).toEqual({ ok: false, reason: 'corrupt' });
    expect(validateMarketData(v3)).toEqual(r2);
  });

  it('수급 끝이 마지막 일봉보다 앞서도 ok다', () => {
    expect(validateMarketData(sampleV3({ from: '20261014', f: [1], i: [1], p: [1] })).ok).toBe(true);
  });

  it('flow가 없는 종목도 ok다', () => {
    expect(validateMarketData(sampleV3()).ok).toBe(true);
  });

  it.each([
    ['from이 d에 없음', { from: '20261013', f: [1], i: [1], p: [1] }],
    ['길이 불일치', { from: '20261014', f: [1, 2], i: [1], p: [1, 2] }],
    ['from 위치+길이가 d를 넘음', { from: '20261015', f: [1, 2], i: [1, 2], p: [1, 2] }],
    ['빈 배열', { from: '20261014', f: [], i: [], p: [] }],
    ['소수', { from: '20261014', f: [1.5], i: [1], p: [1] }],
    ['NaN', { from: '20261014', f: [NaN], i: [1], p: [1] }],
  ])('%s이면 corrupt다', (_n, flow) => {
    const r = validateMarketData(sampleV3(flow));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('corrupt');
  });

  it('version 4는 version-newer다', () => {
    const x = sampleV3();
    x.version = 4;
    const r = validateMarketData(x);
    expect(!r.ok && r.reason).toBe('version-newer');
  });

  it('v1·v2는 여전히 ok다', () => {
    expect(validateMarketData(sample()).ok).toBe(true);
    expect(validateMarketData(sampleV2()).ok).toBe(true);
  });
});
