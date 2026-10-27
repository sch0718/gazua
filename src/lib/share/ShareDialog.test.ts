// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newStrategy } from '../sim/defaults';
import type { SyncController } from '../sync/controller.svelte';
import { currentSnackbar, dismissSnackbar } from '../ui/components/snackbarStore.svelte';
import ShareDialog from './ShareDialog.svelte';
import { groupSnapshot, strategySnapshot } from './snapshot';
import type { ShareRequest } from './shareStore.svelte';

afterEach(() => {
  dismissSnackbar();
  Reflect.deleteProperty(window, 'Kakao');
  document.querySelectorAll('script').forEach((s) => s.remove());
});

const NOW = Date.UTC(2026, 9, 25);
const groupReq: ShareRequest = {
  kind: 'group',
  name: '반도체',
  profileId: 'p1',
  build: () => groupSnapshot({ id: 'g', name: '반도체', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] }),
};

type Made = { url: string; expiresAt: number } | null;
function sync(createShare = vi.fn(async (): Promise<Made> => ({ url: 'https://app.example.test/#/s/' + 'x'.repeat(43), expiresAt: NOW + 7 * 864e5 }))) {
  return { busy: false, error: null, clearError: vi.fn(), createShare } as unknown as SyncController & { createShare: typeof createShare };
}

