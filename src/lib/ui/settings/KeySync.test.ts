// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestApp } from '../../../sheets/testApp';
import { KeyLockNotSavedError, StoredKeysNotRemovedError, type App } from '../../state/app.svelte';
import { expectNoAxeViolations } from '../../share/testAxe';
import type { KeyView, SyncController, SyncKeys } from '../../sync/controller.svelte';
import { PASSPHRASE_TEXT } from '../../sync/keyCrypto';
import type { KeySyncState } from '../../sync/keyStore';
import { KEY_TEXT, type KeyResult } from '../../sync/keySync';
import KeySync from './KeySync.svelte';
import { KEYS_NOT_REMOVED, keyLockFailureText } from './KeyLock.svelte';

const NOW = Date.UTC(2026, 10, 1);
const VAULT = { vaultId: 'V'.repeat(24), vaultRevision: 1, salt: 'S'.repeat(24) };
const KIS = { appKey: 'FAKE-kis-key-0001', appSecret: 'FAKE-kis-secret-0001' };
const TOSS = { clientId: 'FAKE-toss-client-0001', clientSecret: 'FAKE-toss-secret-0001' };

function row(o: Partial<KeySyncState> = {}): KeySyncState {
  return { profileId: 'p1', active: true, revision: 1, syncedContentId: 'I'.repeat(24), seenRevision: 1, offPending: false, providers: ['kis'], localSeq: 0, uploadedSeq: 0, notice: null, ...o };
}
function fakeKeys(view: Partial<KeyView> = {}, over: Partial<SyncKeys> = {}): SyncKeys {
  const ok = async () => ({ ok: true as const, notes: [] });
  return {
    view: { support: true, vault: null, accountNotice: null, states: [], problem: null, remembered: false, persistent: true, uploaded: ['p1'], ...view },
    createVault: vi.fn(ok),
    unlockVault: vi.fn(ok),
    enable: vi.fn(ok),
    setProviders: vi.fn(ok),
    prepareReceive: vi.fn(async () => ({ ok: true as const, overwrite: [] })),
    commitReceive: vi.fn(ok),
    cancelReceive: vi.fn(),
    uploadLocal: vi.fn(ok),
    disable: vi.fn(ok),
    changePassphrase: vi.fn(ok),
    wipe: vi.fn(ok),
    forget: vi.fn(),
    dismiss: vi.fn(async () => {}),
    dismissAccount: vi.fn(async () => {}),
    ...over,
  };
}

let apps: App[] = [];
afterEach(() => {
  for (const a of apps) a.destroy();
  apps = [];
});
async function setup(o: { keys?: SyncKeys; secrets?: { kis?: typeof KIS; toss?: typeof TOSS }; keyLock?: boolean; confirmFn?: (m: string) => boolean } = {}) {
  const app = makeTestApp({ groups: [{ id: 'g1', name: '내 관심', items: [] }], now: NOW });
  apps.push(app);
  // 키 잠금은 설정만으로 켜지지 않는다(잠금 여부는 저장된 키의 모양이 정한다): 실제로 잠가 둔다
  if (o.keyLock) await app.setSecrets(o.secrets ?? { kis: KIS }, 'FAKE-lock-pass');
  else if (o.secrets) await app.setSecrets(o.secrets);
  const keys = o.keys ?? fakeKeys();
  const confirmFn = o.confirmFn ?? vi.fn(() => true);
  const r = render(KeySync, { app, sync: { keys } as unknown as SyncController, confirmFn });
  return { app, keys, confirmFn, container: r.container };
}
const toggle = () => screen.getByRole('switch', { name: '이 프로필의 키도 동기화' });
const button = (name: string) => screen.getByRole('button', { name });
const checkbox = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
async function openRisk() {
  await fireEvent.click(toggle());
  await screen.findByText('키를 서버에 올리기 전에 확인해 주세요');
}

