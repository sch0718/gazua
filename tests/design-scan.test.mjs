import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { matchBaseline } from '../scripts/design-scan.mjs';

const baseline = JSON.parse(readFileSync(new URL('../scripts/design-scan-baseline.json', import.meta.url), 'utf8'));
const finding = (antipattern, snippet) => ({
  antipattern, name: '검사 지적', severity: 'warning', category: 'design', file: '', line: 0, snippet,
});

test('규칙과 스니펫이 함께 맞아야 기준선이다', () => {
  const entry = { rule: 'tiny', match: '^원본 배지$', class: '취향', reason: '공용 배지예요.' };
  assert.equal(matchBaseline(finding('tiny', '원본 배지'), 'editor', [entry]), entry);
  assert.equal(matchBaseline(finding('other', '원본 배지'), 'editor', [entry]), null);
  assert.equal(matchBaseline(finding('tiny', '새 배지'), 'editor', [entry]), null);
  // 도구가 주는 규칙 ID는 name이 아니라 antipattern이에요.
  assert.equal(matchBaseline({ ...finding('other', '원본 배지'), name: 'tiny' }, 'editor', [entry]), null);
});

test('화면 제한이 있으면 그 화면에서만 맞고, 없으면 모든 화면에서 맞는다', () => {
  const entry = { rule: 'tiny', match: '배지', screens: ['editor'], class: '취향', reason: '작은 배지예요.' };
  assert.equal(matchBaseline(finding('tiny', '배지'), 'editor', [entry]), entry);
  assert.equal(matchBaseline(finding('tiny', '배지'), 'settings', [entry]), null);
  assert.equal(matchBaseline(finding('tiny', '배지'), 'editor', [{ ...entry, screens: [] }]), null);
  const { screens, ...anyScreen } = entry;
  assert.equal(matchBaseline(finding('tiny', '배지'), 'settings', [anyScreen]), anyScreen);
});

test('빈 기준선과 빈 스니펫은 새 지적을 가리지 않는다', () => {
  assert.equal(matchBaseline(finding('tiny', '배지'), 'editor', []), null);
  assert.equal(matchBaseline(finding('undersized-ui-text', ''), 'editor', baseline), null);
});

const known = [
  ['undersized-ui-text', '10px functional text "데모 데이터" (below 11px floor)', 'span.badge.neutral', 'result', '공용 패키지'],
  ['undersized-ui-text', '10px functional text "KRX" (below 11px floor)', 'small.svelte-p48xvx', 'compare-example', '공용 패키지'],
  ['repeating-stripes-gradient', 'repeating-gradient decorative stripes', 'body', 'compare-example', '오탐'],
  ['nested-cards', 'Card inside card', 'section.group.svelte-rp7pby', 'editor-open', '취향'],
  ['first-viewport-column-overflow', 'div.sim.svelte-mrfiws.split opens the page with one column running 415% of the viewport tall', 'div.sim.svelte-mrfiws', 'editor-open', '오탐'],
  ['flat-type-hierarchy', 'Role sizes: body 13px, h3 13px, h2 15px (largest adjacent step 1.15:1; target 1.25:1)', 'body', 'performance', '취향'],
  ['tiny-text', '11px body text', 'p.cmp-note.svelte-10p0zjg', 'templates', '취향'],
];

for (const [rule, snippet, selector, screen, classification] of known) {
  test(`기준선: ${rule} · ${screen} · ${classification}`, () => {
    const result = matchBaseline({ ...finding(rule, snippet), selector }, screen, baseline);
    assert.ok(result);
    assert.equal(result.class, classification);
  });
}

test('같은 규칙이라도 다른 요소·화면의 지적은 가리지 않는다', () => {
  const unrelated = [
    ['undersized-ui-text', '10px functional text "새 경고" (below 11px floor)', 'span.badge.neutral', 'result'],
    ['undersized-ui-text', '10px functional text "KRX" (below 11px floor)', 'small.svelte-p48xvx', 'settings'],
    ['nested-cards', 'Card inside card', 'div.card.svelte-abc', 'editor-open'],
    ['tiny-text', '11px body text', 'p.note.svelte-abc', 'templates'],
    ['repeating-stripes-gradient', 'repeating-gradient decorative stripes', 'body', 'settings'],
  ];
  for (const [rule, snippet, selector, screen] of unrelated) {
    assert.equal(matchBaseline({ ...finding(rule, snippet), selector }, screen, baseline), null, `${selector} ${snippet}`);
  }
});
