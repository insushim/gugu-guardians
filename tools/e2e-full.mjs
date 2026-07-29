#!/usr/bin/env node
/**
 * 전체 흐름 E2E — 한 판을 **실제로 이겨서** 관문·결과·저장까지 확인한다.
 * 단위 테스트로는 "이겼을 때 별이 저장되는가"를 검증할 수 없다.
 *
 * 실행: node tools/e2e-full.mjs   (npm run preview 가 떠 있어야 함)
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

await page.goto(URL_BASE, { waitUntil: 'networkidle2' });
must((await page.title()).includes('구구성'), '대상 불일치');
await page.waitForFunction('window.__gugu__?.ready');

const clickText = async (t) => {
  const h = await page.evaluateHandle((x) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(x)) ?? null, t);
  const e = h.asElement();
  if (!e) return false;
  const b = await e.boundingBox();
  if (!b) return false;
  await page.mouse.click(b.x + b.width * 0.7, b.y + b.height * 0.7);
  return true;
};

/** 화면의 식을 읽어 정답을 눌러 준다 */
async function answerOnce(sel = '.quiz .q') {
  const q = await page.evaluate((s) => document.querySelector(s)?.textContent ?? '', sel);
  const m = /(\d+)\s*([+−×÷])\s*(\d+)/.exec(q);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[3]);
  const ask = await page.evaluate(() => document.querySelector('.quiz .ask, .gate-q + .muted')?.textContent ?? '');
  let ans = m[2] === '+' ? a + b : m[2] === '−' ? a - b : m[2] === '×' ? a * b : Math.floor(a / b);
  if (m[2] === '÷' && ask.includes('나머지')) ans = a % b;
  for (const ch of String(ans)) await page.keyboard.press(`Digit${ch}`);
  return true;
}

await clickText('시작하기') || await clickText('이어서 하기');
await sleep(300);
const node = await page.$('.node:not([disabled])');
const nb = await node.boundingBox();
await page.mouse.click(nb.x + nb.width * 0.7, nb.y + nb.height * 0.7);
await sleep(300);
must(await clickText('출전'), '출전 실패');
await sleep(1200);

// 한 판을 이길 때까지 답하고 소환한다 (상한 3분)
const started = Date.now();
let status = 'playing';
while (Date.now() - started < 180000) {
  const st = await page.evaluate(() => window.__gugu__?.status ?? 'gone');
  if (st !== 'playing') { status = st; break; }
  await answerOnce();
  const cards = await page.$$('.dcard');
  for (const c of cards) {
    const b = await c.boundingBox();
    if (b) await page.mouse.click(b.x + b.width * 0.7, b.y + b.height * 0.7);
  }
  await sleep(220);
  if (await page.evaluate(() => !document.querySelector('.quiz'))) { status = 'left'; break; }
}
await page.screenshot({ path: join(OUT, 'e2e-1-endbattle.png') });
must(status === 'win' || status === 'left', `전투가 승리로 끝나지 않음 (status=${status})`);

// 관문 5문항
await sleep(900);
const onGate = await page.evaluate(() => !!document.querySelector('.gate-q'));
must(onGate, '봉인 해제(관문) 화면이 뜨지 않음');
if (onGate) {
  for (let i = 0; i < 6; i++) {
    const done = await page.evaluate(() => !document.querySelector('.gate-q'));
    if (done) break;
    const q = await page.evaluate(() => document.querySelector('.gate-q')?.textContent ?? '');
    const m = /(\d+)\s*([+−×÷])\s*(\d+)/.exec(q);
    if (m) {
      const a = Number(m[1]), b = Number(m[3]);
      const ask = await page.evaluate(() => document.querySelectorAll('.gate-wrap .muted')[1]?.textContent ?? '');
      let ans = m[2] === '+' ? a + b : m[2] === '−' ? a - b : m[2] === '×' ? a * b : Math.floor(a / b);
      if (m[2] === '÷' && ask.includes('나머지')) ans = a % b;
      await clickText(String(ans));
    }
    await sleep(1300);
  }
  await page.screenshot({ path: join(OUT, 'e2e-2-gate.png') });
}

