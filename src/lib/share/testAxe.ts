// 테스트 전용: jsdom에서 axe를 돌린다. e2e(tests/e2e/a11y.spec.ts)와 같은 태그만 보고, jsdom은 색을 계산하지 않으므로 대비 규칙은 끈다.
import axe from 'axe-core';
import { expect } from 'vitest';

export async function expectNoAxeViolations(container: Element): Promise<void> {
  const r = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' ; ')}`)).toEqual([]);
}
