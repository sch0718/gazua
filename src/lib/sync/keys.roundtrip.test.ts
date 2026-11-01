// @vitest-environment jsdom
// 키 동기화 왕복(설계 7.7)과 공유 경로 누출 고정(7.6)을 실제 앱·엔진·키 단계·sync-worker 핸들러(테스트용 D1)로 확인한다.
// 키 값은 모두 지어낸 값이다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type App } from '../state/app.svelte';
import { profileKeys } from '../state/profileStore';
import type { Secrets } from '../state/secrets';
import { createSafeStorage, type SafeStorage } from '../state/storage';
import { memoryBacking } from '../state/testStorage';
import { createMemoryOrderCache } from '../perf/orderCache';
import { compareSnapshot } from '../share/compact';
import { IMPORT_KEY, stashImport } from '../share/pendingImport';
import { criteriaSnapshot, groupSnapshot, strategySnapshot, type ShareSnapshot } from '../share/snapshot';
import { NOW as FIXTURE_NOW, simResultFixture, validationFixture } from '../share/testFixtures';
import { newCriteria } from '../screen/defaults';
import { newStrategy } from '../sim/defaults';
import { deviceApi, testServer, type TestServer } from '../../../sync-worker/test/server';
import { purge } from '../../../sync-worker/src/purge';
import { DAY } from '../../../sync-worker/src/env';
import type { SyncApi } from './api';
import { createSyncEngine, type SyncEngine } from './engine';
import { checkVerifier, deriveVaultKey, makeVerifier, randomId } from './keyCrypto';
import { createMemoryKeyStore, type KeyStore } from './keyStore';
import { createKeySync, KEY_TEXT, type KeySync, type VaultKey } from './keySync';
import { checkVaultHead, KEY_ITER, type KeyProvider } from './keyWire';
import { appProfiles } from './local';
import { createMemorySyncStore, type SyncStore } from './store';

vi.setConfig({ testTimeout: 120_000 });

const PASS = 'FAKE-sync-pass-0001';
const PASS2 = 'FAKE-sync-pass-0002';
const KIS_A = { appKey: 'FAKE-kis-appkey-AAAA', appSecret: 'FAKE-kis-secret-AAAA' };
const KIS_B = { appKey: 'FAKE-kis-appkey-BBBB', appSecret: 'FAKE-kis-secret-BBBB' };
const KIS_C = { appKey: 'FAKE-kis-appkey-CCCC', appSecret: 'FAKE-kis-secret-CCCC' };
const TOSS_A = { clientId: 'FAKE-toss-client-AAAA', clientSecret: 'FAKE-toss-secret-AAAA' };
const TOSS_B = { clientId: 'FAKE-toss-client-BBBB', clientSecret: 'FAKE-toss-secret-BBBB' };
const TOKEN = { accessToken: 'FAKE-access-token', expiresAt: Date.UTC(2030, 0, 1) };

interface Device {
  app: App;
  storage: SafeStorage;
  engine: SyncEngine;
  store: SyncStore;
  keyStore: KeyStore;
  keys: KeySync;
  api: SyncApi;
  vault: { key: VaultKey | null };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
  location.hash = '';
  sessionStorage.clear();
});