// 결과 화면 + 저장 확인
await sleep(1200);
const result = await page.evaluate(() => ({
  hasStars: !!document.querySelector('.stars-big'),
  stats: [...document.querySelectorAll('.stat .v')].map((e) => e.textContent),
  save: JSON.parse(localStorage.getItem('gugu:save') ?? '{}'),
}));
await page.screenshot({ path: join(OUT, 'e2e-3-result.png') });
must(result.hasStars, '결과 화면에 별 표시가 없음');
must((result.stats?.length ?? 0) >= 4, `결과 지표가 ${result.stats?.length ?? 0}개`);
const cleared = result.save?.data?.progress?.cleared ?? {};
must(Object.keys(cleared).length > 0, '클리어 기록이 저장되지 않음');
must((result.save?.data?.currency?.meokmul ?? 0) > 0, '먹물이 지급되지 않음');
const srsN = Object.keys(result.save?.data?.edu?.srs ?? {}).length;
must(srsN > 0, 'SRS(엉킴 봉인) 기록이 저장되지 않음');
const statN = Object.keys(result.save?.data?.edu?.stats ?? {}).length;
must(statN > 0, '학습 통계가 저장되지 않음');
must((result.save?.data?.edu?.playMs ?? 0) > 0, '플레이 시간이 기록되지 않음 (문항 밀도 계산 불가)');

// ── 소환: 재화를 쓰고 보유가 늘고 저장되는가 ──────────────────────────────
// 🔴 여기서 저장이 안 되면 아이 입장에서는 "뽑은 셈지기가 사라진" 것이 된다.
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('gugu:save'));
  raw.data.currency.meokmul = 5000;
  localStorage.setItem('gugu:save', JSON.stringify(raw));
});
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForFunction('window.__gugu__?.ready');
must(await clickText('셈지기 소환'), '소환 화면으로 못 감');
await sleep(400);
const before = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('gugu:save')).data;
  return { ink: d.currency.meokmul, owned: Object.keys(d.roster).length };
});
must(await clickText('열 번 소환'), '10연 버튼 없음');
await sleep(3200);
await page.screenshot({ path: join(OUT, 'e2e-4-summon.png') });
const after = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('gugu:save')).data;
  return {
    ink: d.currency.meokmul,
    owned: Object.keys(d.roster).length,
    cards: document.querySelectorAll('.summon-stage .ucard').length,
    total: d.summon.total,
    shards: Object.values(d.roster).reduce((s, e) => s + e.shards, 0),
  };
});
must(after.cards === 10, `소환 결과 카드가 ${after.cards}장 (10장이어야 함)`);
must(after.total === 10, `소환 횟수 기록 ${after.total}`);
must(after.ink < before.ink, '먹물이 차감되지 않음');
must(after.owned > before.owned || after.shards > 0, '보유도 조각도 늘지 않음');
const summonSaved = after;

// 새로고침 후에도 남아 있는가 (DoD 18)
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForFunction('window.__gugu__?.ready');
const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('gugu:save') ?? '{}'));
must(Object.keys(persisted?.data?.progress?.cleared ?? {}).length > 0, '새로고침 후 진행도가 사라짐');
must(Object.keys(persisted?.data?.roster ?? {}).length === summonSaved.owned, '새로고침 후 소환한 셈지기가 사라짐');
must((persisted?.data?.summon?.total ?? 0) === 10, '새로고침 후 소환 기록이 사라짐');

await browser.close();

console.log([
  `# 전체 흐름 E2E`,
  `- 전투 결과: ${status}`,
  `- 클리어 기록: ${JSON.stringify(cleared)}`,
  `- 먹물: ${result.save?.data?.currency?.meokmul}`,
  `- SRS 항목: ${srsN} · 통계 유형: ${statN}`,
  `- 소환: 10연 후 보유 ${summonSaved.owned}종 · 조각 ${summonSaved.shards} · 먹물 ${summonSaved.ink}`,
  `- 콘솔 에러: ${errors.length}`,
  ...errors.map((e) => `  - ${e}`),
  `- 실패: ${problems.length}`,
  ...problems.map((p) => `  - ${p}`),
].join('\n'));
process.exit(problems.length + errors.length ? 1 : 0);
