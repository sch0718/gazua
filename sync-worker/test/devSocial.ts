// 가짜 소셜 공급자를 로컬 D1과 함께 띄운다. 이 진입점은 절대 배포하지 않는다.
import { spawn } from 'node:child_process';

const port = Number(process.env.DEV_SOCIAL_PORT ?? 8788);
if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 5173 || port === 5174) throw new Error('DEV_SOCIAL_PORT는 5173·5174를 제외한 유효한 포트로 정해 주세요.');
const origin = process.env.DEV_APP_ORIGIN ?? 'http://localhost:5173';
const persist = '.wrangler/dev-social';

await new Promise<void>((resolve, reject) => {
  const child = spawn('corepack', ['pnpm', 'exec', 'wrangler', 'd1', 'migrations', 'apply', 'gazua-sync', '--local', '--persist-to', persist], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`로컬 마이그레이션 실패: ${code}`)));
});

const vars = {
  ALLOWED_ORIGINS: origin,
  SOCIAL_REDIRECT_URIS: `${origin}/auth/callback/`,
  FIREBASE_PROJECT_ID: 'dev-only',
  ALLOWED_EMAILS: '',
  ALLOWED_ACCOUNTS: process.env.DEV_ALLOWED_ACCOUNTS ?? 'kakao:dev-user,naver:dev-user',
  KAKAO_CLIENT_ID: 'dev-kakao',
  KAKAO_CLIENT_SECRET: 'dev-kakao-secret',
  NAVER_CLIENT_ID: 'dev-naver',
  NAVER_CLIENT_SECRET: 'dev-naver-secret',
};
console.log(`개발용 가짜 소셜 Worker를 http://localhost:${port}에서 시작해요. 실제 키를 쓰지 않으며 절대 배포하면 안 돼요.
앱의 .env.local에 아래 값을 넣고 개발 서버를 다시 시작해 주세요.
VITE_SYNC_API_URL=http://localhost:${port}
VITE_KAKAO_LOGIN_CLIENT_ID=dev-kakao
VITE_NAVER_LOGIN_CLIENT_ID=dev-naver
VITE_SOCIAL_DEV_MOCK=true`);
const dev = spawn('corepack', [
  'pnpm', 'exec', 'wrangler', 'dev', 'test/devSocialEntry.ts', '--local', '--port', String(port), '--persist-to', persist,
  ...Object.entries(vars).flatMap(([key, value]) => ['--var', `${key}:${value}`]),
], { stdio: 'inherit' });
process.on('SIGINT', () => dev.kill('SIGINT'));
process.on('SIGTERM', () => dev.kill('SIGTERM'));
dev.on('error', (error) => {
  console.error(`개발 Worker를 시작하지 못했어요: ${error.message}`);
  process.exitCode = 1;
});
dev.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1); });
