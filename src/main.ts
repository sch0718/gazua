import { mount } from 'svelte';
import '@sch0718/ui-svelte/tokens.css';
import './lib/ui/tokens.css';
import App from './App.svelte';
import { callbackPath, restoreReferrerPolicy, type SocialReturn } from './lib/sync/social';

const mountApp = (socialReturn: SocialReturn | null = null) => mount(App, { target: document.getElementById('app')!, props: { socialReturn } });

function clearCallbackQuery(href: string): void {
  const url = new URL(href);
  for (const key of ['code', 'state', 'error', 'error_description']) url.searchParams.delete(key);
  history.replaceState(history.state, '', url.href);
}

const href = location.href;
// 청크를 받기 전에 주소를 지우고, 콜백은 보관한 주소에서 읽는다.
if (location.pathname === callbackPath()) clearCallbackQuery(href);
const app = location.pathname === callbackPath()
  ? import('./lib/sync/socialFlow').then((m) => {
      const ret = m.takeSocialCallback({ location: { href, pathname: location.pathname }, history });
      if (!ret) restoreReferrerPolicy();
      return mountApp(ret);
    }).catch(() => {
      restoreReferrerPolicy();
      history.replaceState(null, '', import.meta.env.BASE_URL);
      return mountApp();
    })
  : mountApp();

export default app;
