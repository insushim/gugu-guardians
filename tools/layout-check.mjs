#!/usr/bin/env node
/**
 * 전투 화면 레이아웃 게이트 — 실제 브라우저에서 잰다.
 *
 * 🔴 이 검사가 있는 이유: 레이아웃은 **한 칸을 넓히면 다른 칸이 좁아진다.** 실사용자가
 *    두 번 보고했고 두 번 다 다른 칸을 고치다 생긴 것이다.
 *      ① 숫자패드가 화면의 45% 를 먹어 셈지기 카드가 잘렸다("드래그하게 하네")
 *      ② 그걸 고치려 문제 칸을 좁혔더니 답 쓰는 밑줄이 칸 밖으로 나갔다
 *      ③ 출전 슬롯을 6장으로 늘리자 다시 카드가 잘렸다
 *    셋 다 코드를 읽어서는 안 보이고, **재야** 보인다.
 *
 * 검사 항목 (전부 관찰 가능한 것만):
 *   - 덱 카드가 한 장도 잘리지 않는가
 *   - 가장 긴 문항의 답 칸이 문제 상자 안에 들어오는가
 *   - 숫자패드 버튼이 저학년 터치 하한(44px)을 지키는가
 *   - 전장(캔버스)이 남아 있는가
 *   - 가로 스크롤이 생기지 않는가
 *
 * 실행: npm run check:layout   (미리보기 서버가 5184 에 떠 있어야 한다)
 */
import puppeteer from 'puppeteer';

const APP = process.env['GUGU_APP'] ?? 'http://localhost:5184/';
const TOUCH_MIN = 44;      // 저학년 터치 타겟 하한(px)
const FIELD_MIN = 120;     // 전장이 이보다 얇으면 게임이 아니라 띠다

/** 실제로 나오는 것 중 가장 긴 식들 — 두 자리 ± 두 자리가 최악이다(22판부터) */
const WORST = ['5 × 3 = ', '12 × 8 = ', '48 ÷ 6 = ', '37 + 25 = ', '84 ÷ 7 = '];

/** [폭, 높이, 이름] — 교실에서 실제로 쓰는 기기 위주 */
const VIEWS = [
  [1280, 720, '데스크톱·전자칠판'],
  [1194, 834, '아이패드 가로'],
  [1024, 600, '크롬북'],
  [960, 462, '작은 창'],
  [900, 420, '낮은 창'],
  [844, 390, 'iPhone 14 가로'],
  [800, 360, '안드로이드 가로'],
  [740, 360, '좁은 가로'],
  [667, 375, 'iPhone SE 2·3세대 가로'],
];

const OWNED = ['jipsin', 'kkachi', 'musoe', 'onggi', 'buttong', 'yeonip', 'bungbung'];

async function enterBattle(page) {
  await page.goto(APP, { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear());
  await page.evaluate((ids) => {
    localStorage.setItem('gugu:save', JSON.stringify({
      version: 4,
      data: {
        progress: { maxStage: 8, cleared: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [String(i + 1), 3])) },
        roster: Object.fromEntries(ids.map((id) => [id, { level: 3, shards: 0 }])),
        deck: ids,
        codex: { unlocked: ids },
      },
    }));
  }, OWNED);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction('window.__gugu__?.ready');

  const click = (t) => page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(t));
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.click();
    return true;
  }, t);

  (await click('이어서 하기')) || (await click('시작하기'));
  await new Promise((r) => setTimeout(r, 500));
  for (let i = 0; i < 8; i++) {
    if (await page.evaluate(() => document.querySelectorAll('.node:not([disabled])').length > 0)) break;
    await click('앞 구역');
    await new Promise((r) => setTimeout(r, 350));
  }
  await page.evaluate(() => {
    const ns = [...document.querySelectorAll('.node:not([disabled])')];
    const t = ns[ns.length - 1];
    if (t) { t.scrollIntoView({ block: 'center' }); t.click(); }
  });
  await new Promise((r) => setTimeout(r, 500));
  await click('출전!');
  await page.waitForSelector('.pad', { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 900));
}

