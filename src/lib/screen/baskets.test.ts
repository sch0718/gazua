import { describe, expect, it } from 'vitest';
import { createSafeStorage } from '../state/storage';
import { memoryBacking, seed } from '../state/testStorage';
import { profileKeys } from '../state/profileStore';
import { loadCriteria } from './criteriaStore';
import { BASKET_CAP_MESSAGE, BASKET_SYMBOLS_MAX, MAX_BASKETS, assertBasketCap, assertBasketsWritable, loadBaskets, newBasket, sanitizeBaskets, saveBaskets } from './baskets';

const NOW = 1_700_000_000_000;
const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ ...newBasket(NOW, `묶음 ${i}`, ['005930']), id: `b${i}` }));

describe('baskets', () => {
  it('키는 p:<id>:baskets이고 한도는 30, 종목은 300', () => {
    expect(profileKeys.baskets('p1')).toBe('p:p1:baskets');
    expect(MAX_BASKETS).toBe(30);
    expect(BASKET_SYMBOLS_MAX).toBe(300);
  });

  it('저장 후 다시 읽으면 같다', () => {
    const st = createSafeStorage(memoryBacking());
    const list = mk(2);
    saveBaskets(st, 'p1', list);
    expect(loadBaskets(st, 'p1')).toEqual(list);
  });

  it('없으면 빈 목록이고 배너를 올리지 않는다', () => {
    const st = createSafeStorage(memoryBacking());
    expect(loadBaskets(st, 'p1')).toEqual([]);
    expect(st.issues).toEqual([]);
  });

  it('깨진 JSON이나 모양이 틀린 값이면 []로 읽고 배너 키를 보고한다', () => {
    const backing = memoryBacking();
    seed(backing, profileKeys.baskets('p1'), '{not json');
    seed(backing, profileKeys.baskets('p2'), { baskets: 'x' });
    const st = createSafeStorage(backing);
    expect(loadBaskets(st, 'p1')).toEqual([]);
    expect(loadBaskets(st, 'p2')).toEqual([]);
    expect(st.issues.filter((i) => i.kind === 'corrupt')).toHaveLength(2);
  });

  it('깨진 항목은 고쳐 읽고 알리되 저장된 값은 덮어쓰지 않는다', () => {
    const backing = memoryBacking();
    const raw = { baskets: [{ ...mk(1)[0], symbols: ['005930', 'bad'] }, { id: '', name: 'x', symbols: ['005930'] }] };
    seed(backing, profileKeys.baskets('p1'), raw);
    const st = createSafeStorage(backing);
    const out = loadBaskets(st, 'p1');
    expect(out).toHaveLength(1);
    expect(out[0].symbols).toEqual(['005930']);
    expect(st.issues.some((i) => i.kind === 'corrupt' && i.key === profileKeys.baskets('p1'))).toBe(true);
    expect(JSON.parse(backing.getItem(`gazua:v1:${profileKeys.baskets('p1')}`)!)).toEqual(raw);
  });

  it('31개면 던지고 저장하지 않는다', () => {
    const st = createSafeStorage(memoryBacking());
    expect(() => assertBasketCap(mk(30))).not.toThrow();
    expect(() => saveBaskets(st, 'p1', mk(31))).toThrow(BASKET_CAP_MESSAGE);
    expect(BASKET_CAP_MESSAGE).toBe('내 묶음은 30개까지 저장할 수 있어요');
    expect(loadBaskets(st, 'p1')).toEqual([]);
  });

  it('이름은 30자로 자르고 고침으로 센다', () => {
    const r = sanitizeBaskets({ baskets: [{ ...mk(1)[0], name: '가'.repeat(31) }] });
    expect(r.baskets[0].name).toBe('가'.repeat(30));
    expect(r.repaired).toBe(true);
    expect(sanitizeBaskets({ baskets: [{ ...mk(1)[0], name: '가'.repeat(30) }] }).repaired).toBe(false);
  });

  it('종목은 6자 [0-9A-Z]만, 중복 없이, 300개까지', () => {
    const many = Array.from({ length: 301 }, (_, i) => String(100000 + i));
    const r = sanitizeBaskets({ baskets: [{ ...mk(1)[0], symbols: many }] });
    expect(r.baskets[0].symbols).toHaveLength(300);
    expect(r.repaired).toBe(true);
    const r2 = sanitizeBaskets({ baskets: [{ ...mk(1)[0], symbols: ['005930', '005930', '12345', 'abcdef', '0000D0', 7] }] });
    expect(r2.baskets[0].symbols).toEqual(['005930', '0000D0']);
    expect(r2.repaired).toBe(true);
    expect(sanitizeBaskets({ baskets: [{ ...mk(1)[0], symbols: many.slice(0, 300) }] }).repaired).toBe(false);
  });

  it('종목이 하나도 남지 않으면 그 묶음은 버린다', () => {
    const r = sanitizeBaskets({ baskets: [{ ...mk(1)[0], symbols: [] }] });
    expect(r).toEqual({ baskets: [], repaired: true });
  });

  it('id가 겹치거나 30개를 넘는 항목은 버린다', () => {
    const r = sanitizeBaskets({ baskets: [...mk(31), mk(1)[0]] });
    expect(r.baskets).toHaveLength(30);
    expect(r.repaired).toBe(true);
  });

  it('루트가 없으면 조용히 빈 목록(baskets 칸이 없는 이전 내보내기 파일)', () => {
    expect(sanitizeBaskets({})).toEqual({ baskets: [], repaired: false });
    expect(sanitizeBaskets(null)).toEqual({ baskets: [], repaired: false });
  });

  it('저장소의 {}는 손상으로 알린다(앱은 늘 { baskets: [...] }로 쓰므로). 선정 기준 저장소와 같은 판단이다', () => {
    const backing = memoryBacking();
    seed(backing, profileKeys.baskets('p1'), {});
    seed(backing, profileKeys.criteria('p1'), {});
    const st = createSafeStorage(backing);
    expect(loadBaskets(st, 'p1')).toEqual([]);
    expect(loadCriteria(st, 'p1')).toEqual([]);
    expect(st.issues.filter((i) => i.kind === 'corrupt').map((i) => i.key).sort()).toEqual([profileKeys.baskets('p1'), profileKeys.criteria('p1')].sort());
  });

  it('쓸 때 종목이 없거나 300개를 넘거나 이름이 30자를 넘으면 던지고 쓰지 않는다', () => {
    const st = createSafeStorage(memoryBacking());
    const b = mk(1)[0];
    expect(() => saveBaskets(st, 'p1', [{ ...b, symbols: [] }])).toThrow('묶음에는 종목이 1개 이상 있어야 해요');
    const many = Array.from({ length: 301 }, (_, i) => String(100000 + i));
    expect(() => saveBaskets(st, 'p1', [{ ...b, symbols: many }])).toThrow('묶음의 종목은 300개까지예요');
    expect(() => saveBaskets(st, 'p1', [{ ...b, name: '가'.repeat(31) }])).toThrow('묶음 이름은 30자까지예요');
    expect(loadBaskets(st, 'p1')).toEqual([]);
    expect(st.issues).toEqual([]);
    expect(() => saveBaskets(st, 'p1', [{ ...b, name: '가'.repeat(30), symbols: many.slice(0, 300) }])).not.toThrow();
  });

  it('쓰기 전 검사: 형식이 틀린 종목 코드와 묶음 안 중복 종목을 거절한다', () => {
    const ok = { id: 'b', name: '묶음', updatedAt: 1, symbols: ['005930', '0000D0'] };
    expect(() => assertBasketsWritable([ok])).not.toThrow();
    for (const bad of ['5930', 'abcdef', '00593A0', '005 30', '']) {
      expect(() => assertBasketsWritable([{ ...ok, symbols: ['005930', bad] }])).toThrow('종목 코드는 숫자·영문 대문자 6자');
    }
    expect(() => assertBasketsWritable([{ ...ok, symbols: ['005930', '000660', '005930'] }])).toThrow('같은 종목이 두 번');
    // 다른 묶음끼리 겹치는 것은 괜찮다
    expect(() => assertBasketsWritable([ok, { ...ok, id: 'c' }])).not.toThrow();
  });
});
