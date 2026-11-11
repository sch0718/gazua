import { describe, expect, it } from 'vitest';
import { readAlertConfig } from './config';

describe('알람 설정', () => {
  const env = { GAZUA_ALERT_NTFY_TOPIC: 'testtopic-abcdefghijkl' };
  it('기본값을 채운다', () => {
    expect(readAlertConfig(env)).toEqual({ topic: env.GAZUA_ALERT_NTFY_TOPIC, server: 'https://ntfy.sh', spikeSigma: 2.5, cooldownMin: 0, dailyMax: 0, top: 5 });
  });
  it('문자열 숫자와 서버를 읽는다', () => {
    expect(readAlertConfig({ ...env, GAZUA_ALERT_SPIKE_SIGMA: '3', GAZUA_ALERT_COOLDOWN_MIN: '30', GAZUA_ALERT_DAILY_MAX: '2', GAZUA_ALERT_TOP: '8', GAZUA_ALERT_NTFY_SERVER: 'https://example.test///' })).toEqual({ topic: env.GAZUA_ALERT_NTFY_TOPIC, server: 'https://example.test', spikeSigma: 3, cooldownMin: 30, dailyMax: 2, top: 8 });
  });
  it('토픽이 없으면 설치를 안내한다', () => {
    expect(() => readAlertConfig({})).toThrow('GAZUA_ALERT_NTFY_TOPIC이 없어요. install.sh를 실행해 주세요');
  });
  it.each(['-1', 'abc', 'Infinity', ''])('잘못된 숫자 %s는 invalid-args다', (v) => {
    for (const key of ['SPIKE_SIGMA', 'COOLDOWN_MIN', 'DAILY_MAX', 'TOP']) {
      expect(() => readAlertConfig({ ...env, [`GAZUA_ALERT_${key}`]: v })).toThrow(expect.objectContaining({ code: 'invalid-args' }));
    }
  });
});
