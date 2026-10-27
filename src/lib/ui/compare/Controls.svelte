<script lang="ts">
  import { PERIOD_COUNTS } from '../../market/periods';
  import type { Venue, VenueMode } from '../../market/tradable';
  import type { Period, PeriodUnit } from '../../state/schema';
  import { Chip } from '@sch0718/ui-svelte';
  import { Segmented } from '@sch0718/ui-svelte';
  import { effectiveVenueMode } from './venue';

  // 컨트롤 줄(스펙 7.2-5): 기간 단위 + 개수 칩, 지표 칩, 거래소 세그먼트.
  let {
    period,
    venueMode,
    venues,
    autoVenue,
    metricLabel,
    onperiod,
    onvenue,
    onopenmetric,
  }: {
    period: Period;
    venueMode: VenueMode;
    /** 공급자가 주는 거래소 */
    venues: Venue[];
    /** 자동 모드가 지금 고른 거래소(시장 전체 기준). 세션 밖이면 null */
    autoVenue: 'KRX' | 'NXT' | null;
    metricLabel: string;
    onperiod: (p: Period) => void;
    onvenue: (v: VenueMode) => void;
    onopenmetric: () => void;
  } = $props();

  const UNITS: { value: PeriodUnit; label: string }[] = [
    { value: 'D', label: '일' },
    { value: 'W', label: '주' },
    { value: 'M', label: '월' },
    { value: 'Y', label: '년' },
  ];
  /** 단위를 바꿨을 때 지금 n을 쓸 수 없으면 고르는 기본값 */
  const DEFAULT_N: Record<PeriodUnit, number> = { D: 1, W: 2, M: 3, Y: 1 };
  const UNIFIED_ONLY = '토스는 통합 시세만 제공해요';
  const AUTO_NOTE = 'KRX 우선 · KRX가 쉴 때만 NXT';

  const counts = $derived(period.unit === 'W' || period.unit === 'M' ? PERIOD_COUNTS[period.unit] : []);
  const countSuffix = $derived(period.unit === 'W' ? '주' : '개월');

  const unifiedOnly = $derived(venues.length === 1 && venues[0] === 'UNIFIED');
  const mode = $derived(effectiveVenueMode(venues, venueMode));
  const venueOptions = $derived(
    (
      [
        ['AUTO', '자동'],
        ['KRX', 'KRX'],
        ['NXT', 'NXT'],
        ['UNIFIED', '통합'],
      ] as const
    ).map(([value, label]) => {
      const supported = value === 'AUTO' ? effectiveVenueMode(venues, 'AUTO') === 'AUTO' : venues.includes(value);
      return {
        value,
        label,
        sub: value === 'AUTO' && mode === 'AUTO' ? (autoVenue ?? '—') : undefined,
        disabled: !supported,
        reason: !supported ? (unifiedOnly ? UNIFIED_ONLY : '이 데이터 소스는 지원하지 않아요') : undefined,
      };
    }),
  );

  function pickUnit(v: string) {
    const unit = v as PeriodUnit;
    // 주↔월 사이에서만 n을 이어 쓴다(일·년의 n=1은 고른 값이 아니다).
    const carries = (unit === 'W' || unit === 'M') && (period.unit === 'W' || period.unit === 'M');
    const n = carries && PERIOD_COUNTS[unit].includes(period.n) ? period.n : DEFAULT_N[unit];
    onperiod({ unit, n });
  }
</script>

<div class="controls">
  <div class="row">
    <Segmented label="기간 단위" options={UNITS} value={period.unit} onchange={pickUnit} />
    {#if counts.length > 0}
      <div class="chips" role="group" aria-label="기간 길이">
        {#each counts as n (n)}
          <Chip selected={period.n === n} onclick={() => onperiod({ unit: period.unit, n })}>{n}{countSuffix}</Chip>
        {/each}
      </div>
    {/if}
    <Chip tone="metric" onclick={onopenmetric}>{metricLabel}</Chip>
  </div>
  <div class="row">
    <Segmented label="거래소" wide options={venueOptions} value={mode} onchange={(v) => onvenue(v as VenueMode)} />
    {#if unifiedOnly}
      <span class="note">{UNIFIED_ONLY}</span>
    {:else if mode === 'AUTO'}
      <span class="note">{AUTO_NOTE}</span>
    {/if}
  </div>
</div>

<style>
  .controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px var(--gutter) 8px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }
  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .note {
    font-size: 12px;
    color: var(--t2);
  }
</style>
