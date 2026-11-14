import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

function mulberry32(seed) {
  return () => {
    let n = seed += 0x6d2b79f5;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

export const FINGER_SCRIPT = () => {
  const install = () => {
    if (window.__finger) return;
    let seed = 7;
    const random = () => {
      let n = seed += 0x6d2b79f5;
      n = Math.imul(n ^ n >>> 15, n | 1);
      n ^= n + Math.imul(n ^ n >>> 7, n | 61);
      return ((n ^ n >>> 14) >>> 0) / 4294967296;
    };
    const finger = document.createElement('div');
    finger.id = '__finger';
    finger.setAttribute('aria-hidden', 'true');
    finger.style.cssText = 'position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;box-sizing:border-box;border-radius:50%;background:rgba(255,255,255,.35);border:2px solid rgba(20,20,20,.55);box-shadow:0 2px 10px rgba(0,0,0,.35);pointer-events:none;z-index:2147483647;opacity:0;transition:opacity .2s';
    document.documentElement.append(finger);
    let x = 195, y = 700;
    const paint = (scale = 1) => { finger.style.transform = `translate(${x}px,${y}px) scale(${scale})`; };
    paint();
    window.__finger = {
      show() { finger.style.opacity = '1'; },
      move(toX, toY, ms) {
        const fromX = x, fromY = y;
        const dx = toX - x, dy = toY - y;
        const bend = (0.15 + random() * 0.1) * (random() < 0.5 ? -1 : 1);
        const cx = (x + toX) / 2 - dy * bend;
        const cy = (y + toY) / 2 + dx * bend;
        const start = performance.now();
        return new Promise((resolve) => {
          const step = (now) => {
            const t = Math.min(1, (now - start) / ms);
            const u = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
            x = (1 - u) ** 2 * fromX + 2 * (1 - u) * u * cx + u ** 2 * toX;
            y = (1 - u) ** 2 * fromY + 2 * (1 - u) * u * cy + u ** 2 * toY;
            paint();
            if (t < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        });
      },
      press() {
        paint(0.8);
        setTimeout(() => paint(), 120);
        const ripple = document.createElement('div');
        ripple.setAttribute('aria-hidden', 'true');
        ripple.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:44px;height:44px;margin:-22px 0 0 -22px;box-sizing:border-box;border-radius:50%;border:2px solid white;pointer-events:none;z-index:2147483647`;
        document.documentElement.append(ripple);
        const animation = ripple.animate([
          { transform: 'scale(1)', opacity: 0.5 },
          { transform: 'scale(2.5)', opacity: 0 },
        ], { duration: 450, easing: 'ease-out', fill: 'forwards' });
        animation.onfinish = () => ripple.remove();
      },
    };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
};

export function makeHuman(page, { expect, fixture }) {
  const random = mulberry32(7);
  let x = 195, y = 700;

  const h = {
    page, expect, fixture,
    wait: (ms) => sleep(ms),
    async scrollTo(locator) {
      await locator.waitFor({ state: 'visible' });
      await locator.evaluate((element) => {
        let parent = element.parentElement;
        while (parent) {
          if (/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) break;
          parent = parent.parentElement;
        }
        const scroller = parent ?? document.scrollingElement;
        if (!scroller) return;
        const rect = element.getBoundingClientRect();
        const from = scroller.scrollTop;
        const to = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight,
          from + rect.top + rect.height / 2 - innerHeight * 0.4));
        const distance = to - from;
        if (Math.abs(distance) < 8) return;
        const ms = Math.min(800, Math.max(500, Math.abs(distance) * 0.6));
        const start = performance.now();
        return new Promise((resolve) => {
          const step = (now) => {
            const t = Math.min(1, (now - start) / ms);
            const u = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
            scroller.scrollTop = from + distance * u;
            if (t < 1) requestAnimationFrame(step);
            else resolve();
          };
          requestAnimationFrame(step);
        });
      });
      await sleep(150);
    },
    async tap(locator) {
      await point(locator);
      await locator.click();
      await sleep(250);
    },
    async type(locator, text) {
      await h.tap(locator);
      await locator.pressSequentially(text, { delay: 110 + Math.floor(random() * 51) });
    },
    async select(locator, value) {
      await point(locator);
      await locator.selectOption(value);
      await sleep(300);
    },
    async chooseFile(locator, path) {
      const chooser = page.waitForEvent('filechooser');
      // 버튼을 못 누른 경우에도 대기 Promise의 거부를 놓치지 않아요.
      chooser.catch(() => {});
      await h.tap(locator);
      await (await chooser).setFiles(path);
    },
    // 누르지 않고 손가락만 가져가요(설명하는 동안 화면이 멈춰 보이지 않게).
    async point(locator) {
      await point(locator, { press: false });
      await sleep(250);
    },
    async nav(name) {
      await h.tap(page.getByRole('navigation').getByRole('button', { name, exact: true }));
    },
  };

  async function point(locator, { press = true } = {}) {
    await locator.waitFor({ state: 'visible' });
    let box = await locator.boundingBox();
    if (!box) throw new Error('누를 요소의 위치를 찾지 못했어요.');
    const viewport = page.viewportSize() ?? { width: 390, height: 844 };
    if (box.y < 0 || box.y + box.height > viewport.height || box.x < 0 || box.x + box.width > viewport.width) {
      await h.scrollTo(locator);
      box = await locator.boundingBox();
    }
    if (!box) throw new Error('스크롤 뒤 요소의 위치를 찾지 못했어요.');
    const toX = box.x + box.width * (0.5 + (random() - 0.5) * 0.3);
    const toY = box.y + box.height * (0.5 + (random() - 0.5) * 0.3);
    const ms = Math.min(900, Math.max(350, Math.hypot(toX - x, toY - y) * 1.2));
    await page.evaluate(({ toX, toY, ms }) => window.__finger.move(toX, toY, ms), { toX, toY, ms });
    x = toX; y = toY;
    if (!press) return;
    await sleep(120);
    await page.evaluate(() => window.__finger.press());
  }

  return h;
}

export async function startScreencast(page, dir) {
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const pending = new Set();
  let failure;
  let i = 0;
  const onFrame = ({ data, metadata, sessionId }) => {
    try {
      const file = join(dir, `${String(i++).padStart(6, '0')}.jpg`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      frames.push({ file, t: Number.isFinite(metadata?.timestamp) ? metadata.timestamp : Date.now() / 1000 });
    } catch (error) {
      failure ??= error;
    }
    const ack = cdp.send('Page.screencastFrameAck', { sessionId }).catch((error) => { failure ??= error; });
    pending.add(ack);
    ack.finally(() => pending.delete(ack));
  };
  cdp.on('Page.screencastFrame', onFrame);
  try {
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
  } catch (error) {
    cdp.off('Page.screencastFrame', onFrame);
    await cdp.detach();
    throw error;
  }
  let stopping;
  return {
    stop() {
      return stopping ??= (async () => {
        try {
          await cdp.send('Page.stopScreencast');
        } finally {
          cdp.off('Page.screencastFrame', onFrame);
          try { await Promise.all(pending); }
          finally { await cdp.detach(); }
        }
        if (failure) throw new Error(`화면 프레임을 저장하지 못했어요: ${failure.message}`);
        return { frames };
      })();
    },
  };
}
