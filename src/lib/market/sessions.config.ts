import type { SessionSchedule } from './sessions';

// 세션 시간표 데이터. 시간표가 바뀌면 effectiveFrom이 더 늦은 항목을 추가한다.
// 근거: 스펙 2.3, 토스 캘린더 예시의 afterMarket.singlePriceAuctionEndTime 15:40.
export const SCHEDULES: SessionSchedule[] = [
  {
    effectiveFrom: '2026-09-14',
    sessions: [
      { venue: 'KRX', kind: 'auction', label: 'opening-auction', start: '08:30:00', end: '09:00:00' },
      { venue: 'KRX', kind: 'continuous', label: 'regular', start: '09:00:00', end: '15:20:00' },
      { venue: 'KRX', kind: 'auction', label: 'closing-auction', start: '15:20:00', end: '15:30:00' },
      {
        venue: 'KRX',
        kind: 'continuous',
        label: 'after',
        start: '16:00:00',
        end: '20:00:00',
        excludes: ['ETF', 'ETN'],
      },
      { venue: 'NXT', kind: 'continuous', label: 'pre', start: '08:00:00', end: '08:50:00' },
      { venue: 'NXT', kind: 'continuous', label: 'regular', start: '09:00:30', end: '15:20:00' },
      { venue: 'NXT', kind: 'auction', label: 'after-auction', start: '15:30:00', end: '15:40:00' },
      { venue: 'NXT', kind: 'continuous', label: 'after', start: '15:40:00', end: '20:00:00' },
    ],
  },
];
