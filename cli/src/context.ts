import type { Args } from './args';
import type { Redactor } from './output';

/** 명령 하나가 받는 것. 시계·잠·네트워크를 주입받아 테스트에서 바꿔 끼운다 */
export interface Ctx {
  args: Args;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  hostname: () => string;
  /** 저장 파일 디렉터리(~/.config/gazua) */
  dir: string;
  /** 사람이 읽을 안내(표준 오류, 늘 나간다) */
  say: (line: string) => void;
  /** 진행 로그(표준 오류, --verbose일 때만) */
  log: (line: string) => void;
  /** 결과의 warnings에 붙는다 */
  warn: (message: string) => void;
  redact: Redactor;
}

/** 돌려준 값이 { ok: true, data }의 data가 된다. 실패는 CliError를 던진다 */
export type Command = (ctx: Ctx) => Promise<unknown>;

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number): Promise<void>;
  hostname(): string;
  /** 저장 디렉터리 덮어쓰기(테스트) */
  dir?: string;
}
