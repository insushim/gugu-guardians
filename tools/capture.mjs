#!/usr/bin/env node
/**
 * 시각 QA 캡처 — Puppeteer.
 *
 * 🔴 하네스 함정 대비(과거 실측):
 *   - headless:'shell' 사용. 'new'는 rAF가 간헐 미발화해 Boot에서 영구 정지한다(콘솔 0건이라 오진).
 *   - CPU 래스터 플래그. GPU 경로에서는 캔버스 readback이 깨져 빈 이미지가 나온다.
 *   - 시작 시 <title> 대조. 포트를 다른 앱이 선점하면 엉뚱한 앱을 검수하고 "통과"가 난다.
 *   - 셀렉터가 없으면 FAIL로 센다(null이면 조용히 통과하는 사고 방지).
 *   - 버튼 클릭은 우하단 사분면(정중앙은 히트영역 버그가 있어도 통과한다).
 *   - 모바일 뷰포트에 **주소창 높이를 뺀** 케이스를 반드시 넣는다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const URL_BASE = process.env.QA_URL ?? 'http://localhost:5184';
const OUT = new URL('../screenshots', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 720 },
  { name: 'tablet', width: 1024, height: 640 },
  { name: 'phone', width: 900, height: 310 }, // 🔴 주소창(≈80px) 제외한 실사용 높이
];

const problems = [];
const consoleErrors = [];

function must(cond, msg) {
  if (!cond) problems.push(msg);
  return cond;
}

const browser = await puppeteer.launch({
  headless: 'shell',
  args: [
    '--disable-gpu', '--disable-gpu-compositing',
    '--disable-accelerated-2d-canvas', '--disable-software-rasterizer',
    '--no-sandbox',
  ],
});

async function shot(page, name) {
  const path = join(OUT, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(page) {
  await page.waitForFunction('window.__gugu__ && window.__gugu__.ready === true', { timeout: 20000 });
}

/** 요소 우하단 사분면 클릭 — 정중앙 클릭은 히트영역 버그를 통과시킨다 */
async function clickQuadrant(page, selectorText) {
  const handle = await page.evaluateHandle((text) => {
    const btns = [...document.querySelectorAll('button')];
    return btns.find((b) => b.textContent?.includes(text)) ?? null;
  }, selectorText);
  const elh = handle.asElement();
  if (!elh) { problems.push(`버튼을 찾지 못함: "${selectorText}"`); return false; }
  const box = await elh.boundingBox();
  if (!box) { problems.push(`버튼 boundingBox 없음: "${selectorText}"`); return false; }
  await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.72);
  return true;
}

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${vp.name}] ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`[${vp.name}] pageerror: ${e.message}`));

  await page.goto(URL_BASE, { waitUntil: 'networkidle2', timeout: 30000 });

  // 🔴 대상 동일성 검증 — 다른 앱을 검수하고 통과시키는 사고 방지
  const title = await page.title();
  must(title.includes('구구성'), `[${vp.name}] 대상 불일치: title="${title}"`);

  await waitReady(page);
  await shot(page, `${vp.name}-1-menu`);

  must(await clickQuadrant(page, '시작하기') || await clickQuadrant(page, '이어서 하기'), `[${vp.name}] 시작 버튼 클릭 실패`);
  await sleep(400);
  await shot(page, `${vp.name}-2-map`);

  const firstNode = await page.$('.node:not([disabled])');
  must(!!firstNode, `[${vp.name}] 지도에 열린 스테이지가 없다`);
  if (firstNode) {
    const b = await firstNode.boundingBox();
    if (b) await page.mouse.click(b.x + b.width * 0.72, b.y + b.height * 0.72);
  }
  await sleep(400);
  await shot(page, `${vp.name}-3-prep`);

  must(await clickQuadrant(page, '출전'), `[${vp.name}] 출전 버튼 클릭 실패`);
  await sleep(1500);
  await shot(page, `${vp.name}-4-battle`);

  // 전투 화면 필수 요소 — 없으면 FAIL(조용한 통과 금지)
  const checks = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const inView = (e) => {
      if (!e) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= -1 && r.bottom <= window.innerHeight + 1;
    };
    const pad = [...document.querySelectorAll('.pad button')];
    return {
      hasCanvas: !!q('canvas#field'),
      canvasH: q('canvas#field')?.getBoundingClientRect().height ?? 0,
      deckCards: document.querySelectorAll('.dcard').length,
      padKeys: pad.length,
      padInView: pad.every(inView),
      quizInView: inView(q('.quiz')),
      quizText: q('.quiz .q')?.textContent ?? '',
      minTouch: Math.min(...pad.map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))),
      bodyScrollX: document.body.scrollWidth > window.innerWidth,
    };
  });
  must(checks.hasCanvas, `[${vp.name}] 전장 캔버스 없음`);
  must(checks.canvasH > 80, `[${vp.name}] 전장 높이가 ${Math.round(checks.canvasH)}px로 너무 낮다`);
  must(checks.deckCards >= 1, `[${vp.name}] 덱 카드 0개`);
  must(checks.padKeys >= 10, `[${vp.name}] 숫자패드 키 ${checks.padKeys}개`);
  must(checks.padInView, `[${vp.name}] 숫자패드가 화면 밖으로 잘림`);
  must(checks.quizInView, `[${vp.name}] 문제 영역이 화면 밖으로 잘림`);
  must(/[0-9]/.test(checks.quizText), `[${vp.name}] 문제가 표시되지 않음: "${checks.quizText}"`);
  must(!checks.bodyScrollX, `[${vp.name}] 가로 스크롤 발생`);
  if (vp.name !== 'phone') must(checks.minTouch >= 44, `[${vp.name}] 터치 타깃 ${Math.round(checks.minTouch)}px < 44px`);

  // 숫자패드로 실제 입력이 되는지.
  // ⚠️ 한 자리 답 문제는 키 하나로 즉시 제출되어 식 표시가 원래대로 돌아온다 →
  //    "식이 바뀌었는가"로 판정하면 정상 동작을 실패로 오판한다. 피드백 영역 변화로 본다.
  const fbBefore = await page.$eval('.quiz .fb', (e) => e.textContent ?? '');
  const key = await page.$('.pad button');
  must(!!key, `[${vp.name}] 숫자패드 버튼을 찾지 못함`);
  if (key) { const b = await key.boundingBox(); if (b) await page.mouse.click(b.x + b.width * 0.72, b.y + b.height * 0.72); }
  await sleep(250);
  const state = await page.evaluate(() => ({
    fb: document.querySelector('.quiz .fb')?.textContent ?? '',
    slot: document.querySelector('.quiz .q .slot')?.textContent ?? '',
  }));
  must(state.fb !== fbBefore || /\d/.test(state.slot), `[${vp.name}] 숫자패드를 눌러도 아무 반응이 없음`);
  await shot(page, `${vp.name}-5-typed`);

  // 🔴 정적 화면만 보면 전투 렌더를 검증하지 못한다 — 자동 응답으로 실제로 굴려 본다.
  //    (풀이는 키보드로: 화면의 식을 읽어 정답을 눌러 준다)
  for (let i = 0; i < 40; i++) {
    const q = await page.evaluate(() => document.querySelector('.quiz .q')?.textContent ?? '');
    const m = /(\d+)\s*([+\u2212\u00d7\u00f7])\s*(\d+)/.exec(q);
    if (m) {
      const a2 = Number(m[1]), b2 = Number(m[3]);
      const ans = m[2] === '+' ? a2 + b2 : m[2] === '\u2212' ? a2 - b2 : m[2] === '\u00d7' ? a2 * b2 : Math.floor(a2 / b2);
      for (const ch of String(ans)) await page.keyboard.press(`Digit${ch}`);
    }
    // 셈력이 모이면 덱 카드를 눌러 아군을 실제로 내보낸다(아군 렌더 검증)
    if (i % 3 === 0) {
      const card = await page.$('.dcard');
      if (card) { const cb = await card.boundingBox(); if (cb) await page.mouse.click(cb.x + cb.width * 0.7, cb.y + cb.height * 0.7); }
    }
    await sleep(320);
  }
  await sleep(600);
  const mid = await page.evaluate(() => ({
    units: (window.__gugu__?.units ?? -1),
    money: document.querySelector('.bhud .mana')?.textContent ?? '',
    combo: document.querySelector('.bhud .combo')?.textContent ?? '',
    screen: window.__gugu__?.screen ?? '',
  }));
  await shot(page, `${vp.name}-6-fighting`);
  must(Number(mid.money) > 0, `[${vp.name}] 자동 플레이 후 셈력이 0`);
  must(mid.units > 0, `[${vp.name}] 자동 플레이 후 전장에 유닛이 하나도 없다`);

  await page.close();
}

await browser.close();

const report = [
  `# 시각 QA 리포트 (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`,
  '',
  `## 콘솔 에러: ${consoleErrors.length}건`,
  ...consoleErrors.map((e) => `- ${e}`),
  '',
  `## 검사 실패: ${problems.length}건`,
  ...problems.map((p) => `- ${p}`),
  '',
  `스크린샷: screenshots/`,
  '',
].join('\n');
writeFileSync(join(OUT, 'report.md'), report);
console.log(report);
process.exit(problems.length + consoleErrors.length > 0 ? 1 : 0);
