// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newStrategy } from '../sim/defaults';
import type { SyncController } from '../sync/controller.svelte';
import { currentSnackbar, dismissSnackbar } from '@sch0718/ui-svelte';
import ShareDialog from './ShareDialog.svelte';
import { built, groupSnapshot, strategySnapshot } from './snapshot';
import { simResultSnapshot } from './compact';
import { bigDone, NOW as FIX_NOW, simResultFixture } from './testFixtures';
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
  build: () => built(groupSnapshot({ id: 'g', name: '반도체', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] })),
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
    expect(s.createShare).toHaveBeenCalledWith('p1', 'group', (groupReq.build(true) as { snapshot: unknown }).snapshot, 7);
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
    const req: ShareRequest = { kind: 'strategy', name: st.name, profileId: 'p1', build: (h) => built(strategySnapshot(st, { groups: [] }, { hideCapital: h, now: NOW })) };
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
    const other: ShareRequest = { ...groupReq, name: '배당', build: () => built(groupSnapshot({ id: 'h', name: '배당', items: [] })) };
    await view.rerender({ request: other, sync: s, onclose: () => {} });
    finish({ url: 'https://app.example.test/#/s/' + 'y'.repeat(43), expiresAt: NOW });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByLabelText('공유 링크')).toBeNull();
    expect(screen.getByRole('button', { name: '링크 만들기' })).toBeTruthy();
  });

  describe('카카오톡으로 보내기', () => {
    const KAKAO = { appKey: 'test-kakao-key' };
    // 실제 SDK처럼 init 뒤에야 Share를 붙인다. 시험은 돌려받은 Share로 호출을 확인한다.
    function fakeKakao() {
      let initialized = false;
      const Share = { sendDefault: vi.fn() };
      const init = vi.fn(() => {
        initialized = true;
        Object.assign(sdk, { Share });
      });
      const sdk = { init, isInitialized: () => initialized };
      Object.assign(window, { Kakao: sdk });
      return { init, Share };
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

describe('ShareDialog 결과 종류', () => {
  const simReq = (build: ShareRequest['build']): ShareRequest => ({ kind: 'simResult', name: '눌림목', profileId: 'p1', build });

  it('제목은 종류 이름, 자금 빼기 문구는 결과용, 미리 보기는 요약만', () => {
    render(ShareDialog, { request: simReq(() => built(simResultFixture())), sync: sync(), onclose: () => {} });
    expect(screen.getByText('시뮬레이션 결과 공유')).toBeTruthy();
    expect(screen.getByLabelText('가상 초기 자금과 금액·수량 빼기')).toBeTruthy();
    const lines = screen.getByRole('list', { name: '보낼 내용' }).textContent!;
    expect(lines).toContain('총수익률');
    expect(lines).not.toContain('"trades"');
  });

  it('결과 원문은 펼칠 때만 만들어지고, 규칙 원문은 들여 쓴 JSON이다', async () => {
    render(ShareDialog, { request: simReq(() => built(simResultFixture())), sync: sync(), onclose: () => {} });
    const raw = screen.getByText(/^결과 원문\(약 \d+ KB\)$/).closest('details')!;
    expect(raw.querySelector('pre')).toBeNull();
    raw.open = true;
    await fireEvent(raw, new Event('toggle'));
    expect(raw.querySelector('pre')!.textContent).toContain('"axis":{"start":"2024-01-02"');
    const rules = screen.getByText('보낼 원문 보기').closest('details')!;
    expect(rules.querySelector('pre')!.textContent).toContain('\n  "strategy": {');
  });

  it('줄인 단계를 한 줄씩 알린다', () => {
    render(ShareDialog, { request: simReq(() => ({ ok: true, snapshot: simResultFixture(), reduced: ['skipped-counts', 'thinned'] })), sync: sync(), onclose: () => {} });
    const list = screen.getByRole('list', { name: '줄인 내용' });
    expect(list.textContent).toContain('건너뛴 신호는 이유별 개수만 보내요');
    expect(list.textContent).toContain('곡선은 점 수를 줄여 보내요');
  });

  it('너무 크면 거절 문구를 보이고 링크 만들기를 끈다(서버에 보내지 않는다)', async () => {
    const s = sync();
    render(ShareDialog, { request: simReq((h) => simResultSnapshot(bigDone({ days: 735, trades: 3000, skips: 0 }), { hideCapital: h, now: FIX_NOW })), sync: s, onclose: () => {} });
    expect(screen.getByRole('alert').textContent).toMatch(/^결과가 너무 커서 공유할 수 없어요\(약 \d+ KB, 한도 100 KB\)\. 기간이나 종목을 줄여 다시 실행해 주세요$/);
    const button = screen.getByRole('button', { name: '링크 만들기' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await fireEvent.click(button);
    expect(s.createShare).not.toHaveBeenCalled();
  });

  it('형식으로 바꾸지 못하면 그 문구를 보이고 경로는 원문 보기 안에만 둔다', () => {
    render(ShareDialog, { request: simReq(() => ({ ok: false, code: 'invalid', path: 'result.trades[3]' })), sync: sync(), onclose: () => {} });
    expect(screen.getByRole('alert').textContent).toBe('이 결과는 공유 형식으로 바꾸지 못했어요');
    expect((screen.getByRole('button', { name: '링크 만들기' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('보낼 원문 보기').closest('details')!.textContent).toContain('result.trades[3]');
  });

  it('비교 화면에는 자금 빼기 체크가 없다', () => {
    const cmp: ShareRequest = {
      kind: 'compare',
      name: '반도체',
      profileId: 'p1',
      build: () => built({ kind: 'compare', v: 1, title: '반도체', symbols: ['005930'], view: { period: { unit: 'D', n: 1 }, metric: 'change', benchmark: 'AUTO', boardOrder: 'value' } }),
    };
    render(ShareDialog, { request: cmp, sync: sync(), onclose: () => {} });
    expect(screen.queryByLabelText(/가상 초기 자금/)).toBeNull();
    expect(screen.getByText('비교 화면 공유')).toBeTruthy();
  });
});
