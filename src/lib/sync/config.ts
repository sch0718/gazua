// 동기화 설정 읽기는 @sch0718/firebase-session/client가 한다. 가즈아는 Vite 환경값을 넘긴다.
import { readSyncConfig as read, type SyncConfig } from '@sch0718/firebase-session/client';

export type { SyncConfig };

export function readSyncConfig(
  env: Record<string, string | boolean | undefined> = import.meta.env,
): SyncConfig | null {
  return read(env);
}
