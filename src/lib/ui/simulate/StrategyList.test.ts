// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, expect, it } from 'vitest';
import type { App } from '../../state/app.svelte';
import { kstEpoch } from '../../time/kst';
import { makeTestApp, itemsOf } from '../../../sheets/testApp';
import StrategyList from './StrategyList.svelte';

const NOW = kstEpoch('2026-10-12', '10:00:00');
let app: App;
afterEach(() => app?.destroy());

it('새 전략: 템플릿을 고르면 그 규칙으로 만들고 편집으로 간다', async () => {
  app = makeTestApp({ groups: [{ id: 'g1', name: '반도체', items: itemsOf(['005930']) }], now: NOW });
  render(StrategyList, { app });
  await fireEvent.click(screen.getAllByRole('button', { name: '＋ 새 전략' })[0]);
  expect(app.strategies).toHaveLength(0);
  await fireEvent.click(screen.getByRole('button', { name: /RSI\(2\) 눌림목/ }));
  expect(app.strategies).toHaveLength(1);
  expect(app.strategies[0].rules.buy[0].conds[0]).toEqual({ kind: 'rsi', period: 2, level: 10, op: 'below' });
  expect(app.route).toEqual({ name: 'simulate', strategyId: app.strategies[0].id });
});
