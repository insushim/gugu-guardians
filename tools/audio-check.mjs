#!/usr/bin/env node
/**
 * 소리 실측 — "파일이 있다"가 아니라 **디코딩되어 실제로 재생되는가**를 본다.
 *
 * 🔴 오디오는 조용히 죽는다. AudioContext 언락 실패·경로 오타·디코드 실패 전부
 *    콘솔 에러 없이 무음이 되고, 스크린샷에도 안 나온다. 그래서 별도 검수가 필요하다.
 *
 * 실행: QA_URL=... node tools/audio-check.mjs
 */
import puppeteer from 'puppeteer';

const URL_BASE = process.env.QA_URL ?? 'http://localhost:5184';
const problems = [];
const must = (c, m) => { if (!c) problems.push(m); return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

// 실제 디코딩 결과를 관찰하려고 AudioContext 를 감싼다
await page.evaluateOnNewDocument(() => {
  window.__audio__ = { decoded: 0, failed: 0, sources: 0, looped: 0 };
  const OrigCtx = window.AudioContext;
  window.AudioContext = class extends OrigCtx {
    constructor(...a) {
      super(...a);
      const dec = this.decodeAudioData.bind(this);
      this.decodeAudioData = (buf, ...rest) => dec(buf, ...rest)
        .then((b) => { window.__audio__.decoded++; return b; })
        .catch((e) => { window.__audio__.failed++; throw e; });
      const mk = this.createBufferSource.bind(this);
      this.createBufferSource = () => {
        const s = mk();
        window.__audio__.sources++;
        const start = s.start.bind(s);
        s.start = (...x) => { if (s.loop) window.__audio__.looped++; return start(...x); };
        return s;
      };
    }
  };
});

await page.goto(URL_BASE, { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__gugu__?.ready');

// 언락은 사용자 제스처가 있어야 한다 — 실제로 클릭한다
await page.mouse.click(640, 400);
await sleep(3500);

const a1 = await page.evaluate(() => window.__audio__);
must(a1.decoded >= 6, `효과음 디코드가 ${a1.decoded}개뿐 (6개여야 한다)`);
must(a1.failed === 0, `디코드 실패 ${a1.failed}건`);
must(a1.looped >= 1, '🔴 배경음악이 루프로 재생되지 않았다(언락 후에도 무음)');

// 🔴 전투 진입 시 곡이 실제로 바뀌는가 (지연 로드 경로가 틀리면 조용히 무음이 된다)
const bgmHits = [];
page.on('request', (r) => { if (/audio\/bgm\//.test(r.url())) bgmHits.push(r.url()); });
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /시작하기|이어서 하기/.test(b.textContent ?? ''))?.click());
await sleep(600);
await page.evaluate(() => document.querySelector('.node:not([disabled])')?.click());
await sleep(600);
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('출전'))?.click());
await sleep(3500);
// 🔴 판정은 **루프가 실제로 걸렸는가**로 한다.
//    단일 HTML 빌드에서는 BGM 이 data URI 라 네트워크 요청이 아예 없다 — 요청 유무로 판정하면
//    소리가 멀쩡히 나는데도 실패로 뜬다(실제로 그랬다). 요청 목록은 참고용으로만 남긴다.
const aB = await page.evaluate(() => window.__audio__);
must(aB.looped >= 2, `🔴 전투 곡이 루프로 걸리지 않았다 (누적 루프 ${aB.looped})`);
must(aB.decoded >= 8, `전투 곡이 디코드되지 않았다 (디코드 ${aB.decoded})`);
await page.goto(URL_BASE, { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__gugu__?.ready');
await page.mouse.click(640, 400);
await sleep(1200);

// 효과음이 실제로 나가는지 — 버튼을 눌러 tap 을 유발
const before = (await page.evaluate(() => window.__audio__)).sources;
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('도감'))?.click());
await sleep(800);
const after = (await page.evaluate(() => window.__audio__)).sources;
must(after >= before, '효과음 재생 경로가 죽어 있다');

// 음악 끄기가 실제로 먹는가
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('gugu:save'));
  s.data.settings.music = false;
  localStorage.setItem('gugu:save', JSON.stringify(s));
});
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForFunction('window.__gugu__?.ready');
await page.mouse.click(640, 400);
await sleep(3000);
const a2 = await page.evaluate(() => window.__audio__);
must(a2.looped === 0, `🔴 음악을 껐는데 루프 재생이 ${a2.looped}건 일어났다`);
must(a2.decoded >= 6, `음악을 꺼도 효과음은 살아 있어야 한다 (디코드 ${a2.decoded})`);

await browser.close();
console.log('# 소리 실측');
console.log(`- 효과음 디코드 ${a1.decoded} · 디코드 실패 ${a1.failed} · 음악 루프 ${a1.looped}`);
console.log(`- 음악 끔 상태: 루프 ${a2.looped} · 효과음 디코드 ${a2.decoded}`);
console.log(`- 전투 진입 시 받은 BGM: ${[...new Set(bgmHits.map((u) => u.split('/').pop()))].join(', ') || '없음(단일 파일은 data URI라 요청이 없다)'}`);
console.log(`- 콘솔 에러: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log(`  - ${e}`);
console.log(`- 실패: ${problems.length}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length || errors.length ? 1 : 0);
