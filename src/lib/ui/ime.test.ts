import { describe, expect, it } from 'vitest';
import { isImeComposing } from './ime';

const key = (init: Partial<KeyboardEvent>) => ({ key: 'Enter', isComposing: false, keyCode: 13, ...init }) as KeyboardEvent;

describe('isImeComposing', () => {
  it('is false for a plain Enter', () => {
    expect(isImeComposing(key({}))).toBe(false);
  });

  it('is true while composing', () => {
    expect(isImeComposing(key({ isComposing: true }))).toBe(true);
  });

  it('is true for the keyCode 229 Enter Safari sends after compositionend', () => {
    expect(isImeComposing(key({ keyCode: 229 }))).toBe(true);
  });
});
