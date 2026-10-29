import { mount } from 'svelte';
import '@sch0718/ui-svelte/tokens.css';
import './lib/ui/tokens.css';
import App from './App.svelte';
import { callbackPath, type SocialReturn } from './lib/sync/social';

const mountApp = (socialReturn: SocialReturn | null = null) => mount(App, { target: document.getElementById('app')!, props: { socialReturn } });

// 콜백 코드는 앱을 그리기 전에 읽고 주소에서 지운다.
const app = location.pathname === callbackPath()
  ? import('./lib/sync/socialFlow').then((m) => mountApp(m.takeSocialCallback({ location, history }))).catch(() => {
      history.replaceState(null, '', import.meta.env.BASE_URL);
      return mountApp();
    })
  : mountApp();

export default app;
