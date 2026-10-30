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
import { snapshotLines } from './shareText';

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
function sync(createShare = vi.fn<SyncController['createShare']>(async (): Promise<Made> => ({ url: 'https://app.example.test/#/s/' + 'x'.repeat(43), expiresAt: NOW + 7 * 864e5 }))) {
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

  it.each(['strategy', 'simResult'] as const)('%s 링크를 만드는 동안 자금 체크와 만료 입력을 끈다', async (kind) => {
    const req: ShareRequest = {
      kind, name: '눌림목', profileId: 'p1',
      build: (h) => built(kind === 'strategy'
        ? strategySnapshot(newStrategy(NOW, null, '눌림목'), { groups: [] }, { hideCapital: h, now: NOW })
        : simResultFixture({ capitalHidden: h })),
    };
    const s = sync();
    const view = render(ShareDialog, { request: req, sync: s, onclose: () => {} });
    const capital = screen.getByRole('checkbox') as HTMLInputElement;
    const ttl = screen.getByLabelText('만료(일)') as HTMLInputElement;
    expect(capital.disabled).toBe(false);
    expect(ttl.disabled).toBe(false);

    await view.rerender({ sync: { ...s, busy: true } });
    expect(capital.disabled).toBe(true);
    expect(ttl.disabled).toBe(true);
    expect((screen.getByRole('button', { name: '만드는 중…' }) as HTMLButtonElement).disabled).toBe(true);

    await view.rerender({ sync: s });
    expect(capital.disabled).toBe(false);
    expect(ttl.disabled).toBe(false);
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
    function fakeKakao(upload: (o: { file: File[] }) => Promise<unknown> = async () => ({ infos: { original: { url: 'https://k.kakaocdn.net/card.jpg', width: 1600, height: 800 } } })) {
      let initialized = false;
      const Share = { sendDefault: vi.fn(), uploadImage: vi.fn(upload), deleteImage: vi.fn(async () => ({})) };
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

    const shotCanvas = () =>
      ({
        width: 1600,
        height: 800,
        toDataURL: (type: string) => `data:${type};base64,AAAA`,
        toBlob: (cb: (b: Blob) => void) => cb(new Blob(['jpeg'], { type: 'image/jpeg' })),
      }) as unknown as HTMLCanvasElement;
    const ALT = '반도체 비교 화면 캡처: 1개월 · 등락률 · 10.29 14:32 기준, 삼성전자 +3.2%';
    const cmpReq = (capture: ShareRequest['capture'] = vi.fn(() => ({ canvas: shotCanvas(), alt: ALT, line: '삼성전자 +3.2% · 10.29 14:32 기준' }))): ShareRequest => ({
      kind: 'compare',
      name: '반도체',
      profileId: 'p1',
      build: () => built({ kind: 'compare', v: 1, title: '반도체', symbols: ['005930'], view: { period: { unit: 'M', n: 1 }, metric: 'change', benchmark: 'AUTO', boardOrder: 'value' } }),
      capture,
    });
    async function open(req: ShareRequest, kakao: { appKey: string } | null = KAKAO) {
      const onclose = vi.fn();
      const view = render(ShareDialog, { request: req, sync: sync(), onclose, copy: vi.fn(async () => {}), universe, kakao });
      return { view, onclose };
    }
    const makeLink = async () => {
      await fireEvent.click(screen.getByRole('button', { name: '링크 만들기' }));
      await waitFor(() => expect(screen.getByLabelText('공유 링크')).toBeTruthy());
    };
    const ready = async () => {
      const b = (await screen.findByRole('button', { name: '카카오톡으로 보내기' })) as HTMLButtonElement;
      await waitFor(() => expect(b.disabled).toBe(false));
      return b;
    };
    const sentImage = (sdk: ReturnType<typeof fakeKakao>) => (sdk.Share.sendDefault.mock.calls[0]![0] as { content: { imageUrl: string; description: string } }).content;

    it('키가 있고 캡처가 있으면 열 때 한 번 캡처해 data: URL로 미리 보고, 체크와 안내를 둔다', async () => {
      fakeKakao();
      const capture = vi.fn(() => ({ canvas: shotCanvas(), alt: ALT, line: null }));
      await open(cmpReq(capture));
      expect(capture).toHaveBeenCalledTimes(1);
      const img = screen.getByRole('img', { name: ALT }) as HTMLImageElement;
      expect(img.src.startsWith('data:image/jpeg')).toBe(true);
      expect((screen.getByLabelText('화면 캡처 함께 보내기') as HTMLInputElement).checked).toBe(true);
      expect(screen.getByText('링크를 만들면 이 캡처를 카카오 서버에 바로 올려요(카카오톡 카드에 넣으려고요). 링크를 철회해도 카카오톡으로 보낸 캡처는 지울 수 없어요.')).toBeTruthy();
    });

    it('카카오 키가 없으면 캡처하지 않고, 캡처가 null이면 캡처 부분을 숨긴다', async () => {
      const capture = vi.fn(() => null);
      await open(cmpReq(capture), null);
      expect(capture).not.toHaveBeenCalled();
      await open(cmpReq(vi.fn(() => null)));
      expect(screen.queryByLabelText('화면 캡처 함께 보내기')).toBeNull();
    });

    it('링크를 만들면 캡처를 올리고(캡처 올리는 중…) 그 이미지로 보낸다. 보낸 뒤 닫으면 지우지 않는다', async () => {
      let finish!: (v: unknown) => void;
      const sdk = fakeKakao(() => new Promise((r) => (finish = r)));
      const { view } = await open(cmpReq());
      await makeLink();
      expect(await screen.findByRole('button', { name: '캡처 올리는 중…' })).toBeTruthy();
      finish({ infos: { original: { url: 'https://k.kakaocdn.net/card.jpg', width: 1600, height: 800 } } });
      await fireEvent.click(await ready());
      expect(sentImage(sdk).imageUrl).toBe('https://k.kakaocdn.net/card.jpg');
      expect(sentImage(sdk).description).toBe('종목 1개 · 1개월 등락률\n삼성전자 +3.2% · 10.29 14:32 기준');
      await view.rerender({ request: null, sync: sync(), onclose: () => {}, kakao: KAKAO });
      expect(sdk.Share.deleteImage).not.toHaveBeenCalled();
    });

    it('체크를 끄면 올리지 않고 고정 이미지로 보낸다', async () => {
      const sdk = fakeKakao();
      await open(cmpReq());
      await fireEvent.click(screen.getByLabelText('화면 캡처 함께 보내기'));
      await makeLink();
      await fireEvent.click(await ready());
      expect(sdk.Share.uploadImage).not.toHaveBeenCalled();
      expect(sentImage(sdk).imageUrl).toBe('https://app.example.test/share/compare.png');
    });

    it('업로드에 실패하면 고정 이미지로 돌아가고 안내한다', async () => {
      const sdk = fakeKakao(async () => Promise.reject(new Error('403')));
      await open(cmpReq());
      await makeLink();
      await fireEvent.click(await ready());
      expect(screen.getByText('캡처를 올리지 못해 기본 그림으로 보내요')).toBeTruthy();
      expect(sentImage(sdk).imageUrl).toBe('https://app.example.test/share/compare.png');
    });

    it('보내지 않고 닫으면 올린 이미지를 지운다', async () => {
      const sdk = fakeKakao();
      const { view } = await open(cmpReq());
      await makeLink();
      await ready();
      await view.rerender({ request: null, sync: sync(), onclose: () => {}, kakao: KAKAO });
      expect(sdk.Share.deleteImage).toHaveBeenCalledWith({ imageUrl: 'https://k.kakaocdn.net/card.jpg' });
    });

    it('이미지 빼고 보내기: 지우고 고정 이미지 카드로 바꾼다', async () => {
      const sdk = fakeKakao();
      await open(cmpReq());
      await makeLink();
      await ready();
      await fireEvent.click(screen.getByRole('button', { name: '이미지 빼고 보내기' }));
      expect(sdk.Share.deleteImage).toHaveBeenCalledWith({ imageUrl: 'https://k.kakaocdn.net/card.jpg' });
      await fireEvent.click(await ready());
      expect(sentImage(sdk).imageUrl).toBe('https://app.example.test/share/compare.png');
    });

    it('업로드 중에 이미지를 빼면 카드는 바로 고정 이미지, 늦게 온 응답의 이미지도 지운다', async () => {
      let finish!: (v: unknown) => void;
      const sdk = fakeKakao(() => new Promise((r) => (finish = r)));
      await open(cmpReq());
      await makeLink();
      await screen.findByRole('button', { name: '캡처 올리는 중…' });
      await fireEvent.click(screen.getByRole('button', { name: '이미지 빼고 보내기' }));
      await fireEvent.click(await ready());
      expect(sentImage(sdk).imageUrl).toBe('https://app.example.test/share/compare.png');
      finish({ infos: { original: { url: 'https://k.kakaocdn.net/late.jpg', width: 1600, height: 800 } } });
      await waitFor(() => expect(sdk.Share.deleteImage).toHaveBeenCalledWith({ imageUrl: 'https://k.kakaocdn.net/late.jpg' }));
    });

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
      expect(feed.content.description).toBe('종목 1개: 삼성전자');
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
    raw.open = false;
    await fireEvent(raw, new Event('toggle'));
    expect(raw.querySelector('pre')).toBeNull();
  });

  it('같은 요청이 invalid가 되었다가 다시 ok가 되면 결과 원문을 닫아 둔다', async () => {
    const req = simReq((h) => h ? built(simResultFixture()) : { ok: false, code: 'invalid' });
    render(ShareDialog, { request: req, sync: sync(), onclose: () => {} });
    const raw = screen.getByText(/^결과 원문\(약 \d+ KB\)$/).closest('details')!;
    raw.open = true;
    await fireEvent(raw, new Event('toggle'));
    expect(raw.querySelector('pre')).not.toBeNull();

    const capital = screen.getByRole('checkbox');
    await fireEvent.click(capital);
    expect(screen.getByRole('alert').textContent).toBe('이 결과는 공유 형식으로 바꾸지 못했어요');
    expect(screen.queryByText(/^결과 원문\(약 \d+ KB\)$/)).toBeNull();
    await fireEvent.click(capital);
    const restored = screen.getByText(/^결과 원문\(약 \d+ KB\)$/).closest('details')!;
    expect(restored.open).toBe(false);
    expect(restored.querySelector('pre')).toBeNull();
  });

  it('다른 결과 요청을 열면 펼침 상태와 원문을 함께 닫는다', async () => {
    const view = render(ShareDialog, { request: simReq(() => built(simResultFixture())), sync: sync(), onclose: () => {} });
    const raw = screen.getByText(/^결과 원문\(약 \d+ KB\)$/).closest('details')!;
    raw.open = true;
    await fireEvent(raw, new Event('toggle'));
    expect(raw.querySelector('pre')).not.toBeNull();

    await view.rerender({ request: simReq(() => built(simResultFixture())) });
    const restored = screen.getByText(/^결과 원문\(약 \d+ KB\)$/).closest('details')!;
    expect(restored.open).toBe(false);
    expect(restored.querySelector('pre')).toBeNull();
  });

  it('결과 자금 체크를 풀면 다시 만들고 미리 본 스냅샷 그대로 링크를 만든다', async () => {
    const build = vi.fn<ShareRequest['build']>((h) => built(simResultFixture({ capitalHidden: h })));
    const s = sync();
    render(ShareDialog, { request: simReq(build), sync: s, onclose: () => {} });
    expect(build).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('list', { name: '보낼 내용' }).textContent).toContain('초기 자금: 비공개');
    const calls = build.mock.calls.length;

    await fireEvent.click(screen.getByRole('checkbox'));
    expect(build.mock.calls.length).toBeGreaterThan(calls);
    expect(build).toHaveBeenLastCalledWith(false);
    const result = build.mock.results.at(-1)!.value;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('결과 스냅샷 만들기 실패');
    if (result.snapshot.kind !== 'simResult') throw new Error('시뮬레이션 결과가 아님');
    expect(result.snapshot.capitalHidden).toBe(false);
    const preview = screen.getByRole('list', { name: '보낼 내용' });
    expect(Array.from(preview.children, (li) => li.textContent)).toEqual(snapshotLines(result.snapshot));
    expect(preview.textContent).not.toContain('비공개');

    await fireEvent.click(screen.getByRole('button', { name: '링크 만들기' }));
    expect(s.createShare).toHaveBeenCalledWith('p1', 'simResult', result.snapshot, 7);
    expect(s.createShare.mock.calls[0]![2]).toBe(result.snapshot);
  });

  it('build가 던지면 invalid 문구를 보이고 서버에 보내지 않는다', async () => {
    const s = sync();
    render(ShareDialog, { request: simReq(() => { throw new Error('변환 실패'); }), sync: s, onclose: () => {} });
    expect(screen.getByRole('alert').textContent).toBe('이 결과는 공유 형식으로 바꾸지 못했어요');
    const button = screen.getByRole('button', { name: '링크 만들기' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await fireEvent.click(button);
    expect(s.createShare).not.toHaveBeenCalled();
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

  it('형식으로 바꾸지 못하면 그 문구를 보이고 경로는 원문 보기 안에만 둔다', async () => {
    const s = sync();
    render(ShareDialog, { request: simReq(() => ({ ok: false, code: 'invalid', path: 'result.trades[3]' })), sync: s, onclose: () => {} });
    expect(screen.getByRole('alert').textContent).toBe('이 결과는 공유 형식으로 바꾸지 못했어요');
    expect((screen.getByRole('button', { name: '링크 만들기' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('보낼 원문 보기').closest('details')!.textContent).toContain('result.trades[3]');
    await fireEvent.click(screen.getByRole('button', { name: '링크 만들기' }));
    expect(s.createShare).not.toHaveBeenCalled();
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