describe('KeySync', () => {
  it('함께 보이는 입력 단추는 보이는 글자를 유지하고 접근 가능한 이름으로 구분한다', async () => {
    await setup({ keys: fakeKeys({ vault: VAULT, accountNotice: 'vault-changed', states: [row({ localSeq: 1 })] }), secrets: { kis: KIS } });
    const labels = ['바뀐 동기화 암호 입력', '키를 올리기 위한 동기화 암호 입력', '동기화 암호 입력'];
    for (const label of labels) {
      const input = button(label);
      expect(input.textContent).toBe('입력');
      await fireEvent.click(input);
      expect(screen.getByRole('dialog', { name: '동기화 암호 입력' })).toBeTruthy();
      await fireEvent.click(button('취소'));
    }
  });

  it('받기의 일반 저장 오류도 서버 문구로 보이고 조용한 실패는 그대로 둔다', async () => {
    const commitReceive = vi.fn()
      .mockResolvedValueOnce({ ok: false, message: null, error: new Error('FAKE-save-error') })
      .mockResolvedValueOnce({ ok: false, message: null });
    await setup({ keys: fakeKeys({ vault: VAULT, remembered: true, states: [row({ notice: 'newer' })] }, { commitReceive }) });
    await fireEvent.click(button('받기'));
    expect((await screen.findByRole('alert')).textContent?.trim()).toBe(KEY_TEXT.server);
    await fireEvent.click(button('받기'));
    await waitFor(() => expect(commitReceive).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('옛 Worker면 배포 안내만, 아직 모르면 아무것도 없다', async () => {
    await setup({ keys: fakeKeys({ support: false }) });
    expect(screen.getByText(KEY_TEXT.oldWorker)).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    cleanup();
    await setup({ keys: fakeKeys({ support: null }) });
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText(KEY_TEXT.oldWorker)).toBeNull();
    expect(screen.queryByRole('heading', { name: '키 동기화 (암호화)' })).toBeNull();
  });

  it('꺼진 이유 두 가지: 문구와 disabled, 토글의 aria-describedby로 잇는다', async () => {
    await setup({ keys: fakeKeys({ uploaded: [] }), secrets: { kis: KIS } });
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
    const why = screen.getByText(KEY_TEXT.notUploaded);
    expect(toggle().getAttribute('aria-describedby')).toBe(why.id);
    cleanup();
    await setup();
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(KEY_TEXT.noKeys)).toBeTruthy();
  });

  it('다른 기기가 켠 것을 알기만 한 행(revision 0)은 켜짐으로 보이고 「받기」, 공급자 체크는 없다', async () => {
    await setup({ keys: fakeKeys({ vault: VAULT, states: [row({ revision: 0, providers: [], syncedContentId: null, notice: 'available', remoteRevision: 3 })] }) });
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(KEY_TEXT.available)).toBeTruthy();
    expect(button('받기')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'KIS 키' })).toBeNull();
  });

  it('위험 안내: 네 항목, 둘째 항목의 기기 잠금 암호 문장, 체크 전 「계속」 꺼짐', async () => {
    await setup({ secrets: { kis: KIS } });
    await openRisk();
    const items = screen.getByText(/KIS 앱 키는 계좌를 연결하면/).closest('ul')!.querySelectorAll('li');
    expect(items).toHaveLength(4);
    expect(items[1].textContent).toContain('이 기기 잠금 암호와 같은 암호를 쓰면');
    expect((button('계속') as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(checkbox('위 내용을 이해했어요'));
    expect((button('계속') as HTMLButtonElement).disabled).toBe(false);
  });

  it('공급자 체크: 기본 KIS 켬·토스 끔, 키 없는 공급자는 disabled, 하나만 켜졌으면 그 체크도 disabled', async () => {
    await setup({ secrets: { kis: KIS } });
    await openRisk();
    expect(checkbox('KIS 키').checked).toBe(true);
    expect(checkbox('KIS 키').disabled).toBe(true);
    expect(screen.getByText(KEY_TEXT.keepOne)).toBeTruthy();
    expect(checkbox('토스 키').checked).toBe(false);
    expect(checkbox('토스 키').disabled).toBe(true);
    expect(screen.getByText(KEY_TEXT.noKeyHere)).toBeTruthy();
    expect(screen.getByRole('group', { name: '올릴 항목' })).toBeTruthy();
    // 프록시 주소가 없으면 프록시 체크도 끈 채 disabled
    expect(checkbox('프록시 주소·토큰').checked).toBe(false);
    expect(checkbox('프록시 주소·토큰').disabled).toBe(true);
    expect(screen.getByText(KEY_TEXT.noProxyHere)).toBeTruthy();
  });

  it('https 프록시 주소가 있으면 프록시 체크를 고를 수 있다(기본은 끔)', async () => {
    const { app } = await setup({ secrets: { kis: KIS } });
    app.updateSettings({ proxyUrl: 'https://proxy.test' });
    await openRisk();
    expect(checkbox('프록시 주소·토큰').checked).toBe(false);
    expect(checkbox('프록시 주소·토큰').disabled).toBe(false);
    await fireEvent.click(checkbox('프록시 주소·토큰'));
    expect(checkbox('프록시 주소·토큰').checked).toBe(true);
    expect(checkbox('KIS 키').disabled).toBe(false);
  });

  it('KIS 키가 없는 기기는 둘 다 끈 채라 「계속」 꺼짐, 토스를 켜면 토큰 경고(status)', async () => {
    await setup({ secrets: { toss: TOSS } });
    await openRisk();
    expect(checkbox('KIS 키').checked).toBe(false);
    expect(checkbox('토스 키').checked).toBe(false);
    await fireEvent.click(checkbox('위 내용을 이해했어요'));
    expect((button('계속') as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(checkbox('토스 키'));
    expect(screen.getByText(KEY_TEXT.tossWarning).getAttribute('role')).toBe('status');
    expect((button('계속') as HTMLButtonElement).disabled).toBe(false);
  });

  it('켜진 공급자 변경이 실패하면 토스 체크를 원래대로 되돌린다', async () => {
    const keys = fakeKeys(
      { vault: VAULT, remembered: true, states: [row({ providers: ['kis', 'toss'] })] },
      { setProviders: vi.fn(async () => ({ ok: false as const, message: KEY_TEXT.server })) },
    );
    await setup({ keys, secrets: { kis: KIS, toss: TOSS } });
    await fireEvent.click(checkbox('토스 키'));
    expect(keys.setProviders).toHaveBeenCalledWith('p1', ['kis']);
    await screen.findByRole('alert');
    expect(checkbox('토스 키').checked).toBe(true);
    expect(checkbox('KIS 키').checked).toBe(true);
  });

  it.each(['setProviders', 'uploadLocal'] as const)('올리는 중에는 켜진 공급자 체크를 끈다: %s', async (method) => {
    let finish!: (v: KeyResult) => void;
    const keys = fakeKeys(
      { vault: VAULT, remembered: true, states: [row({ providers: ['kis', 'toss'], notice: 'conflict' })] },
      { [method]: vi.fn(() => new Promise<KeyResult>((resolve) => (finish = resolve))) },
    );
    await setup({ keys, secrets: { kis: KIS, toss: TOSS } });
    if (method === 'setProviders') await fireEvent.click(checkbox('토스 키'));
    else await fireEvent.click(button('이 기기 키 올리기'));
    expect(checkbox('KIS 키').disabled).toBe(true);
    expect(checkbox('토스 키').disabled).toBe(true);
    finish({ ok: true, notes: [] });
    await waitFor(() => expect(checkbox('토스 키').disabled).toBe(false));
  });

  it('암호 정하기: 3.4 문구 네 가지가 alert로, 해당 칸에 aria-invalid·aria-describedby', async () => {
    const { keys } = await setup({ secrets: { kis: KIS } });
    await openRisk();
    await fireEvent.click(checkbox('위 내용을 이해했어요'));
    await fireEvent.click(button('계속'));
    await screen.findByText('동기화 암호 정하기');
    const cases: [string, string, string, string][] = [
      ['abcdefghijk', 'abcdefghijk', PASSPHRASE_TEXT.short, '동기화 암호'],
      ['abcd'.repeat(32) + 'e', 'abcd'.repeat(32) + 'e', PASSPHRASE_TEXT.long, '동기화 암호'],
      ['aaaaaaaaaaaa', 'aaaaaaaaaaaa', PASSPHRASE_TEXT.plain, '동기화 암호'],
      ['abcdefghijkl', 'abcdefghijkm', PASSPHRASE_TEXT.mismatch, '동기화 암호 확인'],
    ];
    for (const [p, c, text, field] of cases) {
      await fireEvent.input(screen.getByLabelText('동기화 암호'), { target: { value: p } });
      await fireEvent.input(screen.getByLabelText('동기화 암호 확인'), { target: { value: c } });
      await fireEvent.click(button('확인'));
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toBe(text);
      expect(screen.getByLabelText(field).getAttribute('aria-invalid')).toBe('true');
      expect(screen.getByLabelText(field).getAttribute('aria-describedby')).toBe(alert.id);
    }
    expect(keys.createVault).not.toHaveBeenCalled();
    await fireEvent.input(screen.getByLabelText('동기화 암호'), { target: { value: ' abcdefghijkl' } });
    expect(screen.getByText('앞이나 뒤에 공백이 있어요')).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('동기화 암호 확인'), { target: { value: ' abcdefghijkl' } });
    await fireEvent.click(button('확인'));
    await waitFor(() => expect(keys.createVault).toHaveBeenCalledWith(' abcdefghijkl'));
    await waitFor(() => expect(keys.enable).toHaveBeenCalledWith('p1', ['kis']));
    expect((screen.queryByLabelText('동기화 암호') as HTMLInputElement | null)?.value ?? '').toBe('');
  });

  it.each([
    ['create', '', '', PASSPHRASE_TEXT.short, '동기화 암호'],
    ['create', '', 'FAKE-sync-pass', PASSPHRASE_TEXT.short, '동기화 암호'],
    ['create', 'FAKE-sync-pass', '', PASSPHRASE_TEXT.mismatch, '동기화 암호 확인'],
    ['change', '', '', PASSPHRASE_TEXT.short, '새 동기화 암호'],
    ['change', '', 'FAKE-sync-pass', PASSPHRASE_TEXT.short, '새 동기화 암호'],
    ['change', 'FAKE-sync-pass', '', PASSPHRASE_TEXT.mismatch, '새 동기화 암호 확인'],
  ])('정하기·바꾸기의 빈 새 암호도 3.4 문구와 필드 연결로 알린다: %s, %s, %s', async (kind, pass, pass2, text, field) => {
    const keys = fakeKeys({ vault: kind === 'create' ? null : VAULT });
    await setup({ keys, secrets: { kis: KIS } });
    if (kind === 'create') {
      await openRisk();
      await fireEvent.click(checkbox('위 내용을 이해했어요'));
      await fireEvent.click(button('계속'));
    } else {
      await fireEvent.click(button('동기화 암호 바꾸기'));
      await fireEvent.input(screen.getByLabelText('현재 동기화 암호'), { target: { value: 'FAKE-current-pass' } });
    }
    await fireEvent.input(screen.getByLabelText(kind === 'create' ? '동기화 암호' : '새 동기화 암호'), { target: { value: pass } });
    await fireEvent.input(screen.getByLabelText(kind === 'create' ? '동기화 암호 확인' : '새 동기화 암호 확인'), { target: { value: pass2 } });
    await fireEvent.submit(button('확인').closest('form')!);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(text);
    expect(screen.getByLabelText(field).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(field).getAttribute('aria-describedby')).toBe(alert.id);
    expect(keys.createVault).not.toHaveBeenCalled();
    expect(keys.changePassphrase).not.toHaveBeenCalled();
    expect(keys.enable).not.toHaveBeenCalled();
  });

  it('암호 입력: 틀리면 문구, KDF 중 「확인하는 중…」이고 Esc로 닫히지 않는다', async () => {
    let finish!: (v: KeyResult) => void;
    const keys = fakeKeys({ vault: VAULT }, { unlockVault: vi.fn(() => new Promise<KeyResult>((r) => (finish = r))) });
    await setup({ keys, secrets: { kis: KIS } });
    await fireEvent.click(button('동기화 암호 입력'));
    await screen.findByText('동기화 암호 입력');
    await fireEvent.input(screen.getByLabelText('동기화 암호'), { target: { value: 'FAKE-wrong-pass' } });
    await fireEvent.click(button('확인'));
    expect(await screen.findByRole('button', { name: '확인하는 중…' })).toBeTruthy();
    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.getByText('동기화 암호 입력')).toBeTruthy();
    finish({ ok: false, message: KEY_TEXT.wrongPass });
    expect((await screen.findByRole('alert')).textContent).toBe(KEY_TEXT.wrongPass);
  });

  it.each([
    ['createVault', false],
    ['createVault', true],
    ['unlockVault', false],
    ['changePassphrase', false],
  ] as const)('암호 처리의 null 문구를 다른 오류로 바꾸지 않는다: %s, needsPass=%s', async (method, needsPass) => {
    const keys = fakeKeys(
      { vault: method === 'createVault' ? null : VAULT },
      { [method]: vi.fn(async () => ({ ok: false as const, message: null, needsPass })) },
    );
    await setup({ keys, secrets: { kis: KIS } });
    if (method === 'createVault') {
      await openRisk();
      await fireEvent.click(checkbox('위 내용을 이해했어요'));
      await fireEvent.click(button('계속'));
    } else await fireEvent.click(button(method === 'unlockVault' ? '동기화 암호 입력' : '동기화 암호 바꾸기'));
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'));
    for (const input of inputs) await fireEvent.input(input, { target: { value: 'FAKE-sync-pass' } });
    await fireEvent.click(button('확인'));
    await waitFor(() => expect(keys[method]).toHaveBeenCalled());
    await waitFor(() => expect(Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')).every((input) => input.value === '')).toBe(true));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(keys.enable).not.toHaveBeenCalled();
  });

  it.each([
    ['enter', '동기화 암호'],
    ['change', '현재 동기화 암호'],
    ['lockpass', '이 기기 잠금 암호'],
    ['enter-lock', '이 기기 잠금 암호'],
  ])('빈 암호 칸을 제출하면 아무 일도 하지 않는다: %s, %s', async (kind, emptyField) => {
    const keys = fakeKeys({ vault: VAULT, remembered: kind === 'lockpass', states: [row({ notice: 'newer' })] });
    await setup({ keys, secrets: { kis: KIS }, keyLock: kind === 'lockpass' || kind === 'enter-lock' });
    await fireEvent.click(button(kind === 'change' ? '동기화 암호 바꾸기' : kind === 'enter' ? '동기화 암호 입력' : '받기'));
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type="password"]')) {
      await fireEvent.input(input, { target: { value: 'FAKE-sync-pass' } });
    }
    await fireEvent.input(screen.getByLabelText(emptyField), { target: { value: '' } });
    await fireEvent.submit(button('확인').closest('form')!);
    expect(screen.queryByRole('alert')).toBeNull();
    for (const method of ['createVault', 'unlockVault', 'changePassphrase', 'prepareReceive', 'commitReceive'] as const) {
      expect(keys[method]).not.toHaveBeenCalled();
    }
  });

  it.each(['available', 'newer', 'conflict', 'rollback'] as const)('받는 중에는 준비부터 저장까지 받기 단추를 끈다: %s', async (notice) => {
    let prepare!: (v: { ok: true; overwrite: [] }) => void;
    let commit!: (v: KeyResult) => void;
    const keys = fakeKeys(
      { vault: VAULT, remembered: true, states: [row({ notice })] },
      {
        prepareReceive: vi.fn(() => new Promise<{ ok: true; overwrite: [] }>((resolve) => (prepare = resolve))),
        commitReceive: vi.fn(() => new Promise<KeyResult>((resolve) => (commit = resolve))),
      },
    );
    await setup({ keys });
    const receive = button(notice === 'available' || notice === 'newer' ? '받기' : '서버 키 받기') as HTMLButtonElement;
    await fireEvent.click(receive);
    expect(receive.disabled).toBe(true);
    prepare({ ok: true, overwrite: [] });
    await waitFor(() => expect(keys.commitReceive).toHaveBeenCalled());
    expect(receive.disabled).toBe(true);
    expect(keys.prepareReceive).toHaveBeenCalledTimes(1);
    commit({ ok: true, notes: [] });
    await waitFor(() => expect(receive.disabled).toBe(false));
  });

  it('받기: 이 기기 키 잠금이면 잠금 암호 칸이 함께 보이고, 틀리면 문구', async () => {
    const keys = fakeKeys(
      { vault: VAULT, remembered: true, states: [row({ notice: 'newer', remoteRevision: 2 })] },
      { commitReceive: vi.fn(async () => ({ ok: false as const, message: KEY_TEXT.wrongLockPass })) },
    );
    await setup({ keys, keyLock: true });
    await fireEvent.click(button('받기'));
    await fireEvent.input(await screen.findByLabelText('이 기기 잠금 암호'), { target: { value: 'FAKE-lock-pass' } });
    await fireEvent.click(button('확인'));
    expect((await screen.findByRole('alert')).textContent).toBe(KEY_TEXT.wrongLockPass);
    expect(keys.commitReceive).toHaveBeenCalledWith('FAKE-lock-pass');
  });

  it('받기: 동기화 암호 시트에서 잠금 암호가 틀리면 잠금 암호 시트로 바뀌어 잠금 암호만 다시 넣을 수 있다', async () => {
    const commitReceive = vi.fn(async () => ({ ok: false as const, message: KEY_TEXT.wrongLockPass }));
    const keys = fakeKeys({ vault: VAULT, remembered: false, states: [row({ notice: 'newer', remoteRevision: 2 })] }, { commitReceive });
    await setup({ keys, keyLock: true });
    await fireEvent.click(button('받기'));
    await fireEvent.input(await screen.findByLabelText('동기화 암호'), { target: { value: 'FAKE-sync-pass' } });
    await fireEvent.input(screen.getByLabelText('이 기기 잠금 암호'), { target: { value: 'FAKE-wrong' } });
    await fireEvent.click(button('확인'));
    expect((await screen.findByRole('alert')).textContent).toBe(KEY_TEXT.wrongLockPass);
    expect(screen.queryByLabelText('동기화 암호')).toBeNull();
    await fireEvent.input(screen.getByLabelText('이 기기 잠금 암호'), { target: { value: 'FAKE-right' } });
    await fireEvent.click(button('확인'));
    await waitFor(() => expect(commitReceive).toHaveBeenCalledTimes(2));
    expect(commitReceive).toHaveBeenLastCalledWith('FAKE-right');
  });

  it('받기: 잠금 암호 시트를 취소하면 컨트롤러가 쥔 풀린 키를 버린다', async () => {
    const keys = fakeKeys(
      { vault: VAULT, remembered: true, states: [row({ notice: 'newer', remoteRevision: 2 })] },
      { commitReceive: vi.fn(async () => ({ ok: false as const, message: KEY_TEXT.wrongLockPass })) },
    );
    await setup({ keys, keyLock: true });
    await fireEvent.click(button('받기'));
    await fireEvent.input(await screen.findByLabelText('이 기기 잠금 암호'), { target: { value: 'FAKE-wrong' } });
    await fireEvent.click(button('확인'));
    await screen.findByRole('alert');
    await fireEvent.click(button('취소'));
    expect(keys.cancelReceive).toHaveBeenCalled();
  });

  it('받기: 로컬에 다른 값이 있으면 덮어쓰기 확인, 취소하면 쓰지 않는다', async () => {
    const confirmFn = vi.fn(() => false);
    const keys = fakeKeys({ vault: VAULT, remembered: true, states: [row({ notice: 'newer', remoteRevision: 2 })] }, { prepareReceive: vi.fn(async () => ({ ok: true as const, overwrite: ['kis' as const] })) });
    await setup({ keys, secrets: { kis: KIS }, confirmFn });
    await fireEvent.click(button('받기'));
    await waitFor(() => expect(confirmFn).toHaveBeenCalledWith('이 기기의 KIS 키가 서버 키로 바뀌어요'));
    expect(keys.cancelReceive).toHaveBeenCalled();
    expect(keys.commitReceive).not.toHaveBeenCalled();
  });

  it('끄기가 실패하면 토글이 켜진 채 오류 문구', async () => {
    const keys = fakeKeys({ vault: VAULT, remembered: true, states: [row()] }, { disable: vi.fn(async () => ({ ok: false as const, message: KEY_TEXT.offFailed })) });
    const { confirmFn } = await setup({ keys, secrets: { kis: KIS } });
    await fireEvent.click(toggle());
    expect(confirmFn).toHaveBeenCalledWith(KEY_TEXT.offConfirm);
    expect((await screen.findByRole('alert')).textContent).toContain(KEY_TEXT.offFailed);
    expect(toggle().getAttribute('aria-checked')).toBe('true');
  });

  it('충돌: 두 단추와 확인, 「잊기」, 다른 프로필 알림 목록, 「서버의 키 모두 지우기」 확인', async () => {
    const keys = fakeKeys({
      vault: VAULT,
      remembered: true,
      states: [row({ notice: 'conflict', remoteRevision: 2, localSeq: 1 }), row({ profileId: 'p2', notice: 'available' })],
    });
    const { app, confirmFn } = await setup({ keys, secrets: { kis: KIS } });
    void app;
    expect(screen.getByText(KEY_TEXT.conflictNotice)).toBeTruthy();
    await fireEvent.click(button('이 기기 키 올리기'));
    expect(confirmFn).toHaveBeenCalledWith(KEY_TEXT.uploadConfirm);
    await waitFor(() => expect(keys.uploadLocal).toHaveBeenCalledWith('p1'));
    await fireEvent.click(button('서버 키 받기'));
    await waitFor(() => expect(confirmFn).toHaveBeenCalledWith(KEY_TEXT.conflictReceive));
    await fireEvent.click(button('잊기'));
    expect(keys.forget).toHaveBeenCalled();
    expect(screen.getByRole('list', { name: '다른 프로필의 키 알림' }).textContent).toContain(KEY_TEXT.otherProfile);
    await fireEvent.click(button('서버의 키 모두 지우기'));
    expect(confirmFn).toHaveBeenCalledWith(KEY_TEXT.wipeConfirm);
    await waitFor(() => expect(keys.wipe).toHaveBeenCalled());
  });

  it('되감기 알림: 두 단추, 서버 키 받기는 예전 키 확인을 받는다, 이 기기에 키가 없으면 올리기 단추를 끈다', async () => {
    const confirmFn = vi.fn(() => true);
    const keys = fakeKeys({ vault: VAULT, remembered: true, states: [row({ notice: 'rollback', remoteRevision: 1, seenRevision: 3 })] });
    await setup({ keys, confirmFn });
    expect(screen.getByText(KEY_TEXT.rollback)).toBeTruthy();
    expect((button('이 기기 키 올리기') as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(button('서버 키 받기'));
    await waitFor(() => expect(confirmFn).toHaveBeenCalledWith(KEY_TEXT.rollbackReceive));
  });

  it('올릴 변경이 있는데 암호를 기억하지 않으면 안내와 「입력」', async () => {
    await setup({ keys: fakeKeys({ vault: VAULT, states: [row({ localSeq: 2, uploadedSeq: 1 })] }), secrets: { kis: KIS } });
    expect(screen.getByText(KEY_TEXT.pendingUpload)).toBeTruthy();
  });

  it('암호 분실: 입력 시트의 「암호를 잊었어요」가 전체 삭제 확인으로 간다', async () => {
    const confirmFn = vi.fn(() => true);
    const keys = fakeKeys({ vault: VAULT });
    await setup({ keys, confirmFn, secrets: { kis: KIS } });
    await fireEvent.click(button('동기화 암호 입력'));
    await fireEvent.click(await screen.findByRole('button', { name: '암호를 잊었어요' }));
    expect(confirmFn).toHaveBeenCalledWith(KEY_TEXT.wipeConfirm);
    await waitFor(() => expect(keys.wipe).toHaveBeenCalled());
  });

  it.each([
    new StoredKeysNotRemovedError(),
    new KeyLockNotSavedError('lock', 'cleared'),
  ])('받기 저장 오류는 기존 키 보호 문구로 보인다: %s', async (error) => {
    const keys = fakeKeys(
      { vault: VAULT, remembered: true, states: [row({ notice: 'newer', remoteRevision: 2 })] },
      { commitReceive: vi.fn(async () => ({ ok: false as const, message: KEY_TEXT.server, error })) },
    );
    await setup({ keys });
    await fireEvent.click(button('받기'));
    expect((await screen.findByRole('alert')).textContent?.trim()).toBe(
      error instanceof KeyLockNotSavedError ? keyLockFailureText(error) : KEYS_NOT_REMOVED,
    );
  });

  it('암호 바꾸기: 현재 암호 오류를 연결하고 새 암호 확인 뒤 바꾼다', async () => {
    const keys = fakeKeys({ vault: VAULT, remembered: true }, {
      changePassphrase: vi.fn()
        .mockResolvedValueOnce({ ok: false, message: KEY_TEXT.wrongPass })
        .mockResolvedValueOnce({ ok: true, notes: [] }),
    });
    await setup({ keys });
    await fireEvent.click(button('동기화 암호 바꾸기'));
    const current = await screen.findByLabelText('현재 동기화 암호') as HTMLInputElement;
    const pass = screen.getByLabelText('새 동기화 암호') as HTMLInputElement;
    const confirm = screen.getByLabelText('새 동기화 암호 확인') as HTMLInputElement;
    expect(current.autocomplete).toBe('current-password');
    expect(pass.autocomplete).toBe('new-password');
    expect(confirm.autocomplete).toBe('new-password');
    await fireEvent.input(current, { target: { value: 'FAKE-wrong-current' } });
    await fireEvent.input(pass, { target: { value: 'FAKE-new-sync-pass' } });
    await fireEvent.input(confirm, { target: { value: 'FAKE-new-sync-pass' } });
    await fireEvent.click(button('확인'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(KEY_TEXT.wrongPass);
    expect(current.getAttribute('aria-describedby')).toBe(alert.id);
    expect(current.getAttribute('aria-invalid')).toBe('true');
    expect([current.value, pass.value, confirm.value]).toEqual(['', '', '']);
    await fireEvent.input(current, { target: { value: 'FAKE-current-sync-pass' } });
    await fireEvent.input(pass, { target: { value: 'FAKE-new-sync-pass' } });
    await fireEvent.input(confirm, { target: { value: 'FAKE-new-sync-pass' } });
    await fireEvent.click(button('확인'));
    await waitFor(() => expect(keys.changePassphrase).toHaveBeenLastCalledWith('FAKE-current-sync-pass', 'FAKE-new-sync-pass'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('암호 바꾸기: 같은 암호 오류를 새 암호 칸에 연결한다', async () => {
    const keys = fakeKeys({ vault: VAULT }, { changePassphrase: vi.fn(async () => ({ ok: false as const, message: KEY_TEXT.samePass })) });
    await setup({ keys });
    await fireEvent.click(button('동기화 암호 바꾸기'));
    for (const label of ['현재 동기화 암호', '새 동기화 암호', '새 동기화 암호 확인']) {
      await fireEvent.input(screen.getByLabelText(label), { target: { value: 'FAKE-same-sync-pass' } });
    }
    await fireEvent.click(button('확인'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(KEY_TEXT.samePass);
    expect(screen.getByLabelText('새 동기화 암호').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('새 동기화 암호').getAttribute('aria-describedby')).toBe(alert.id);
    expect(screen.getByLabelText('현재 동기화 암호').getAttribute('aria-invalid')).toBeNull();
  });

  it('동기화 암호를 모르는 잠금 기기는 받기 시트에서 두 암호를 함께 받는다', async () => {
    const keys = fakeKeys({ vault: VAULT, states: [row({ notice: 'newer', remoteRevision: 2 })] });
    await setup({ keys, keyLock: true });
    await fireEvent.click(button('받기'));
    await fireEvent.input(await screen.findByLabelText('동기화 암호'), { target: { value: 'FAKE-sync-pass' } });
    await fireEvent.input(screen.getByLabelText('이 기기 잠금 암호'), { target: { value: 'FAKE-lock-pass' } });
    await fireEvent.click(button('확인'));
    await waitFor(() => expect(keys.commitReceive).toHaveBeenCalledWith('FAKE-lock-pass'));
    expect(keys.unlockVault).toHaveBeenCalledWith('FAKE-sync-pass');
    expect(keys.prepareReceive).toHaveBeenCalledWith('p1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('받을 키 준비 뒤 화면을 떠나면 컨트롤러의 평문을 버린다', async () => {
    const keys = fakeKeys(
      { vault: VAULT, remembered: true, states: [row({ notice: 'newer', remoteRevision: 2 })] },
      { prepareReceive: vi.fn(async () => ({ ok: true as const, overwrite: ['kis' as const] })) },
    );
    const confirmFn = vi.fn(() => {
      expect(keys.prepareReceive).toHaveBeenCalledWith('p1');
      expect(keys.cancelReceive).not.toHaveBeenCalled();
      cleanup();
      expect(keys.cancelReceive).toHaveBeenCalledTimes(1);
      expect(keys.commitReceive).not.toHaveBeenCalled();
      return false;
    });
    await setup({ keys, secrets: { kis: KIS }, confirmFn });
    await fireEvent.click(button('받기'));
    await waitFor(() => expect(confirmFn).toHaveBeenCalledWith(KEY_TEXT.overwrite(['kis'])));
    expect(keys.commitReceive).not.toHaveBeenCalled();
  });

  it('axe 위반 0: 켜진 상태, 위험 안내, 암호 정하기 오류', async () => {
    const { container } = await setup({
      keys: fakeKeys({ vault: VAULT, remembered: true, states: [row({ providers: ['kis', 'toss'], notice: 'newer', remoteRevision: 2 }), row({ profileId: 'p2', notice: 'available' })] }),
      secrets: { kis: KIS, toss: TOSS },
    });
    await expectNoAxeViolations(container);
    cleanup();
    await setup({ secrets: { kis: KIS } });
    await openRisk();
    await expectNoAxeViolations(document.body);
    await fireEvent.click(checkbox('위 내용을 이해했어요'));
    await fireEvent.click(button('계속'));
    await screen.findByText('동기화 암호 정하기');
    await fireEvent.input(screen.getByLabelText('동기화 암호'), { target: { value: 'short' } });
    await fireEvent.input(screen.getByLabelText('동기화 암호 확인'), { target: { value: 'short' } });
    await fireEvent.click(button('확인'));
    await screen.findByRole('alert');
    await expectNoAxeViolations(document.body);
  });
});
