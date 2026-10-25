// 이 Worker가 쓰는 D1 기능만 적은 타입. @cloudflare/workers-types 전역 없이도 앱 쪽 테스트에서 가져다 쓸 수 있게 한다.
export interface D1Meta {
  changes: number;
}
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  /** 한 트랜잭션. 하나라도 실패하면 전부 되돌린다. */
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}
