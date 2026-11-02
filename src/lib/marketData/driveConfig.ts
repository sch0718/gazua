// Drive 전달(선택 기능)은 빌드 변수 VITE_GOOGLE_DRIVE_CLIENT_ID가 있을 때만 켜진다(설계 8.1).
export function readDriveClientId(env: Record<string, unknown> = import.meta.env): string | null {
  const v = env.VITE_GOOGLE_DRIVE_CLIENT_ID;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}
