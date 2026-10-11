import { describe, expect, it, vi } from 'vitest';
import { loadUniverse, matchSpan, searchUniverse, toChosung, type UniverseItem } from './universe';

const items: UniverseItem[] = [
  { s: '000660', n: 'SK하이닉스', m: 'KOSPI', t: 'STOCK' },
  { s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK' },
  { s: '005935', n: '삼성전자우', m: 'KOSPI', t: 'STOCK' },
  { s: '028300', n: '삼성SDI', m: 'KOSPI', t: 'STOCK' },
  { s: '069500', n: 'KODEX 200', m: 'KOSPI', t: 'ETF' },
  { s: '042700', n: '한미반도체', m: 'KOSPI', t: 'STOCK' },
  { s: '247540', n: '에코프로비엠', m: 'KOSDAQ', t: 'STOCK' },
];

describe('toChosung', () => {
  it('extracts initial consonants and keeps non-syllable characters', () => {
    expect(toChosung('삼성전자')).toBe('ㅅㅅㅈㅈ');
    expect(toChosung('SK하이닉스')).toBe('SKㅎㅇㄴㅅ');
    expect(toChosung('KODEX 200')).toBe('KODEX 200');
  });
});

describe('searchUniverse', () => {
  it('matches a chosung query', () => {
    expect(searchUniverse(items, 'ㅅㅅㅈㅈ')[0].s).toBe('005930');
    expect(searchUniverse(items, 'ㅎㅁ').map((i) => i.n)).toContain('한미반도체');
  });

  it('matches by code prefix', () => {
    expect(searchUniverse(items, '0059')[0].s).toBe('005930');
  });

  it('matches mixed syllables and chosung position-wise', () => {
    expect(searchUniverse(items, '삼ㅅ')[0].n).toBe('삼성전자');
  });

  it('ignores case for Latin letters', () => {
    expect(searchUniverse(items, 'kodex')[0].n).toBe('KODEX 200');
  });

  it('ranks name prefix above name contains, shorter names first on ties', () => {
    expect(searchUniverse(items, '삼성').map((i) => i.s)).toEqual(['005930', '005935', '028300']);
    expect(searchUniverse(items, '전자').map((i) => i.s)).toEqual(['005930', '005935']);
  });

  it('ranks code match above name prefix', () => {
    const pool: UniverseItem[] = [
      { s: '999999', n: '0001 테스트', m: 'KOSPI', t: 'STOCK' },
      { s: '000100', n: '아주긴이름의종목', m: 'KOSPI', t: 'STOCK' },
    ];
    expect(searchUniverse(pool, '0001').map((i) => i.s)).toEqual(['000100', '999999']);
  });

  it('ranks name prefix above chosung prefix above chosung contains', () => {
    const pool: UniverseItem[] = [
      { s: '000001', n: '가삼성', m: 'KOSPI', t: 'STOCK' },
      { s: '000002', n: '삼성전자우선', m: 'KOSPI', t: 'STOCK' },
      { s: '000003', n: '삼ㅅ물산그룹', m: 'KOSPI', t: 'STOCK' },
    ];
    expect(searchUniverse(pool, '삼ㅅ').map((i) => i.s)).toEqual(['000003', '000002', '000001']);
    expect(searchUniverse(pool, 'ㅅㅅ').map((i) => i.s)).toEqual(['000002', '000003', '000001']);
  });

  it('ranks name contains above chosung contains', () => {
    const pool: UniverseItem[] = [
      { s: '000001', n: '가삼성', m: 'KOSPI', t: 'STOCK' },
      { s: '000002', n: '가나삼ㅅ', m: 'KOSPI', t: 'STOCK' },
    ];
    expect(searchUniverse(pool, '삼ㅅ').map((i) => i.s)).toEqual(['000002', '000001']);
  });

  it('matches chosung inside the name after the prefix', () => {
    expect(searchUniverse(items, 'ㅈㅈ').map((i) => i.s)).toEqual(['005930', '005935']);
  });

  it('returns [] for an empty or blank query', () => {
    expect(searchUniverse(items, '')).toEqual([]);
    expect(searchUniverse(items, '   ')).toEqual([]);
  });

  it('trims the query and respects the limit', () => {
    expect(searchUniverse(items, '  삼성  ').length).toBe(3);
    expect(searchUniverse(items, '삼성', 2).length).toBe(2);
    const many = Array.from({ length: 50 }, (_, i) => ({ s: String(100000 + i), n: `테스트${i}`, m: 'KOSPI', t: 'STOCK' as const }));
    expect(searchUniverse(many, '테스트')).toHaveLength(30);
  });
});

describe('loadUniverse', () => {
  it('fetches universe.json from the base URL', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(items)));
    await expect(loadUniverse(fetchImpl as unknown as typeof fetch)).resolves.toEqual(items);
    expect(fetchImpl).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}universe.json`);
  });

  it('throws when the payload is not an array', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ nope: true }));
    await expect(loadUniverse(fetchImpl as unknown as typeof fetch)).rejects.toThrow();
  });

  it('throws on HTTP errors', async () => {
    const fetchImpl = async () => new Response('x', { status: 404 });
    await expect(loadUniverse(fetchImpl as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe('matchSpan', () => {
  it('finds where a name, chosung or mixed query matches, for highlighting', () => {
    expect(matchSpan('한미반도체', 'ㅎㅁ')).toEqual({ start: 0, length: 2 });
    expect(matchSpan('한미반도체', '반도')).toEqual({ start: 2, length: 2 });
    expect(matchSpan('SK하이닉스', 'sk')).toEqual({ start: 0, length: 2 });
    expect(matchSpan('삼성전자', ' ㅈㅈ ')).toEqual({ start: 2, length: 2 });
  });

  it('returns null when only the code matched or the query is blank', () => {
    expect(matchSpan('삼성전자', '0059')).toBeNull();
    expect(matchSpan('삼성전자', '  ')).toBeNull();
  });
});
