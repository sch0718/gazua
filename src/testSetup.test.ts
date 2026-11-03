import { describe, expect, it, vi } from 'vitest';

// src/testSetup.ts가 테스트마다 진짜 매크로태스크에 한 번 양보하는지 본다.
// 양보가 없으면 동기 테스트만 60초 넘게 이어질 때 워커가 onTaskUpdate 응답을 읽지 못해
// "Timeout calling onTaskUpdate" 오류가 난다. 네 테스트는 바로 앞 테스트가 같은 파일에서
// 돌았다는 순서에 기대므로 -t로 하나만 고르면 실패할 수 있다.
const realSetTimeout = globalThis.setTimeout;

describe.sequential('테스트마다 매크로태스크에 양보한다', () => {
  let fired = false;
  let firedAfterFake = false;

  it('진짜 타이머를 걸고 동기로 끝난다', () => {
    realSetTimeout(() => {
      fired = true;
    }, 0);
  });

  it('앞 테스트와 이 테스트 사이에 그 타이머가 돌았다', () => {
    expect(fired).toBe(true);
  });

  it('가짜 타이머를 켠 채 끝나도 양보가 멈추지 않는다', () => {
    realSetTimeout(() => {
      firedAfterFake = true;
    }, 0);
    vi.useFakeTimers();
  });

  it('가짜 타이머를 켠 테스트 뒤에도 그 타이머가 돌았다', () => {
    vi.useRealTimers();
    expect(firedAfterFake).toBe(true);
  });
});
