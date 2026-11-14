import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SCENES, VOICE, LEAD, GAP, TAIL } from './scenes.mjs';
import { FINGER_SCRIPT, makeHuman, startScreencast } from './human.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = resolve(process.env.DEMO_NARRATED_OUT ?? join(homedir(), 'gazua-data/demo-narrated'));
const WORK = join(OUT, 'work');
const SK = resolve(process.env.NARRATED_VIDEO_SCRIPTS ?? join(homedir(), '.claude/skills/narrated-video/scripts'));
const FPS = 30;
const SAMPLE_RATE = 48000;
const pad = (n) => String(n).padStart(3, '0');
const readJSON = (file) => JSON.parse(readFileSync(join(WORK, file), 'utf8'));
const writeJSON = (file, data) => writeFileSync(join(WORK, file), JSON.stringify(data, null, 2) + '\n');

function check() {
  const missing = ['tts.mjs', 'finish.sh'].map((name) => join(SK, name)).filter((file) => !existsSync(file));
  for (const name of ['uvx', 'ffmpeg', 'ffprobe']) {
    try { execFileSync('which', [name], { stdio: 'ignore' }); }
    catch { missing.push(name); }
  }
  if (missing.length) {
    console.error(`없어요: ${missing.join(', ')}`);
    process.exitCode = 1;
    return false;
  }
  const fromRoot = relative(ROOT, OUT);
  if (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`)) {
    throw new Error('DEMO_NARRATED_OUT은 저장소 밖 폴더로 정해 주세요.');
  }
  return true;
}

function lineList() {
  return SCENES.flatMap((s, si) => s.lines.map((l, li) => ({
    si, li, first: li === 0, last: li === s.lines.length - 1, ...l,
  })));
}

function script() {
  const content = [
    '# 가즈아 데모 영상 대본', '',
    '> scenes.mjs에서 만든 파일이에요. 고칠 때는 scenes.mjs를 고치고 `node scripts/demo-narrated/make.mjs script`를 다시 돌려요.',
    `> 음성: Edge TTS ${VOICE.id} (${VOICE.rate})`, '',
    ...SCENES.flatMap((s, i) => [
      `## ${i + 1}. ${s.title} — ${s.note}`, '',
      ...s.lines.map((l) => `- ${l.t}${l.say ? ` (읽기: ${l.say})` : ''}`), '',
    ]),
  ].join('\n');
  const file = fileURLToPath(new URL('./script.md', import.meta.url));
  writeFileSync(file, content);
  console.log(`대본을 만들었어요: ${file}`);
}

async function voice() {
  const { speak } = await import(pathToFileURL(join(SK, 'tts.mjs')).href);
  const voices = [];
  for (const l of lineList()) {
    const { file, dur } = await speak(VOICE, l.say ?? l.t, join(WORK, 'voice'), 'narr');
    voices.push({ si: l.si, li: l.li, t: l.t, file: resolve(file), dur });
  }
  writeJSON('voice.json', voices);
  console.log(`음성 ${voices.length}문장을 만들었어요. 합계 ${voices.reduce((n, l) => n + l.dur, 0).toFixed(1)}초예요.`);
}

async function record() {
  if (!existsSync(join(WORK, 'voice.json'))) throw new Error('voice.json이 없어요. voice 단계부터 실행해 주세요.');
  const voices = readJSON('voice.json');
  const lines = lineList();
  if (voices.length !== lines.length || lines.some((l, i) => {
    const v = voices[i];
    return v.si !== l.si || v.li !== l.li || v.t !== l.t || !Number.isFinite(v.dur) || v.dur <= 0;
  })) throw new Error('음성과 대본이 맞지 않아요. voice 단계부터 다시 실행해 주세요.');

  const { chromium, expect } = await import('@playwright/test');
  const { startPreview, envPort, openApp, FIXED_NOW } = await import('../lib/app-preview.mjs');
  let preview, browser, capture;
  try {
    preview = await startPreview({ port: envPort('DEMO_NARRATED_PORT', 4194) });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block',
    });
    context.setDefaultTimeout(15_000);
    await context.addInitScript((seen) => localStorage.setItem('gazua:help-seen:v1', JSON.stringify(seen)),
      ['compare', 'add', 'groups', 'simulate', 'criteria', 'performance', 'settings']);
    await context.addInitScript(FINGER_SCRIPT);
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(FIXED_NOW));
    await openApp(page, preview.url);
    await page.evaluate(() => window.__finger.show());
    await sleep(600);

    const dir = join(WORK, 'frames');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    capture = await startScreencast(page, dir);
    const t0 = Date.now() / 1000;
    const h = makeHuman(page, { expect, fixture: join(ROOT, 'tests/fixtures/market-data-demo.json.gz') });
    const marks = [];
    for (const [i, l] of lines.entries()) {
      const dur = voices[i].dur;
      const start = Date.now() / 1000 - t0;
      const pre = l.first ? LEAD : 0, post = l.last ? TAIL : GAP;
      marks.push({ si: l.si, li: l.li, start, voiceAt: start + pre, dur, t: l.t });
      try { if (l.do) await l.do(h); }
      catch (e) { throw new Error(`${SCENES[l.si].id} 「${l.t}」 조작에 실패했어요: ${e.message}`, { cause: e }); }
      const left = t0 + start + pre + dur + post - Date.now() / 1000;
      if (left > 0) await sleep(left * 1000);
    }
    const end = Date.now() / 1000 - t0;
    const { frames } = await capture.stop();
    capture = undefined;
    if (!frames.length) throw new Error('녹화 프레임을 받지 못했어요. record 단계를 다시 실행해 주세요.');
    writeJSON('frames.json', { end, frames: frames.map((f) => ({ file: f.file, t: f.t - t0 })) });
    writeJSON('marks.json', marks);
    console.log(`화면을 녹화했어요. ${frames.length}프레임, ${end.toFixed(1)}초예요.`);
  } finally {
    try { if (capture) await capture.stop(); }
    finally {
      try { if (browser) await browser.close(); }
      finally { if (preview) await preview.stop(); }
    }
  }
}

