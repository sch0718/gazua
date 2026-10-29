import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('소셜 콜백 문서', () => {
  it('앱 문서에 리퍼러 차단 한 줄만 더한다', () => {
    const main = readFileSync('index.html', 'utf8');
    const callback = readFileSync('auth/callback/index.html', 'utf8');
    const meta = '    <meta name="referrer" content="no-referrer" />\n';
    expect(callback.split(meta)).toHaveLength(2);
    expect(callback.replace(meta, '')).toBe(main);
    expect(callback.indexOf(meta)).toBeLessThan(callback.search(/<(link|script)\b/));
    expect(callback).toContain('<meta charset="UTF-8" />\n' + meta);
    for (const html of [main, callback]) expect(html).not.toMatch(/form-action|navigate-to/);
  });
});
