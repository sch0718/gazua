// 실제 Node 자식 프로세스에서 잠금을 보유하거나 공유 파일에 임계 구역을 기록한다.
import { appendFileSync } from 'node:fs';
import { createFileLock } from '../fileLock';

const [dir, mode, logPath] = process.argv.slice(2);
const lock = createFileLock({ dir, name: 'toss', waitMs: 5000 });
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

process.once('message', async () => {
  if (mode === 'hold') {
    await lock(async () => {
      const command = new Promise<void>((resolve) => process.once('message', (message) => {
        if (message === 'exit') process.exit(0); // close/해제 없이 정상 종료
        resolve();
      }));
      process.send?.('locked');
      await command;
    });
  } else {
    for (let round = 0; round < 4; round++) {
      await lock(async () => {
        appendFileSync(logPath, `enter ${process.pid}\n`);
        await wait(10);
        appendFileSync(logPath, `leave ${process.pid}\n`);
      });
    }
  }
  process.disconnect();
});
process.send?.('ready');
