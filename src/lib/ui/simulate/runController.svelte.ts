// 시뮬레이션 실행(스펙 7.4·7.5): 일봉을 받고 엔진을 돌린다. 결과는 메모리에만 두고 전략은 건드리지 않는다.
import type { Candle } from '../../data/metrics';
import { createSimMemo, loadSimData, type LoadProgress, type SimFailure, type SimMemo } from '../../sim/loadSimData';
import { simulate } from '../../sim/simulate';
import type { SimInput, SimResult, Strategy } from '../../sim/types';
import { resolveSymbols } from '../../sim/validate';
import type { App } from '../../state/app.svelte';
import { ApiError } from '../../providers/errors';
import { CANDLES_ERROR, dominantFault, META_ERROR } from '../compare/loadIssue';

export interface DoneMeta {
  venueLabel: string;
  fetchedAt: number;
  /** 실제 거래일 축의 첫날·마지막 날(요청 기간은 strategy.period) */
  from: string;
  to: string;
  demo: boolean;
  failed: SimFailure[];
  indexFailed: null | '받지 못했어요' | '기간 일부만 받았어요';
  benchmarkFailed: boolean;
  /** 종목 → 일봉(워밍업 포함). 거래 차트 시트가 쓴다 */
  candles: Record<string, Candle[]>;
  /** 종목·지정 종목 → 이름 */
  names: Record<string, string>;
  /** 실행한 작업본(비교 기준 이름·하락 조건 표시용) */
  strategy: Strategy;
}

/** 진행 부가 줄에 쓸 이번 실행의 범위: 전략 종목 수와 비교 종목 유무 */
export interface LoadScope {
  stocks: number;
  benchmark: boolean;
}

export type DoneState = { kind: 'done'; result: SimResult; meta: DoneMeta };

export type RunState =
  | { kind: 'idle' }
  | { kind: 'loading'; progress: LoadProgress; scope: LoadScope }
  | { kind: 'partial'; failed: SimFailure[]; proceed: () => void }
  | DoneState
  | { kind: 'noData'; failed: SimFailure[] }
  // 연결 오류(메타 실패, 또는 모든 종목이 `받지 못했어요`·`종목 정보를 받지 못했어요`). text는 오류 코드를 모를 때의 문구(없으면 메타 문구)
  | { kind: 'error'; error: unknown; text?: string }
  | { kind: 'crash' }; // 엔진 예외

export interface RunController {
  readonly state: RunState;
  run(strategy: Strategy): void;
  cancel(): void;
}

type RunApp = Pick<App, 'provider' | 'watchlists'>;

export function createRunController(app: RunApp, opts: { now?: () => number } = {}): RunController {
  const now = opts.now ?? Date.now;
  let state = $state.raw<RunState>({ kind: 'idle' });
  let runId = 0;
  let memo: SimMemo = createSimMemo();
  let memoProvider = app.provider;

  function cancel() {
    runId++;
    state = { kind: 'idle' };
  }

  function finish(id: number, input: SimInput, meta: Omit<DoneMeta, 'candles' | 'names'>) {
    if (id !== runId) return;
    let result: SimResult;
    try {
      result = simulate(input);
    } catch (e) {
      console.error('시뮬레이션 계산 실패', e);
      state = { kind: 'crash' };
      return;
    }
    const candles: Record<string, Candle[]> = {};
    const names: Record<string, string> = {};
    for (const s of input.stocks) {
      candles[s.symbol] = s.candles;
      names[s.symbol] = s.name;
    }
    for (const f of meta.failed) if (f.name) names[f.symbol] ??= f.name;
    if (input.benchmarkStock) names[input.benchmarkStock.symbol] ??= input.benchmarkStock.name;
    state = { kind: 'done', result, meta: { ...meta, candles, names } };
  }

  // 남은 종목이 없을 때: 실패가 전부 받지 못한 것(일봉·종목 정보)이면 데이터가 없는 게 아니라 연결 문제다.
  function noData(failed: SimFailure[]): RunState {
    const fetchFailed = (f: SimFailure) => f.reason === '받지 못했어요' || f.reason === '종목 정보를 받지 못했어요';
    if (failed.length > 0 && failed.every(fetchFailed)) {
      // 던진 오류 중 사용자가 먼저 고칠 수 있는 것(연결 → 키 …)을 대표로 쓴다
      const api = failed.map((f) => f.error).filter((e): e is ApiError => e instanceof ApiError);
      const best = dominantFault(api.map((e, i) => ({ code: e.code, at: i })));
      const text = failed.every((f) => f.reason === '종목 정보를 받지 못했어요') ? META_ERROR : CANDLES_ERROR;
      return { kind: 'error', error: best ? api[best.at] : new Error(text), text };
    }
    return { kind: 'noData', failed };
  }

  async function start(strategy: Strategy, id: number, symbols: string[], scope: LoadScope) {
    const provider = app.provider;
    // 공급자가 바뀌면 받은 일봉을 버린다.
    if (provider !== memoProvider) {
      memo = createSimMemo();
      memoProvider = provider;
    }
    const outcome = await loadSimData({
      provider,
      strategy,
      symbols,
      now: now(),
      memo,
      onProgress: (progress) => {
        if (id === runId) state = { kind: 'loading', progress, scope };
      },
      isCancelled: () => id !== runId,
    });
    if (id !== runId) return;
    if (!outcome.ok) {
      if ('error' in outcome) state = { kind: 'error', error: outcome.error };
      else if ('noData' in outcome) state = noData(outcome.failed);
      else state = { kind: 'idle' };
      return;
    }
    const { input, failed } = outcome;
    // 전략 종목이 하나도 남지 않으면 지수 날짜가 있어도 돌릴 것이 없다.
    if (input.stocks.length === 0) {
      state = noData(failed);
      return;
    }
    const meta = {
      venueLabel: outcome.venueLabel,
      fetchedAt: outcome.fetchedAt,
      from: input.days[0],
      to: input.days[input.days.length - 1],
      demo: provider.id === 'demo',
      failed,
      indexFailed: outcome.indexFailed,
      benchmarkFailed: outcome.benchmarkFailed,
      strategy,
    };
    if (failed.length === 0) return finish(id, input, meta);
    // 실패한 종목은 로더가 이미 뺐다.
    state = { kind: 'partial', failed, proceed: () => finish(id, input, meta) };
  }

  return {
    get state() {
      return state;
    },
    run(strategy) {
      const id = ++runId;
      const snapshot = $state.snapshot(strategy) as Strategy;
      const symbols = resolveSymbols(snapshot, app.watchlists);
      const scope = { stocks: symbols.length, benchmark: snapshot.benchmarks.symbol !== null };
      state = { kind: 'loading', progress: { done: 0, total: 0, waiting: false }, scope };
      start(snapshot, id, symbols, scope).catch((e) => {
        if (id !== runId) return;
        console.error('시뮬레이션 데이터 처리 실패', e);
        state = { kind: 'crash' };
      });
    },
    cancel,
  };
}
