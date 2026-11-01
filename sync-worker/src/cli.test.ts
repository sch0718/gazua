import { describe, expect, it } from 'vitest';
import { harness } from '../test/harness';

const columns = (h: ReturnType<typeof harness>, table: string) =>
  (h.env.DB.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

describe('0005 마이그레이션', () => {
  it('cli_grants 열 이름이 스펙과 같다', () => {
    expect(columns(harness(), 'cli_grants')).toEqual([
      'id', 'device_hash', 'user_code', 'label', 'ip_hash', 'status', 'user_id', 'interval_ms',
      'last_polled_at', 'consumed_token_hash', 'geo', 'created_at', 'expires_at',
    ]);
  });

  it('cli_tokens 열 이름이 스펙과 같다', () => {
    expect(columns(harness(), 'cli_tokens')).toEqual([
      'id', 'token_hash', 'user_id', 'label', 'scope', 'created_at', 'last_used_at', 'expires_at', 'revoked_at',
    ]);
  });

  it('device_hash·user_code·token_hash는 UNIQUE다', () => {
    const h = harness();
    const ins = (id: string, device: string, code: string) =>
      h.env.DB.raw
        .prepare(
          `INSERT INTO cli_grants (id, device_hash, user_code, label, ip_hash, status, interval_ms, created_at, expires_at)
           VALUES (?, ?, ?, 'l', 'ip', 'pending', 5000, 1, 2)`,
        )
        .run(id, device, code);
    ins('a', 'd1', 'BBBBBBBB');
    expect(() => ins('b', 'd1', 'CCCCCCCC')).toThrow(/UNIQUE/);
    expect(() => ins('c', 'd2', 'BBBBBBBB')).toThrow(/UNIQUE/);
  });

  it('하네스 env에 CLI_IP_SALT 기본값이 있다', () => {
    expect(harness().env.CLI_IP_SALT).toBe('test-cli-ip-salt');
  });
});