describe('ShareDialog', () => {
  it('보낼 내용을 먼저 보여 주고 기본 7일로 링크를 만든다', async () => {
    const s = sync();
    const copy = vi.fn(async () => {});
    render(ShareDialog, { request: groupReq, sync: s, onclose: () => {}, copy });
    expect(screen.getByRole('list', { name: '보낼 내용' }).textContent).toContain('005930');
    expect((screen.getByLabelText('만료(일)') as HTMLInputElement).value).toBe('7');
    expect(screen.queryByLabelText('가상 초기 자금 빼기')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: '링크 만들기' }));
    expect(s.createShare).toHaveBeenCalledWith('p1', 'group', groupReq.build(true), 7);
    await waitFor(() => expect(screen.getByLabelText('공유 링크')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: '링크 복사' }));
    expect(copy).toHaveBeenCalledWith('https://app.example.test/#/s/' + 'x'.repeat(43));
  });

  it('미리 보기에 종목 이름을 함께 보여 준다', async () => {
    const universe = vi.fn(async () => [{ s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK' as const }]);
    render(ShareDialog, { request: groupReq, sync: sync(), onclose: () => {}, universe });
    await waitFor(() => expect(screen.getByRole('list', { name: '보낼 내용' }).textContent).toContain('삼성전자(005930)'));
  });

  it('만료는 1~30일만', async () => {
    const s = sync();
    render(ShareDialog, { request: groupReq, sync: s, onclose: () => {} });
    await fireEvent.input(screen.getByLabelText('만료(일)'), { target: { value: '31' } });
    expect(screen.getByRole('alert').textContent).toContain('1~30일');
    expect((screen.getByRole('button', { name: '링크 만들기' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('전략은 가상 자금을 기본으로 빼고, 체크를 풀면 넣는다', async () => {
    const st = { ...newStrategy(NOW, null, '눌림목'), id: 's1' };
    st.capital.initial = 123_456_789;
    const req: ShareRequest = { kind: 'strategy', name: st.name, profileId: 'p1', build: (h) => strategySnapshot(st, { groups: [] }, { hideCapital: h, now: NOW }) };
    const s = sync();
    render(ShareDialog, { request: req, sync: s, onclose: () => {} });
    expect(screen.getByRole('list', { name: '보낼 내용' }).textContent).toContain('비공개');
    await fireEvent.click(screen.getByLabelText('가상 초기 자금 빼기'));
    expect(screen.getByRole('list', { name: '보낼 내용' }).textContent).toContain('123,456,789원');
  });

  it('실패하면 이유를 알린다', async () => {
    const s = sync(vi.fn(async (): Promise<Made> => null));
    (s as { error: string | null }).error = '활성 공유는 50개까지예요.';
    render(ShareDialog, { request: groupReq, sync: s, onclose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: '링크 만들기' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('50개'));
  });

  // Codex 리뷰(PR #39) 4차 3: 링크를 만드는 중에 닫았다가 다른 것을 열면, 늦게 온 이전 링크를 보여 주지 않는다.
  it('만드는 중에 닫으면 늦게 온 링크를 다음 공유에 보여 주지 않는다', async () => {
    let finish!: (v: Made) => void;
    const s = sync(vi.fn(() => new Promise<Made>((r) => (finish = r))));
    const view = render(ShareDialog, { request: groupReq, sync: s, onclose: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: '링크 만들기' }));
    await view.rerender({ request: null, sync: s, onclose: () => {} });
    const other: ShareRequest = { ...groupReq, name: '배당', build: () => groupSnapshot({ id: 'h', name: '배당', items: [] }) };
    await view.rerender({ request: other, sync: s, onclose: () => {} });
    finish({ url: 'https://app.example.test/#/s/' + 'y'.repeat(43), expiresAt: NOW });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByLabelText('공유 링크')).toBeNull();
    expect(screen.getByRole('button', { name: '링크 만들기' })).toBeTruthy();
  });

  describe('카카오톡으로 보내기', () => {
    const KAKAO = { appKey: 'test-kakao-key' };
    function fakeKakao() {
      let initialized = false;
      const sdk = {
        init: vi.fn(() => {
          initialized = true;
        }),
        isInitialized: () => initialized,
        Share: { sendDefault: vi.fn() },
      };
      Object.assign(window, { Kakao: sdk });
      return sdk;
    }
    const universe = vi.fn(async () => [{ s: '005930', n: '삼성전자', m: 'KOSPI', t: 'STOCK' as const }]);
    async function made(kakao: { appKey: string; sdkUrl?: string } | null) {
      render(ShareDialog, { request: groupReq, sync: sync(), onclose: () => {}, copy: vi.fn(async () => {}), universe, kakao });
      await fireEvent.click(screen.getByRole('button', { name: '링크 만들기' }));
      await waitFor(() => expect(screen.getByLabelText('공유 링크')).toBeTruthy());
    }

    it('키가 없으면 단추가 없고 링크 복사만 있다', async () => {
      await made(null);
      expect(screen.queryByRole('button', { name: /카카오톡/ })).toBeNull();
      expect(screen.getByRole('button', { name: '링크 복사' })).toBeTruthy();
    });

    it('SDK가 준비되면 공유 링크와 스냅샷 요약만 담아 보낸다', async () => {
      const sdk = fakeKakao();
      await made(KAKAO);
      const button = (await screen.findByRole('button', { name: '카카오톡으로 보내기' })) as HTMLButtonElement;
      await waitFor(() => expect(button.disabled).toBe(false));
      expect(sdk.init).toHaveBeenCalledWith('test-kakao-key');
      await fireEvent.click(button);
      expect(sdk.Share.sendDefault).toHaveBeenCalledTimes(1);
      const feed = sdk.Share.sendDefault.mock.calls[0]![0] as { content: { title: string; description: string; link: { webUrl: string } } };
      const url = 'https://app.example.test/#/s/' + 'x'.repeat(43);
      expect(feed.content.title).toBe('그룹 공유: 반도체');
      expect(feed.content.description).toBe('종목 1개: 삼성전자(005930)');
      expect(feed.content.link.webUrl).toBe(url);
      const sent = JSON.stringify(feed);
      expect(sent).not.toContain('test-kakao-key');
      expect(sent).not.toContain('"kind"');
      expect(sent).not.toContain('"symbols"');
    });

    it('SDK를 불러오지 못하면 단추를 숨기고 링크 복사는 그대로다', async () => {
      await made({ ...KAKAO, sdkUrl: 'https://sdk.test/kakao.js' });
      await waitFor(() => expect(document.scripts).toHaveLength(1));
      expect((screen.getByRole('button', { name: '카카오톡 준비 중…' }) as HTMLButtonElement).disabled).toBe(true);
      document.scripts[0]!.dispatchEvent(new Event('error'));
      await waitFor(() => expect(screen.queryByRole('button', { name: /카카오톡/ })).toBeNull());
      expect(screen.getByRole('button', { name: '링크 복사' })).toBeTruthy();
    });

    it('보내기에 실패하면 링크 복사를 안내한다', async () => {
      const sdk = fakeKakao();
      sdk.Share.sendDefault.mockImplementation(() => {
        throw new Error('카카오 오류');
      });
      await made(KAKAO);
      const button = (await screen.findByRole('button', { name: '카카오톡으로 보내기' })) as HTMLButtonElement;
      await waitFor(() => expect(button.disabled).toBe(false));
      await fireEvent.click(button);
      expect(currentSnackbar()?.message).toContain('링크를 복사');
    });
  });
});
