import { describe, expect, it } from 'vitest';
import { exceedsDepth, findForbidden, JSON_DEPTH_MAX, jsonDiff } from './forbidden';

/** 깊이 n의 중첩 객체: 가장 안쪽 객체가 깊이 n이다(루트 0). */
function nest(n: number, leaf: Record<string, unknown> = {}): Record<string, unknown> {
  let v: Record<string, unknown> = leaf;
  for (let i = 0; i < n; i++) v = { a: v };
  return v;
}

describe('jsonDiff ignoreMissing', () => {
  it('기본은 b에만 있는 키를 value 차이로 본다(지금 동작 그대로)', () => {
    expect(jsonDiff({ a: 1 }, { a: 1, b: 2 })).toEqual({ path: 'b', kind: 'value' });
    expect(jsonDiff({ a: 1, c: 3 }, { a: 1 })).toEqual({ path: 'c', kind: 'extra' });
  });

  it('켜면 b에만 있는 키는 건너뛰고 나머지 비교를 이어 간다', () => {
    expect(jsonDiff({ a: 1 }, { a: 1, b: 2 }, '', { ignoreMissing: true })).toBeNull();
    expect(jsonDiff({ x: { a: 1 } }, { x: { a: 1, b: [1] } }, 's', { ignoreMissing: true })).toBeNull();
    expect(jsonDiff({ a: 1, c: 3 }, { a: 1, b: 2 }, '', { ignoreMissing: true })).toEqual({ path: 'c', kind: 'extra' });
    expect(jsonDiff({ x: { a: 2 } }, { x: { a: 1, b: 2 } }, '', { ignoreMissing: true })).toEqual({ path: 'x.a', kind: 'value' });
    expect(jsonDiff([1], [1, 2], '', { ignoreMissing: true })).toEqual({ path: '', kind: 'value' });
  });
});

describe('깊이 상한', () => {
  it('깊이 32 객체 안의 같은 원시값은 차이가 없다', () => {
    expect(jsonDiff(nest(32, { k: 1 }), nest(32, { k: 1 }))).toBeNull();
  });

  it('깊이 32 객체 안의 다른 원시값은 value 차이다', () => {
    expect(jsonDiff(nest(32, { k: 1 }), nest(32, { k: 2 }))).toEqual({
      path: `${Array(32).fill('a').join('.')}.k`, kind: 'value',
    });
  });

  it('깊이 32 배열 안의 같은 원시값은 차이가 없다', () => {
    expect(jsonDiff(nest(31, { k: [1] }), nest(31, { k: [1] }))).toBeNull();
  });

  it('깊이 32 배열 안의 다른 원시값은 value 차이다', () => {
    expect(jsonDiff(nest(31, { k: [1] }), nest(31, { k: [2] }))).toEqual({
      path: `${Array(31).fill('a').join('.')}.k[0]`, kind: 'value',
    });
  });

  it('금지 키가 깊이 상한 밖에 있어도 예외 없이 그 전에 거절한다', () => {
    const deep = nest(40, { token: 1 });
    expect(() => findForbidden(deep)).not.toThrow();
    expect(findForbidden(deep)).toBe(Array(33).fill('a').join('.'));
  });

  it(`깊이 ${JSON_DEPTH_MAX}까지는 괜찮고 넘으면 exceedsDepth`, () => {
    expect(JSON_DEPTH_MAX).toBe(32);
    expect(exceedsDepth(nest(32))).toBe(false);
    expect(exceedsDepth(nest(33))).toBe(true);
    expect(exceedsDepth([[[[1]]]], 3)).toBe(false);
    expect(exceedsDepth([[[[[1]]]]], 3)).toBe(true);
    expect(exceedsDepth('x')).toBe(false);
  });

  it('깊이 1,000이어도 예외 없이 끝난다', () => {
    const deep = nest(1000);
    expect(exceedsDepth(deep)).toBe(true);
    expect(() => findForbidden(deep)).not.toThrow();
    expect(findForbidden(deep)).toBe(Array(33).fill('a').join('.'));
    expect(() => jsonDiff(deep, nest(1000))).not.toThrow();
    expect(jsonDiff(deep, nest(1000))?.kind).toBe('value');
  });

  it('얕은 곳의 금지 키는 그대로 찾는다', () => {
    expect(findForbidden({ a: [{ b: { token: 1 } }] })).toBe('a[0].b.token');
  });
});
