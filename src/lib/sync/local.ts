// 앱(App)을 동기화 엔진의 LocalProfiles로 잇는다. 읽기는 저장소에서 문서를 만들고, 쓰기는 앱의 같은 ID 적용 경로를 쓴다.
import type { App } from '../state/app.svelte';
import type { SafeStorage } from '../state/storage';
import type { LocalProfiles } from './engine';
import { buildProfileDoc } from './profileDoc';

export function appProfiles(app: App, storage: SafeStorage): LocalProfiles {
  return {
    list: () => app.meta.profiles.map((p) => ({ id: p.id, name: p.name })),
    read: (id) => buildProfileDoc(storage, id, app.meta.profiles.find((p) => p.id === id)?.name ?? ''),
    write: (id, doc) => app.applySyncedProfile(id, doc),
    remove: (id) => app.removeSyncedProfile(id),
    create(doc) {
      const p = app.addProfile(doc.name);
      app.applySyncedProfile(p.id, doc);
      return p.id;
    },
    durable: () => storage.persistent,
  };
}
