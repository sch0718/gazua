import type { RemoteMarketData, RemoteMarketMeta } from './remote';
import type { MarketDataStore } from './store';

export type MarketSourceMode = 'local' | 'remote' | 'none' | 'remote-error';
export function createMarketSource({ local, remote }: { local: Pick<MarketDataStore, 'info' | 'sectors'> & Partial<Pick<MarketDataStore, 'themes' | 'themeSymbols'>>; remote?: RemoteMarketData | null }) {
  let mode: MarketSourceMode = 'none';
  let meta: RemoteMarketMeta | undefined;
  return {
    mode: () => mode,
    async info() {
      const info = await local.info();
      if (info) { mode = 'local'; return info; }
      if (!remote) { mode = 'none'; return null; }
      try { meta = await remote.meta(); mode = 'remote'; return meta.info; }
      catch { mode = 'remote-error'; return null; }
    },
    async sectors() { return mode === 'local' ? local.sectors() : meta?.sectors ?? []; },
    async themes() { return mode === 'local' ? local.themes?.() ?? [] : (meta?.themes ?? []).map(({ code, name, symbols }) => ({ code, name, count: symbols.length })); },
    async themeSymbols(code: string) { return mode === 'local' ? local.themeSymbols?.(code) ?? [] : meta?.themes.find((t) => t.code === code)?.symbols ?? []; },
  };
}
