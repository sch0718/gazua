import { describe, expect, it } from 'vitest';
import { mergeDraft } from './draftMerge';

describe('mergeDraft', () => {
  it('takes remote values for sections not edited locally and keeps locally edited sections', () => {
    const base = { name: 'a', capital: { initial: 1 }, entry: { level: 'B' }, updatedAt: 1 };
    const draft = { name: 'a', capital: { initial: 1 }, entry: { level: 'A' }, updatedAt: 1 };
    const remote = { name: 'b', capital: { initial: 5 }, entry: { level: 'B' }, updatedAt: 9 };
    expect(mergeDraft(base, draft, remote)).toEqual({ name: 'b', capital: { initial: 5 }, entry: { level: 'A' }, updatedAt: 9 });
  });

  it('merges nested objects field by field and treats arrays as one value', () => {
    const base = { conditions: { a: { on: false, v: 1 }, b: { on: true } }, list: [1, 2] };
    const draft = { conditions: { a: { on: true, v: 1 }, b: { on: true } }, list: [1, 2] };
    const remote = { conditions: { a: { on: false, v: 1 }, b: { on: false } }, list: [3] };
    expect(mergeDraft(base, draft, remote)).toEqual({ conditions: { a: { on: true, v: 1 }, b: { on: false } }, list: [3] });
  });
});