function measure(worst) {
  const q = (s) => document.querySelector(s);
  const box = q('.quiz');
  const line = q('.quiz .q');
  const deck = q('.deck-row');
  const pad = q('.pad');
  const btn = q('.pad button');

  // 🔴 답 칸 넘침은 `scrollWidth` 로는 안 잡힌다(overflow:visible 에서 넘침을 반영하지 않는다).
  //    Range 로 **글자가 실제로 차지한 폭**을 재서 상자 안쪽 폭과 비교한다.
  const orig = line.innerHTML;
  let over = -Infinity;
  let worstQ = '';
  for (const t of worst) {
    line.textContent = t;
    const sp = document.createElement('span');
    sp.className = 'slot';
    sp.textContent = '__';
    line.append(sp);
    const rg = document.createRange();
    rg.selectNodeContents(line);
    const need = rg.getBoundingClientRect().width;
    const room = box.clientWidth - 20;   // 좌우 안쪽 여백
    if (need - room > over) { over = need - room; worstQ = t; }
  }
  line.innerHTML = orig;

  const br = btn?.getBoundingClientRect();
  return {
    cards: document.querySelectorAll('.dcard').length,
    deckHidden: deck ? Math.max(0, deck.scrollWidth - deck.clientWidth) : 0,
    quizOver: Math.ceil(over),
    worstQ,
    padBtnW: br ? Math.round(br.width) : 0,
    padBtnH: br ? Math.round(br.height) : 0,
    fieldH: Math.round(q('canvas#field')?.getBoundingClientRect().height ?? 0),
    pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
    padW: Math.round(pad?.getBoundingClientRect().width ?? 0),
    quizW: Math.round(box?.getBoundingClientRect().width ?? 0),
  };
}

const browser = await puppeteer.launch({ headless: 'new' });
const fails = [];
console.log(`\n=== 전투 화면 레이아웃 게이트 (${APP}) ===\n`);

for (const [w, h, name] of VIEWS) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  let m;
  try {
    await enterBattle(page);
    m = await page.evaluate(measure, WORST);
  } catch (e) {
    fails.push(`${name} ${w}×${h}: 전투 진입 실패 — ${String(e).split('\n')[0]}`);
    await page.close();
    continue;
  }
  const bad = [];
  if (m.deckHidden > 0) bad.push(`셈지기 ${m.deckHidden}px 잘림`);
  if (m.quizOver > 0) bad.push(`답 칸이 "${m.worstQ}__" 에서 ${m.quizOver}px 넘침`);
  if (m.padBtnW < TOUCH_MIN) bad.push(`숫자 버튼 폭 ${m.padBtnW}px (<${TOUCH_MIN})`);
  if (m.fieldH < FIELD_MIN) bad.push(`전장 높이 ${m.fieldH}px (<${FIELD_MIN})`);
  if (m.pageOverflow) bad.push('가로 스크롤 발생');

  console.log(
    `${bad.length ? '❌' : '✅'} ${name} ${w}×${h}\n` +
    `     덱 ${m.cards}장 · 문제칸 ${m.quizW}px(여유 ${-m.quizOver}px) · 패드 ${m.padW}px(버튼 ${m.padBtnW}×${m.padBtnH}) · 전장 ${m.fieldH}px`,
  );
  for (const b of bad) { console.log(`     └ ${b}`); fails.push(`${name} ${w}×${h}: ${b}`); }
  await page.close();
}

await browser.close();
if (fails.length === 0) console.log('\n✅ 전 화면 통과\n');
else { console.log(`\n❌ ${fails.length}건 실패:`); fails.forEach((f) => console.log('  - ' + f)); console.log(''); }
process.exit(fails.length ? 1 : 0);
