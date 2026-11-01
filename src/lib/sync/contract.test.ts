// Worker 공용 경로 계약(전략 빌더 §8.7 N4). PR②는 이 판정을 바꾸지 않는다. 깨지면 그 변경을 멈추고 「PR①-b 필요」로 알린다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkShareSnapshot, strategySnapshot } from '../share/snapshot';
import { sanitizeCriteria } from '../screen/validate';
import { fullStrategyV2 } from '../sim/testStrategyV2';
import { fromTemplate, TEMPLATES } from '../sim/templates';
import { checkProfileDoc } from './dto';
import { exceedsDepth, findForbidden } from './forbidden';

const fx = JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', 'contract-v1.json'), 'utf8'));

describe('Worker 공용 경로 계약', () => {
  it('v1 문서는 통과하고 원본을 돌려준다', () => {
    const r = checkProfileDoc(fx.doc, fx.now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc).toBe(fx.doc);
  });
  it('v1 문서의 기준은 정리해도 그대로다(sanitizeCriteria 무변화)', () => {
    expect(sanitizeCriteria({ criteria: fx.doc.criteria }, fx.now)).toEqual({ criteria: fx.doc.criteria, repaired: false });
  });
  it('v2 문서는 통과하고 원본을 돌려준다', () => {
    const d = { ...fx.doc, v: 2, strategies: [fullStrategyV2()] };
    const r = checkProfileDoc(d, fx.now);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc).toBe(d);
  });
  it('v1 전략·시뮬레이션 공유(create)는 통과하고 원본을 돌려준다', () => {
    const a = checkShareSnapshot(fx.share, 'strategy', fx.now, 'create');
    expect(a).toEqual({ ok: true, snapshot: fx.share });
    const b = checkShareSnapshot(fx.sim, 'simResult', fx.now, 'create');
    expect(b).toEqual({ ok: true, snapshot: fx.sim });
  });
  it('v2 전략 공유(create)는 통과하고 원본을 돌려준다', () => {
    const raw = { kind: 'strategy', v: 2, title: '골든', strategy: { ...fullStrategyV2(), id: 'shared', name: '골든', updatedAt: 0, universe: { kind: 'symbols', symbols: ['005930'] } }, capitalHidden: false };
    expect(checkShareSnapshot(raw, 'strategy', fx.now, 'create')).toEqual({ ok: true, snapshot: raw });
  });
  it('v3 문서·공유는 unsupported', () => {
    expect(checkProfileDoc({ ...fx.doc, v: 3 }, fx.now)).toMatchObject({ ok: false, code: 'unsupported' });
    expect(checkShareSnapshot({ ...fx.share, v: 3 }, 'strategy', fx.now, 'create')).toMatchObject({ ok: false, code: 'unsupported' });
  });
  it('거절 사례는 지금과 같은 코드로 거절한다', () => {
    // v2 문서에 v1 전략이 섞이면 unknown-field
    expect(checkProfileDoc({ ...fx.doc, v: 2 }, fx.now)).toMatchObject({ ok: false, code: 'unknown-field' });
    // v1 문서의 전략에 고칠 값이 있으면 invalid
    const bad = structuredClone(fx.doc);
    bad.strategies[0].capital.perBuyPct = 500;
    expect(checkProfileDoc(bad, fx.now)).toMatchObject({ ok: false, code: 'invalid', path: 'strategies[0].capital.perBuyPct' });
    // 금지 키가 있으면 forbidden-field
    expect(checkProfileDoc({ ...fx.doc, appSecret: 'x' }, fx.now)).toMatchObject({ ok: false, code: 'forbidden-field' });
  });
  it('v2 문서는 금지 키·깊이에 걸리지 않는다', () => {
    const d = { ...fx.doc, v: 2, strategies: [fullStrategyV2()] };
    expect(findForbidden(d)).toBeNull();
    expect(exceedsDepth(d)).toBe(false);
  });
});

describe('지금 앱이 만든 v2 문서·공유는 Worker 검사를 통과한다(N4)', () => {
  it('템플릿 3개와 한도까지 채운 전략', () => {
    const strategies = [...TEMPLATES.map((t, i) => ({ ...fromTemplate(t, fx.now, 'g0', t.name), id: `t${i}` })), { ...fullStrategyV2(), id: 'full' }];
    const doc = { ...fx.doc, v: 2, strategies };
    const r = checkProfileDoc(doc, fx.now);
    expect(r.ok).toBe(true);
    for (const s of strategies) {
      const snap = strategySnapshot({ ...s, universe: { kind: 'symbols', symbols: ['005930'] } }, { groups: [] }, { hideCapital: false, now: fx.now });
      expect(snap.v).toBe(2);
      expect(checkShareSnapshot(snap, 'strategy', fx.now, 'create')).toEqual({ ok: true, snapshot: snap });
    }
  });
});
