import { beforeEach } from 'vitest';

// vitest 워커는 테스트 사이에 매크로태스크로 양보하지 않는다. 동기 테스트만 60초 넘게
// 이어지면 메인 프로세스의 onTaskUpdate 응답을 읽지 못하고, 그사이 birpc 60초 타이머가
// 먼저 돌아 "Timeout calling onTaskUpdate" 오류가 난다. 테스트마다 한 번 양보해 응답을 읽게 한다.
// afterEach가 아니라 beforeEach 정리 함수로 두어 testing-library 자동 cleanup까지 끝난 뒤에 돌게 하고,
// vi.useFakeTimers()가 전역 setTimeout을 바꿔도 멈추지 않게 모듈을 읽을 때의 진짜 setTimeout을 쓴다.
// 테스트 파일의 beforeEach·afterEach가 던진 테스트 뒤에는 vitest가 정리 함수를 부르지 않아 양보도 건너뛴다.
const realSetTimeout = globalThis.setTimeout;

beforeEach(() => () => new Promise<void>((resolve) => realSetTimeout(resolve, 0)));
