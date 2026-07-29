#!/usr/bin/env node
/**
 * 주간 순위 E2E — 실제 브라우저에서 **네트워크를 관찰하며** 확인한다.
 *
 * 단위 테스트로는 "동의하기 전에는 요청이 정말 안 나가는가"를 검증할 수 없다.
 * 그게 이 기능에서 가장 중요한 약속이라 여기서 실측한다.
 *
 * 실행: node tools/e2e-board.mjs        (기본 http://localhost:5184 = Pages 빌드)
 *       QA_URL=... node tools/e2e-board.mjs
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const URL_BASE = process.env.QA_URL ?? 'http://localhost:5184';
const OUT = new URL('../screenshots', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const problems = [];
const errors = [];
const must = (c, m) => { if (!c) problems.push(m); return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--disable-gpu', '--disable-gpu-compositing', '--disable-accelerated-2d-canvas', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

/** 순위 서버로 나간 요청만 기록한다 */
const sent = [];
// 🔴 CORS 프리플라이트(OPTIONS)도 같은 URL로 잡힌다 — method 를 같이 기록해 본문 검사에서 걸러낸다
page.on('request', (r) => { if (/workers\.dev/.test(r.url())) sent.push({ url: r.url(), method: r.method(), body: r.postData() ?? null }); });

const clickText = async (t) => {
  const h = await page.evaluateHandle((x) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(x)) ?? null, t);
  const e = h.asElement();
  if (!e) return false;
  const b = await e.boundingBox();
  if (!b) return false;
  await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.5);
  return true;
};

await page.goto(URL_BASE, { waitUntil: 'networkidle2' });
await page.waitForFunction('window.__gugu__?.ready');

// 🔴 순위표에 줄이 있는지 보려면 남의 데이터에 기대면 안 된다(다른 테스트가 지우면 실패한다).
//    우리가 만든 줄 하나를 심어 두고, 끝나면 지운다.
const SEED = crypto.randomUUID();
const BASE = process.env.BOARD_URL
  ?? 'https://gugu-board.simssijjang-d79.workers.dev';
await fetch(`${BASE}/submit`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ d: SEED, na: 2, nb: 3, c: 27, s: 3, p: 70_000 }),
}).catch(() => {});

// ── 1. 메뉴에 순위 버튼이 있는가 (서버 주소가 있는 빌드에서만)
const hasBtn = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('주간 순위')));
must(hasBtn, '메뉴에 "주간 순위" 버튼이 없다');

// ── 2. 🔴 동의 전에는 **제출 요청이 나가지 않아야** 한다 (보기만 하는 건 허용)
must(await clickText('주간 순위'), '순위 버튼 클릭 실패');
await sleep(2500);
const beforeSubmit = sent.filter((s) => s.url.includes('/submit') && s.method === 'POST');
must(beforeSubmit.length === 0, `🔴 동의 전에 제출 요청이 ${beforeSubmit.length}건 나갔다`);
must(sent.some((s) => s.url.includes('/board')), '순위표 읽기 요청이 없다');

const consentText = await page.evaluate(() => document.querySelector('.pane')?.textContent ?? '');
must(consentText.includes('이름'), '동의 문구에 무엇을 안 보내는지가 없다');
await page.screenshot({ path: join(OUT, 'board-before.png') });

// ── 3. 저장소에 기기 토큰이 아직 없어야 한다
const devBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('gugu:save') ?? '{}')?.data?.board?.device ?? '');
must(devBefore === '', `🔴 동의 전인데 기기 토큰이 이미 있다: ${devBefore}`);

// ── 4. 동의하면 그때 제출된다
must(await clickText('순위에 올릴래요'), '동의 버튼 클릭 실패');
await sleep(3000);
const posts = sent.filter((s) => s.url.includes('/submit') && s.method === 'POST');
must(posts.length >= 1, '동의했는데 제출 요청이 없다');

// ── 5. 🔴 보낸 본문에 문자열이 기기 토큰 하나뿐인가 (실명 유입 경로 차단의 실측)
if (posts.length) {
  let body = null;
  try { body = JSON.parse(posts[posts.length - 1].body ?? 'null'); } catch { /* 아래에서 걸린다 */ }
  must(body !== null, '제출 본문을 파싱하지 못했다');
  if (body) {
    const strings = Object.entries(body).filter(([, v]) => typeof v === 'string');
    must(strings.length === 1 && strings[0][0] === 'd', `🔴 본문에 문자열 필드가 여럿이다: ${JSON.stringify(strings)}`);
    must(Number.isInteger(body.na) && Number.isInteger(body.nb), '별명이 인덱스가 아니다');
    const keys = Object.keys(body).sort().join(',');
    must(keys === 'c,d,na,nb,p,s', `본문 필드가 예상과 다르다: ${keys}`);
  }
}

const devAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('gugu:save') ?? '{}')?.data?.board?.device ?? '');
must(/^[0-9a-f-]{36}$/.test(devAfter), '동의 후 기기 토큰이 만들어지지 않았다');

// ── 6. 순위표가 실제로 그려지는가
const rows = await page.evaluate(() => document.querySelectorAll('.rank-row').length);
must(rows >= 1, '순위표에 줄이 하나도 없다');
await page.screenshot({ path: join(OUT, 'board-after.png') });


// ── 7. 취소하면 토큰이 지워지고, 서버 기록 삭제까지 요청하는가
must(await clickText('그만 올리기'), '취소 버튼 클릭 실패');
await sleep(2000);
const devRevoked = await page.evaluate(() => JSON.parse(localStorage.getItem('gugu:save') ?? '{}')?.data?.board?.device ?? '');
must(devRevoked === '', `🔴 취소했는데 기기 토큰이 남아 있다: ${devRevoked}`);
const forgets = sent.filter((s) => s.url.includes('/forget') && s.method === 'POST');
must(forgets.length === 1, `🔴 "그만 올리기"가 서버 삭제를 요청하지 않았다(${forgets.length}건)`);
if (forgets.length) {
  let fb = null;
  try { fb = JSON.parse(forgets[0].body ?? 'null'); } catch { /* 아래에서 걸린다 */ }
  must(fb?.d === devAfter, '삭제 요청이 방금 쓰던 기기 토큰을 가리키지 않는다');
}

// (실제로 행이 지워지는지는 데이터를 우리가 제어할 수 있는 tools/api-check.mjs 에서 확인한다 —
//  이 브라우저 세션의 기기는 전투를 안 해서 정답 0이라 애초에 순위표에 뜨지 않는다)

await browser.close();
await fetch(`${BASE}/forget`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ d: SEED }),
}).catch(() => {});

console.log('# 주간 순위 E2E');
console.log(`- 순위 서버 요청: ${sent.length}건 (읽기 ${sent.filter((s) => s.url.includes('/board')).length} · 제출 ${posts.length} · 프리플라이트 ${sent.filter((s) => s.method === 'OPTIONS').length})`);
console.log(`- 콘솔 에러: ${errors.length}`);
for (const e of errors.slice(0, 5)) console.log(`  - ${e}`);
console.log(`- 실패: ${problems.length}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length || errors.length ? 1 : 0);
