// 정확한 앱 출처만 허용한다. CORS는 브라우저 보호일 뿐 인증을 대신하지 않는다(모든 개인 API는 토큰·세션을 따로 검사).

export const ALLOWED_METHODS = 'GET, POST, PUT, DELETE';
export const ALLOWED_HEADERS = 'Authorization, Content-Type, X-Gazua-Session, X-Share-Token';

export function allowedOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 요청 출처가 목록과 정확히 같으면 그 출처, 아니면 null. */
export function matchOrigin(req: Request, raw: string): string | null {
  const origin = req.headers.get('Origin');
  return origin !== null && allowedOrigins(raw).includes(origin) ? origin : null;
}

export function corsHeaders(origin: string): Record<string, string> {
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}

export function preflight(origin: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      'Access-Control-Allow-Methods': ALLOWED_METHODS,
      'Access-Control-Allow-Headers': ALLOWED_HEADERS,
      'Access-Control-Max-Age': '600',
      'Cache-Control': 'no-store',
    },
  });
}
