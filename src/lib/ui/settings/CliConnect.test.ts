// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../../share/testAxe';
import type { CliApproveResult, SyncController } from '../../sync/controller.svelte';
import CliConnect from './CliConnect.svelte';

afterEach(cleanup);
const NOW = Date.UTC(2026, 10, 1, 3, 2, 0);
const found = (geo: string | null = 'KR · Seoul'): CliApproveResult => ({ ok: true, info: { label: 'gazua@macbook', createdAt: NOW - 120_000, geo, scope: 'read' } });
function setup(handler: (code: string, approve?: boolean) => CliApproveResult) {
  const cliApprove = vi.fn(async (code: string, approve?: boolean) => handler(code, approve));
  const sync = { cliApprove } as unknown as SyncController;
  const view = render(CliConnect, { sync, now: () => NOW });
  return { cliApprove, ...view };
}
const input = () => screen.getByLabelText('CLI 코드') as HTMLInputElement;
const type = (value: string) => fireEvent.input(input(), { target: { value } });
const confirmBtn = () => screen.getByRole('button', { name: '확인' }) as HTMLButtonElement;
const body = () => document.body.textContent ?? '';

describe('CliConnect', () => {
  it('소문자·하이픈 없는 입력을 XXXX-XXXX로 보이고, 8자가 되기 전에는 확인이 꺼져 있다', async () => {
    setup(() => found());
    await type('bcdfghj');
    expect(input().value).toBe('BCDF-GHJ');
    expect(confirmBtn().disabled).toBe(true);
    await type('bcdfghjk');
    expect(input().value).toBe('BCDF-GHJK');
    expect(confirmBtn().disabled).toBe(false);
    expect(input().getAttribute('autocomplete')).toBe('off');
  });
  it('확인을 누르면 조회만 하고 확인 대화상자를 연다', async () => {
    const { cliApprove } = setup(() => found());
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    await screen.findByText('읽기 전용 접근을 허락할까요?');
    expect(cliApprove).toHaveBeenCalledTimes(1);
    expect(cliApprove).toHaveBeenCalledWith('BCDF-GHJK');
    expect(body()).toContain('gazua@macbook');
    expect(body()).toContain('에서 요청했어요(KR · Seoul, 2분 전). 관심 그룹·전략을 읽을 수 있고, 바꾸거나 주문할 수는 없어요. 직접 실행한 명령에서 나온 코드만 승인하세요.');
  });
  it('시장 파일 올리기 범위면 제목과 설명이 다르다', async () => {
    setup(() => ({ ok: true, info: { label: 'gazua-drive@mac', createdAt: NOW - 60_000, geo: null, scope: 'market-upload' } }));
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    await screen.findByText('시장 파일 올리기를 허락할까요?');
    expect(body()).toContain('시장 파일 목록을 올리고 지울 수 있어요. 관심 그룹·전략·키는 읽지 못해요.');
  });
  it('허락하면 approve:true로 보내고 터미널로 돌아가라고 알린다', async () => {
    const { cliApprove } = setup(() => found());
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    await fireEvent.click(await screen.findByRole('button', { name: '허락' }));
    await waitFor(() => expect(cliApprove).toHaveBeenLastCalledWith('BCDF-GHJK', true));
    expect((await screen.findByRole('status')).textContent).toBe('연결했어요. 터미널로 돌아가세요');
    expect(input().value).toBe('');
  });
  it('거절하면 approve:false로 보낸다', async () => {
    const { cliApprove } = setup(() => found());
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    await fireEvent.click(await screen.findByRole('button', { name: '거절' }));
    await waitFor(() => expect(cliApprove).toHaveBeenLastCalledWith('BCDF-GHJK', false));
    expect((await screen.findByRole('status')).textContent).toBe('거절했어요');
  });
  it('위치가 없으면 괄호 안에 시각만 보인다', async () => {
    setup(() => found(null));
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    await screen.findByText('읽기 전용 접근을 허락할까요?');
    expect(body()).toContain('에서 요청했어요(2분 전).');
  });
  it('422 invalid-code와 404(옛 서버)를 각각의 문구로 알린다', async () => {
    const view = setup(() => ({ ok: false, reason: 'invalid-code' }));
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    expect((await screen.findByRole('alert')).textContent).toBe('코드가 맞지 않거나 시간이 지났어요. `gazua login`을 다시 실행해 주세요');
    view.unmount();
    setup(() => ({ ok: false, reason: 'outdated' }));
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    expect((await screen.findByRole('alert')).textContent).toBe('서버 업데이트가 필요해요');
  });
  it('입력을 바꾸면 조회 결과가 사라지고 옛 코드로는 승인할 수 없다', async () => {
    const { cliApprove } = setup(() => found());
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    await screen.findByRole('button', { name: '허락' });
    await type('bcdfghjl');
    await waitFor(() => expect(screen.queryByRole('button', { name: '허락' })).toBeNull());
    expect(cliApprove).toHaveBeenCalledTimes(1);
  });
  it('조회하는 사이 입력이 바뀌면 옛 코드의 정보를 보여 주지 않는다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const cliApprove = vi.fn(async () => { await gate; return found(); });
    render(CliConnect, { sync: { cliApprove } as unknown as SyncController, now: () => NOW });
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    await type('bcdfghjl');
    release();
    await waitFor(() => expect(cliApprove).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('읽기 전용 접근을 허락할까요?')).toBeNull();
  });
  it('axe 위반 0: 기본, 오류, 확인 대화상자', async () => {
    const { container } = setup(() => found());
    await expectNoAxeViolations(container);
    await type('bcdfghjk');
    await fireEvent.click(confirmBtn());
    await screen.findByText('읽기 전용 접근을 허락할까요?');
    await expectNoAxeViolations(document.body);
  });
});