async function device(s: TestServer): Promise<Device> {
  const storage = createSafeStorage(memoryBacking());
  const store = createMemorySyncStore();
  const keyStore = createMemoryKeyStore();
  const { api } = await deviceApi(s);
  const vault = { key: null as VaultKey | null };
  let engine: SyncEngine | null = null;
  const app = createApp({
    storage,
    now: () => s.h.clock.now,
    orderCache: createMemoryOrderCache(),
    onSyncableChange: (e) => {
      if (e.kind === 'deleted') void engine?.profileDeleted(e.profileId);
      else engine?.profileChanged(e.profileId);
    },
    onSecretsChange: (e) => void keyStore.bumpSeq(e.profileId, e.providers),
  });
  const keys = createKeySync({
    store: keyStore,
    api,
    app,
    now: () => s.h.clock.now,
    profileState: async (id) => {
      const st = await store.state(id);
      return { uploaded: !!st && st.syncedRevision > 0 && !st.deleted };
    },
    vaultKey: () => vault.key,
    setVaultKey: (k) => (vault.key = k),
    sessionOk: async () => true,
  });
  engine = createSyncEngine({
    local: appProfiles(app, storage),
    store,
    api,
    now: () => s.h.clock.now,
    setTimer: () => 0,
    clearTimer: () => {},
    keys: { step: () => keys.step(), reset: () => keys.reset() },
  });
  await engine.init();
  await engine.setEnabled(true);
  cleanups.push(() => {
    engine!.destroy();
    app.destroy();
  });
  return { app, storage, engine, store, keyStore, keys, api, vault };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
async function setKeys(d: Device, s: Secrets, lockPass?: string) {
  await d.app.setSecrets(s, lockPass);
  await settle(); // onSecretsChange의 bumpSeq
}
async function createVault(d: Device, pass = PASS) {
  const vaultId = randomId();
  const salt = randomId();
  const key = await deriveVaultKey(pass, salt, KEY_ITER);
  const verifier = await makeVerifier(key, vaultId, 1);
  return d.engine.exclusive(() => d.keys.createVault({ key, vaultId, salt, verifier }));
}
async function unlock(d: Device, pass = PASS) {
  const r = await d.api.listKeys();
  if (!r.ok) throw new Error(`listKeys ${r.kind}`);
  const h = checkVaultHead(r.data.keyVault)!;
  const key = await deriveVaultKey(pass, h.salt, h.iter);
  expect(await checkVerifier(key, h.verifier, h.vaultId, h.vaultRevision)).toBe(true);
  d.vault.key = { key, vaultId: h.vaultId, salt: h.salt, vaultRevision: h.vaultRevision };
}
const enable = (d: Device, providers: KeyProvider[] = ['kis']) => d.engine.exclusive(() => d.keys.enable(d.app.meta.activeProfileId, providers));
async function receive(d: Device, lockPass?: string) {
  const id = d.app.meta.activeProfileId;
  const p = await d.engine.exclusive(() => d.keys.prepareReceive(id));
  if (!p.ok) return p;
  return d.engine.exclusive(() => d.keys.commitReceive(p.prepared, lockPass));
}
const state = (d: Device, id: string) => d.keyStore.state(id);
const keyRows = (s: TestServer) => s.h.env.DB.raw.prepare('SELECT * FROM key_blobs ORDER BY profile_id').all() as Record<string, unknown>[];
/** D1 키 행을 그 시점으로 되돌린다(Time Travel 흉내) */
function restoreKeyRows(s: TestServer, rows: Record<string, unknown>[]) {
  s.h.env.DB.raw.exec('DELETE FROM key_blobs');
  const ins = s.h.env.DB.raw.prepare(
    'INSERT INTO key_blobs (user_id, profile_id, revision, vault_revision, content_id, nonce, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const r of rows) ins.run(r.user_id as string, r.profile_id as string, r.revision as number, r.vault_revision as number, r.content_id as string | null, r.nonce as string | null, r.ciphertext as string | null, r.updated_at as number);
}
/** A가 KIS 키로 켜고, B가 같은 프로필로 들어와 키 단계까지 돈 상태 */
async function pair(s: TestServer) {
  const a = await device(s);
  await setKeys(a, { kis: KIS_A, proxyToken: 'FAKE-proxy-A' });
  expect(await createVault(a)).toEqual({ ok: true, notes: [] });
  expect(await enable(a)).toEqual({ ok: true, notes: [] });
  const id = a.app.meta.activeProfileId;
  const b = await device(s);
  b.app.switchProfile(id);
  await setKeys(b, { toss: TOSS_B, proxyToken: 'FAKE-proxy-B' });
  b.storage.set(profileKeys.token(id, 'toss'), TOKEN);
  await b.engine.syncNow();
  return { a, b, id };
}

describe('두 기기 왕복(설계 7.7)', () => {
  it('A 켬 → B available → 받기(KIS만 병합) → A가 고치면 자동으로 올라가고 B newer → 받기', async () => {
    const s = testServer();
    const { a, b, id } = await pair(s);
    expect(await state(b, id)).toMatchObject({ active: true, revision: 0, notice: 'available' });
    await unlock(b);
    expect(await receive(b)).toMatchObject({ ok: true, notes: [KEY_TEXT.received] });
    expect(b.app.secrets).toEqual({ kis: KIS_A, toss: TOSS_B, proxyToken: 'FAKE-proxy-B' });
    expect(b.storage.get(profileKeys.token(id, 'toss'), null)).toEqual(TOKEN);

    await setKeys(a, { kis: KIS_B, proxyToken: 'FAKE-proxy-A' });
    await a.engine.keysNow();
    expect((await state(a, id))?.revision).toBe(2);
    await b.engine.keysNow();
    expect(await state(b, id)).toMatchObject({ notice: 'newer', remoteRevision: 2 });
    expect((await receive(b)).ok).toBe(true);
    expect(b.app.secrets?.kis).toEqual(KIS_B);
  });

  it('A가 켠 rev 1 행을 키 상태가 빈 B가 켜면 PUT 없이 conflict이고 서버 암호문은 그대로', async () => {
    const s = testServer();
    const { b, id } = await pair(s);
    await setKeys(b, { kis: KIS_B, toss: TOSS_B, proxyToken: 'FAKE-proxy-B' });
    await unlock(b);
    await b.keyStore.clear(); // 프로필 동기화 상태는 두고 키 상태만 빈 기기를 만든다.
    expect(await state(b, id)).toBeUndefined();
    const before = keyRows(s);
    expect(before).toEqual([expect.objectContaining({ revision: 1, ciphertext: expect.any(String) })]);
    const requestCount = s.requests.length;

    expect(await enable(b)).toEqual({ ok: true, notes: [] });
    expect(await state(b, id)).toMatchObject({ active: true, revision: 0, notice: 'conflict', remoteRevision: 1 });
    expect(s.requests.slice(requestCount).filter((r) => r.method === 'PUT')).toEqual([]);
    expect(keyRows(s)).toEqual(before);
  });

  it('A·B 둘 다 고치면 늦은 쪽이 conflict → 「이 기기 키 올리기」 또는 「서버 키 받기」', async () => {
    const s = testServer();
    const { a, b, id } = await pair(s);
    await unlock(b);
    await receive(b);
    await setKeys(a, { kis: KIS_B, proxyToken: 'FAKE-proxy-A' });
    await a.engine.keysNow();
    await setKeys(b, { kis: KIS_C, toss: TOSS_B, proxyToken: 'FAKE-proxy-B' });
    await b.engine.keysNow();
    expect(await state(b, id)).toMatchObject({ notice: 'conflict', remoteRevision: 2 });
    // 이 기기 키 올리기
    expect(await b.engine.exclusive(() => b.keys.uploadLocal(id))).toEqual({ ok: true, notes: [] });
    expect((await state(b, id))?.revision).toBe(3);
    await a.engine.keysNow();
    expect((await state(a, id))?.notice).toBe('newer');
    // 다시 충돌을 만들어 서버 키 받기
    await setKeys(a, { kis: KIS_A, proxyToken: 'FAKE-proxy-A' });
    await setKeys(b, { kis: KIS_B, toss: TOSS_B, proxyToken: 'FAKE-proxy-B' });
    await a.engine.keysNow();
    expect((await state(a, id))?.notice).toBe('conflict');
    expect(await a.engine.exclusive(() => a.keys.uploadLocal(id))).toEqual({ ok: true, notes: [] });
    await b.engine.keysNow();
    expect((await state(b, id))?.notice).toBe('conflict');
    expect((await receive(b)).ok).toBe(true);
    expect(b.app.secrets?.kis).toEqual(KIS_A);
    const st = (await state(b, id))!;
    expect(st.localSeq).toBe(st.uploadedSeq);
  });

  it('공급자: KIS만 받으면 B의 토스 키·토큰은 그대로, A가 토스를 더하면 바뀌고, 다시 빼면 B 토스 키는 남고 안내', async () => {
    const s = testServer();
    const { a, b, id } = await pair(s);
    await unlock(b);
    await receive(b);
    expect(b.app.secrets?.toss).toEqual(TOSS_B);
    await setKeys(a, { kis: KIS_A, toss: TOSS_A, proxyToken: 'FAKE-proxy-A' });
    await a.engine.exclusive(() => a.keys.setProviders(id, ['kis', 'toss']));
    await a.engine.keysNow();
    await b.engine.keysNow();
    expect((await state(b, id))?.notice).toBe('newer');
    expect((await receive(b)).ok).toBe(true);
    expect(b.app.secrets?.toss).toEqual(TOSS_A);
    expect(b.storage.get(profileKeys.token(id, 'toss'), null)).toBeNull();
    await a.engine.exclusive(() => a.keys.setProviders(id, ['kis']));
    await a.engine.keysNow();
    await b.engine.keysNow();
    expect((await state(b, id))?.notice).toBe('newer');
    expect(await receive(b)).toEqual({ ok: true, notes: [KEY_TEXT.sameKeys, KEY_TEXT.dropped('toss')] });
    expect(b.app.secrets?.toss).toEqual(TOSS_A);
  });

  it('A 끔 → B removed(키는 남고, dirty여도 올리지 않음) → A 다시 켬 → 리비전이 이어지고 B available', async () => {
    const s = testServer();
    const { a, b, id } = await pair(s);
    await unlock(b);
    await receive(b);
    await setKeys(b, { kis: KIS_C, toss: TOSS_B, proxyToken: 'FAKE-proxy-B' });
    expect(await a.engine.exclusive(() => a.keys.disable(id))).toEqual({ ok: true, notes: [] });
    await b.engine.keysNow();
    expect(await state(b, id)).toMatchObject({ active: false, notice: 'removed' });
    expect(b.app.secrets?.kis).toEqual(KIS_C);
    expect(keyRows(s)[0]).toMatchObject({ revision: 2, ciphertext: null });
    expect(await enable(a)).toEqual({ ok: true, notes: [] });
    expect(keyRows(s)[0]).toMatchObject({ revision: 3 });
    await b.engine.keysNow();
    expect((await state(b, id))?.notice).toBe('available');
  });

  it('끄기 직전 블롭을 서버가 다시 내줘도 받지 않는다: B가 알림을 안 닫음·닫음·끈 기기 A', async () => {
    const s = testServer();
    const { a, b, id } = await pair(s);
    await unlock(b);
    await receive(b);
    const before = keyRows(s);
    expect(await a.engine.exclusive(() => a.keys.disable(id))).toEqual({ ok: true, notes: [] });
    await b.engine.keysNow();
    expect((await state(b, id))?.notice).toBe('removed');
    restoreKeyRows(s, before);
    await b.engine.keysNow();
    expect(await state(b, id)).toMatchObject({ active: false, notice: 'removed' });
    await b.keys.dismiss(id);
    await b.engine.keysNow();
    expect(await state(b, id)).toMatchObject({ active: false, notice: null });
    await a.engine.keysNow();
    expect(await state(a, id)).toMatchObject({ active: false, notice: null });
  });

  it('D1 되감기: 켜진 기기는 rollback, 「서버 키 받기」·「이 기기 키 올리기」로 빠져나오고, 끄고 다시 켜도 된다', async () => {
    const s = testServer();
    const { a, b, id } = await pair(s);
    await unlock(b);
    await receive(b);
    const r1 = keyRows(s);
    await setKeys(a, { kis: KIS_B, proxyToken: 'FAKE-proxy-A' });
    await a.engine.keysNow();
    await b.engine.keysNow();
    await receive(b);
    restoreKeyRows(s, r1);
    await a.engine.keysNow();
    await b.engine.keysNow();
    expect(await state(a, id)).toMatchObject({ notice: 'rollback', remoteRevision: 1 });
    expect(await state(b, id)).toMatchObject({ notice: 'rollback', remoteRevision: 1 });
    expect((await receive(b)).ok).toBe(true);
    expect(b.app.secrets?.kis).toEqual(KIS_A);
    expect(await a.engine.exclusive(() => a.keys.uploadLocal(id))).toEqual({ ok: true, notes: [] });
    expect(keyRows(s)[0]).toMatchObject({ revision: 3 });
    await b.engine.keysNow();
    expect((await state(b, id))?.notice).toBe('newer');
    expect((await a.engine.exclusive(() => a.keys.disable(id))).ok).toBe(true);
    expect((await enable(a)).ok).toBe(true);
    expect(keyRows(s)[0]).toMatchObject({ revision: 5 });
  });

  it('복구 뒤 번호 겹침: 본 리비전 3인 C가 4로 올리면 옛 4를 맞춘 B는 newer, rekey 뒤에도 newer, 삭제 표시는 removed', async () => {
    const s = testServer();
    const { a, b, id } = await pair(s);
    await unlock(b);
    await setKeys(a, { kis: KIS_B, proxyToken: 'FAKE-proxy-A' });
    await a.engine.keysNow(); // 2
    await setKeys(a, { kis: KIS_C, proxyToken: 'FAKE-proxy-A' });
    await a.engine.keysNow(); // 3
    const r3 = keyRows(s);
    await setKeys(a, { kis: KIS_A, proxyToken: 'FAKE-proxy-A' });
    await a.engine.keysNow(); // 4
    await b.engine.keysNow();
    await receive(b); // B는 리비전 4(KIS_A)를 맞춤
    restoreKeyRows(s, r3);
    const c = await device(s);
    c.app.switchProfile(id);
    await c.engine.syncNow();
    await unlock(c);
    expect((await receive(c)).ok).toBe(true); // C는 리비전 3을 봄
    await setKeys(c, { kis: KIS_B });
    await c.engine.keysNow();
    expect(keyRows(s)[0]).toMatchObject({ revision: 4 });
    await b.engine.keysNow();
    expect(await state(b, id)).toMatchObject({ notice: 'newer', remoteRevision: 4 });
    const salt = randomId();
    const nextKey = await deriveVaultKey(PASS2, salt, KEY_ITER);
    expect(await c.engine.exclusive(() => c.keys.rekey({ key: nextKey, salt }))).toEqual({ ok: true, notes: [] });
    await b.engine.keysNow();
    expect(await b.keyStore.getMeta('keyNotice')).toBe('vault-changed');
    expect((await state(b, id))?.notice).toBe('newer');
    // 다시 되감아 B가 본 리비전(4)보다 낮은 2로 두고 A가 끈다: 삭제 표시(3)는 되감기가 아니라 removed
    restoreKeyRows(s, r3.map((r) => ({ ...r, revision: 2, vault_revision: 2 })));
    await a.engine.keysNow();
    await unlock(a, PASS2);
    expect(await a.engine.exclusive(() => a.keys.disable(id))).toEqual({ ok: true, notes: [] });
    await b.engine.keysNow();
    expect(await state(b, id)).toMatchObject({ active: false, notice: 'removed' });
  });

  it('정리된 프로필을 같은 ID로 다시 올려 키를 켜면 리비전이 이어지고, 정리 전 리비전 1 암호문은 받지 않는다', async () => {
    const s = testServer();
    const { a, b, id } = await pair(s);
    await unlock(b);
    await receive(b);
    const r1 = keyRows(s);
    b.app.deleteProfile(id);
    await settle();
    await b.engine.syncNow();
    expect(keyRows(s)[0]).toMatchObject({ revision: 2, ciphertext: null });
    await purge(s.h.env, s.h.clock.now + 31 * DAY);
    await a.engine.syncNow();
    expect(a.engine.status().conflicts.map((c) => c.profileId)).toEqual([id]);
    await a.engine.resolve(id, 'restore');
    expect(await enable(a)).toEqual({ ok: true, notes: [] });
    expect(keyRows(s)[0]).toMatchObject({ revision: 3 });
    await b.engine.syncNow();
    b.app.switchProfile(id);
    await b.engine.keysNow();
    expect((await state(b, id))?.notice).toBe('available');
    expect((await receive(b)).ok).toBe(true);
    restoreKeyRows(s, r1);
    await b.engine.keysNow();
    expect(await state(b, id)).toMatchObject({ notice: 'rollback', revision: 3 });
  });

  it('A가 프로필을 지우면 서버 암호문이 없어지고, B pull이 프로필을 지우며 키 상태는 active false로 남는다', async () => {
    const s = testServer();
    const { a, b, id } = await pair(s);
    a.app.addProfile('다른 프로필');
    a.app.deleteProfile(id);
    await settle();
    await a.engine.syncNow();
    expect(keyRows(s)[0]).toMatchObject({ ciphertext: null, nonce: null, content_id: null });
    await b.engine.syncNow();
    expect(b.app.meta.profiles.some((p) => p.id === id)).toBe(false);
    expect(await state(b, id)).toMatchObject({ active: false });
  });

  it('A 전체 삭제 → B vault-gone·키 잊음 → A가 새 암호로 다시 켜면 B는 상태를 비우고 available', async () => {
    const s = testServer();
    const { a, b, id } = await pair(s);
    await unlock(b);
    expect(await a.engine.exclusive(() => a.keys.wipe())).toEqual({ ok: true, notes: [] });
    await b.engine.keysNow();
    expect(b.vault.key).toBeNull();
    expect(await b.keyStore.getMeta('keyNotice')).toBe('vault-gone');
    expect(await state(b, id)).toBeUndefined();
    expect(await createVault(a, PASS2)).toEqual({ ok: true, notes: [] });
    expect(await enable(a)).toEqual({ ok: true, notes: [] });
    await b.engine.keysNow();
    expect((await state(b, id))?.notice).toBe('available');
  });

  it('A 암호 바꿈 → B vault-changed·옛 키 잊음·newer 없음 → 새 암호로 받으면 같은 키', async () => {
    const s = testServer();
    const { a, b, id } = await pair(s);
    await unlock(b);
    expect(await receive(b)).toEqual({ ok: true, notes: [KEY_TEXT.received] });
    const before = (await state(b, id))!;
    expect(before).toMatchObject({ notice: null, revision: 1, syncedContentId: keyRows(s)[0].content_id });
    const salt = randomId();
    const nextKey = await deriveVaultKey(PASS2, salt, KEY_ITER);
    expect(await a.engine.exclusive(() => a.keys.rekey({ key: nextKey, salt }))).toEqual({ ok: true, notes: [] });
    await b.engine.keysNow();
    expect(b.vault.key).toBeNull();
    expect(await b.keyStore.getMeta('keyNotice')).toBe('vault-changed');
    expect(await state(b, id)).toMatchObject({ notice: null, revision: before.revision, syncedContentId: before.syncedContentId });
    await unlock(b, PASS2);
    expect(await receive(b)).toEqual({ ok: true, notes: [KEY_TEXT.sameKeys] });
    expect(b.app.secrets?.kis).toEqual(KIS_A);
  });

  it('B 키 잠금 켬 상태에서 받기: 잠금 암호로 다시 봉하고, 다시 열면 같은 잠금 암호로 풀린다', async () => {
    const s = testServer();
    const { b, id } = await pair(s);
    await setKeys(b, { toss: TOSS_B, proxyToken: 'FAKE-proxy-B' }, 'FAKE-lock-pass');
    await unlock(b);
    expect((await receive(b, 'FAKE-lock-pass')).ok).toBe(true);
    b.app.lock();
    await b.app.unlock('FAKE-lock-pass');
    expect(b.app.secrets?.kis).toEqual(KIS_A);
    expect(JSON.stringify(b.storage.readBacking<unknown>(profileKeys.secrets(id), null))).not.toContain(KIS_A.appKey);
  });

  it('계정 전환(엔진 reset)이면 키 상태가 비고 마스터 키를 잊는다', async () => {
    const s = testServer();
    const { b } = await pair(s);
    await unlock(b);
    await b.engine.reset();
    expect(await b.keyStore.states()).toEqual([]);
    expect(b.vault.key).toBeNull();
  });
});

describe('공유 경로 누출 고정(설계 7.6)', () => {
  /** 이 서버의 fetch를 감싸 키 API 밖 요청 본문·응답 본문을 모은다. 기기 API를 만들기 전에 불러야 한다 */
  function tap(s: TestServer): { path: string; text: string }[] {
    const log: { path: string; text: string }[] = [];
    const inner = s.fetch;
    s.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
      if (init?.body) log.push({ path, text: String(init.body) });
      const res = await inner(input, init);
      log.push({ path, text: await res.clone().text() });
      return res;
    }) as typeof fetch;
    return log;
  }

  it('키를 켠 프로필의 공유 여섯 종류·프로필 문서·과거 리비전·가져오기 대기 값·D1 표에 평문 키와 키 암호문 조각이 없다', async () => {
    const s = testServer();
    s.h.clock.now = FIXTURE_NOW;
    const log = tap(s);
    const a = await device(s);
    const id = a.app.meta.activeProfileId;
    a.app.setWatchlists({ groups: [{ id: 'g-key', name: '반도체', items: [{ symbol: '005930', colorSlot: 1, hidden: false, addedAt: 1 }] }] });
    await setKeys(a, { kis: KIS_A, toss: TOSS_A, proxyToken: 'FAKE-proxy-A' });
    await createVault(a);
    expect(await enable(a, ['kis', 'toss'])).toEqual({ ok: true, notes: [] });
    a.app.renameProfile(id, '키 프로필');
    await a.engine.syncNow();

    const blob = keyRows(s)[0];
    const vault = s.h.env.DB.raw.prepare('SELECT * FROM key_vault').get() as Record<string, string>;
    const needles = [
      KIS_A.appKey,
      KIS_A.appSecret,
      TOSS_A.clientId,
      TOSS_A.clientSecret,
      blob.ciphertext as string,
      blob.nonce as string,
      blob.content_id as string,
      vault.salt,
      vault.vault_id,
      vault.verifier_nonce,
      vault.verifier_ciphertext,
    ];
    for (const n of needles) {
      expect(typeof n).toBe('string');
      expect(n.length).toBeGreaterThanOrEqual(16);
    }
    const clean = (where: string, text: string) => {
      for (const n of needles) expect(text.includes(n), `${where}에 비밀 조각`).toBe(false);
    };

    clean('exportData(false)', a.app.exportData(false));

    const group = a.app.watchlists.groups[0];
    const snaps: ShareSnapshot[] = [
      groupSnapshot(group),
      strategySnapshot(newStrategy(FIXTURE_NOW, group.id, '눌림목'), a.app.watchlists, { hideCapital: false, now: FIXTURE_NOW }),
      criteriaSnapshot(newCriteria(FIXTURE_NOW, null, '대형'), { baskets: [], strategies: [] }, { hideCapital: false, now: FIXTURE_NOW }),
      compareSnapshot(group, a.app.settings),
      simResultFixture(),
      validationFixture(),
    ];
    for (const snap of snaps) {
      const made = await a.api.createShare({ sourceProfileId: id, kind: snap.kind, snapshot: snap, ttlDays: 7 });
      expect(made.ok, snap.kind).toBe(true);
      if (!made.ok) continue;
      const read = await a.api.readShare(made.data.capability);
      expect(read.ok).toBe(true);
      clean(`GET /v1/public/share(${snap.kind})`, JSON.stringify(read));
      stashImport(snap, FIXTURE_NOW);
      clean(`sessionStorage(${snap.kind})`, sessionStorage.getItem(IMPORT_KEY) ?? '');
    }
    clean('GET /v1/shares', JSON.stringify(await a.api.listShares()));
    clean('GET /v1/profiles/:id', JSON.stringify(await a.api.getProfile(id)));
    const revs = await a.api.listRevisions(id);
    expect(revs.ok && revs.data.revisions.length).toBeGreaterThan(1);
    if (revs.ok) for (const r of revs.data.revisions) if (!r.deleted) clean(`revision ${r.revision}`, JSON.stringify(await a.api.getRevision(id, r.revision)));
    for (const e of log) if (!e.path.startsWith('/v1/keys')) clean(e.path, e.text);
    for (const t of ['shares', 'profiles', 'revisions']) clean(`D1 ${t}`, JSON.stringify(s.h.env.DB.raw.prepare(`SELECT * FROM ${t}`).all()));
  });
});
