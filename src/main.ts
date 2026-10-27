import { mount } from 'svelte';
import '@sch0718/ui-svelte/tokens.css';
import './lib/ui/tokens.css';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

export default app;
