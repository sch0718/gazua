// 공유 대화상자 상태. 그룹·전략·선정 기준 화면이 요청하고, App의 ShareHost가 대화상자를 그린다.
// 동기화 설정이 없거나 로그인하지 않았으면 공유 버튼을 숨긴다(canShare).
import type { SyncController } from '../sync/controller.svelte';
import type { ShareKind, ShareSnapshot } from './snapshot';

export interface ShareRequest {
  kind: ShareKind;
  /** 대화상자 제목에 쓸 이름 */
  name: string;
  profileId: string;
  /** 가상 자금 빼기 여부를 받아 보낼 스냅샷을 만든다(그룹은 무시). */
  build(hideCapital: boolean): ShareSnapshot;
}

let controller = $state<SyncController | null>(null);
let request = $state<ShareRequest | null>(null);

export function setShareController(c: SyncController | null): void {
  controller = c;
}

export function shareController(): SyncController | null {
  return controller;
}

export function canShare(): boolean {
  return controller?.account != null;
}

export function openShare(r: ShareRequest): void {
  if (canShare()) request = r;
}

export function currentShare(): ShareRequest | null {
  return request;
}

export function closeShare(): void {
  request = null;
}