function concatFile(file, entries) {
  const chunks = entries.filter((e) => e.duration > 0);
  if (!chunks.length) throw new Error('이어 붙일 화면이 없어요. record 단계를 다시 실행해 주세요.');
  const fileLine = (path) => {
    if (/[\r\n]/.test(path)) throw new Error('출력 경로에 줄바꿈을 넣을 수 없어요.');
    return `file '${resolve(path).replaceAll("'", "'\\''")}'\noption framerate 1000\n`;
  };
  writeFileSync(file, chunks.map((e) => `${fileLine(e.file)}duration ${e.duration.toFixed(6)}\n`).join('')
    + fileLine(chunks.at(-1).file));
}

function screenEntries({ end, frames }) {
  const ordered = frames.filter((f) => Number.isFinite(f.t) && f.t < end).sort((a, b) => a.t - b.t);
  if (!ordered.length) throw new Error('녹화 시간 안에 프레임이 없어요. record 단계를 다시 실행해 주세요.');
  const before = ordered.filter((f) => f.t <= 0).at(-1);
  const first = before ?? ordered[0];
  const timeline = [{ ...first, t: 0 }, ...ordered.filter((f) => f.t > Math.max(0, first.t))];
  return timeline.map((f, i) => ({ file: f.file, duration: (timeline[i + 1]?.t ?? end) - f.t }));
}

function audio(end, marks, voices) {
  const pcm = Buffer.alloc(Math.ceil(end * SAMPLE_RATE) * 2);
  for (const m of marks) {
    const v = voices.find((v) => v.si === m.si && v.li === m.li);
    if (!v) throw new Error(`음성 조각이 없어요: ${m.si + 1}장 ${m.li + 1}문장이에요.`);
    const samples = execFileSync('ffmpeg', ['-v', 'error', '-i', v.file, '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-'],
      { maxBuffer: 64 * 1024 * 1024 });
    const offset = Math.round(m.voiceAt * SAMPLE_RATE) * 2;
    if (offset < pcm.length) samples.copy(pcm, offset, 0, Math.min(samples.length, pcm.length - offset));
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(join(WORK, 'audio.wav'), Buffer.concat([header, pcm]));
}

async function render() {
  const recording = readJSON('frames.json');
  const { end } = recording;
  const marks = readJSON('marks.json');
  const voices = readJSON('voice.json');
  if (!Number.isFinite(end) || end <= 0 || !marks.length) throw new Error('녹화 시간표가 비어 있어요. record 단계를 다시 실행해 주세요.');
  const dir = join(WORK, 'ov');
  mkdirSync(dir, { recursive: true });
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(new URL('./frame.html', import.meta.url).href);
    for (const [i, m] of marks.entries()) {
      const scene = SCENES[m.si];
      await page.evaluate((spec) => window.draw(spec), {
        index: m.si + 1, total: SCENES.length, title: scene.title, note: scene.note,
        chapters: SCENES.map((s) => s.title), sub: m.t,
      });
      const height = await page.locator('#sub').evaluate((el) => el.getBoundingClientRect().height);
      if (height > 110) console.warn(`자막 상자가 ${height.toFixed(0)}px예요. 두 줄 안에 들어가는지 확인해 주세요: ${m.t}`);
      await page.screenshot({ path: join(dir, `${pad(i)}.png`), omitBackground: true });
    }
  } finally { await browser.close(); }

  concatFile(join(WORK, 'frames.txt'), screenEntries(recording));
  concatFile(join(WORK, 'ov.txt'), marks.map((m, i) => ({
    file: join(dir, `${pad(i)}.png`), duration: (marks[i + 1]?.start ?? end) - (i === 0 ? 0 : m.start),
  })));
  execFileSync('ffmpeg', [
    '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(WORK, 'frames.txt'),
    '-f', 'concat', '-safe', '0', '-i', join(WORK, 'ov.txt'), '-filter_complex',
    '[0:v]fps=30,scale=416:900:flags=lanczos,setsar=1,pad=1920:1080:752:30:black[s];[1:v]fps=30,format=rgba[o];[s][o]overlay=0:0:format=auto,format=yuv420p[v]',
    '-map', '[v]', '-t', String(end), '-r', String(FPS), '-c:v', 'libx264',
    '-preset', 'medium', '-crf', '18', '-g', '60', join(WORK, 'video.mp4'),
  ], { stdio: 'inherit' });
  audio(end, marks, voices);
  writeJSON('timeline.json', { fps: FPS, end, lines: marks });
  console.log(`화면과 음성을 합성했어요. 공통 길이는 ${end.toFixed(3)}초예요.`);
}

function srtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(Math.floor(ms / 3600000))}:${two(Math.floor(ms / 60000) % 60)}:${two(Math.floor(ms / 1000) % 60)},${pad(ms % 1000)}`;
}

function finish() {
  const { lines: marks } = readJSON('timeline.json');
  const srt = marks.map((m, i) => `${i + 1}\n${srtTime(m.voiceAt)} --> ${srtTime(m.voiceAt + m.dur)}\n${m.t}\n`).join('\n');
  writeFileSync(join(OUT, 'subtitles.srt'), srt);
  writeFileSync(join(OUT, 'title.txt'), '가즈아 둘러보기 — 관심종목 비교와 매매 규칙 시뮬레이션 (데모)\n');
  writeFileSync(join(OUT, 'desc.txt'), [
    '관심종목을 비교하고 매매 규칙과 선정 기준을 과거 데이터로 시험하는 가즈아를 둘러봐요.',
    '앱 주소: https://gazua.sch0718.dev/',
    '화면의 시세와 계좌는 모두 데모용 가상 데이터예요.',
    '투자 조언이 아니에요. 투자 판단과 책임은 본인에게 있어요.',
    '내레이션: Microsoft Edge TTS (ko-KR-SunHiNeural)',
    '소스: https://github.com/sch0718/gazua', '',
  ].join('\n'));
  const final = join(OUT, 'final.mp4');
  execFileSync('sh', [join(SK, 'finish.sh'), final, join(WORK, 'audio.wav'), join(WORK, 'video.mp4')], { stdio: 'inherit' });
  const probe = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate,duration',
    '-show_entries', 'format=duration', '-of', 'json', final,
  ], { encoding: 'utf8' }));
  const video = probe.streams?.find((s) => s.codec_type === 'video');
  const sound = probe.streams?.find((s) => s.codec_type === 'audio');
  const duration = Number(probe.format?.duration);
  const difference = Math.abs(Number(video?.duration) - Number(sound?.duration));
  const checks = [
    [video?.width === 1920 && video?.height === 1080, `화면 크기는 ${video?.width}×${video?.height}예요.`],
    [video?.r_frame_rate === '30/1', `프레임 속도는 ${video?.r_frame_rate}fps예요.`],
    [video?.codec_name === 'h264' && sound?.codec_name === 'aac', `코덱은 ${video?.codec_name} + ${sound?.codec_name}예요.`],
    [duration >= 180 && duration <= 300, `영상 길이는 ${duration.toFixed(3)}초예요. 목표는 180~300초예요.`],
    [difference <= 0.2, `영상과 음성의 길이 차이는 ${difference.toFixed(3)}초예요. 허용 차이는 0.2초예요.`],
  ];
  for (const [ok, message] of checks) {
    console.log(`${ok ? '통과' : '다름'}: ${message}`);
    if (!ok) process.exitCode = 1;
  }
  console.log(`최종 영상을 저장했어요: ${final}`);
}

async function main(args = process.argv.slice(2)) {
  const stages = { script, voice, record, render, finish };
  const selected = args.length ? args : Object.keys(stages);
  const unknown = selected.filter((name) => !Object.hasOwn(stages, name));
  if (unknown.length) throw new Error(`모르는 단계예요: ${unknown.join(', ')}. script, voice, record, render, finish 중에서 골라 주세요.`);
  // 대본만 만들 때는 외부 도구나 저장소 밖 출력 폴더가 필요 없어요.
  if (selected.some((name) => name !== 'script')) {
    if (!check()) return;
    mkdirSync(WORK, { recursive: true });
  }
  for (const name of selected) {
    console.log(`${name} 단계를 시작해요.`);
    await stages[name]();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`데모 영상을 만들지 못했어요: ${e.message}`); process.exitCode = 1; });
}
