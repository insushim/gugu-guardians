#!/usr/bin/env node
/**
 * 신규 기능이 **실제 화면까지 닿는지** 확인한다 — 짧은 단일 세션.
 *
 * 🔴 왜 qa-launch 와 따로 두는가:
 *    ① 이 프로젝트의 대표적 사고가 "시뮬 테스트는 전부 초록인데 화면에서는 아무 일도 안 나는 것"이다
 *       (2026-08-02 성 타격 경로의 기술 이벤트 — 큐에 담기만 하고 렌더러로 넘기는 한 줄이 빠져 있었다).
 *       그래서 새 연출은 반드시 실브라우저에서 **숫자로** 확인한다.
 *    ② 2026-08-12 환경에서 `qa-launch` 는 판을 여러 번 돌리고 **페이지를 반복 이동**하는데,
 *       그 패턴에서 크롬이 스스로 죽는다(`detached Frame`). **게임 코드 문제가 아니다** —
 *       변경분을 통째로 stash 하고 커밋 상태에서 돌려도, 전체화면 기능을 꺼도 같았다.
 *       이 도구는 **한 번 열고 한 판만** 본다. 그 범위에서는 안정적으로 돈다.
 *
 * 실행: node tools/feature-check.mjs   (개발 서버가 5183 에 떠 있어야 한다)
 */
import puppeteer from 'puppeteer';

const APP = process.env['GUGU_APP'] ?? 'http://localhost:5183/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const ok = (cond, msg, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${msg}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails.push(msg + (detail ? ` — ${detail}` : ''));
};

const browser = await puppeteer.launch({
  headless: 'shell',
  args: ['--disable-gpu', '--disable-gpu-compositing', '--disable-accelerated-2d-canvas', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

console.log(`\n=== 신규 기능 실화면 검사 (${APP}) ===\n`);

const click = (t) => page.evaluate((x) => {
  const e = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(x));
  if (!e) return false;
  e.scrollIntoView({ block: 'center' });
  e.click();
  return true;
}, t);

try {
  await page.goto(APP, { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction('window.__gugu__?.ready');

  await click('시작하기');
  await sleep(500);
  await page.evaluate(() => {
    const n = [...document.querySelectorAll('.node:not([disabled])')].pop();
    if (n) { n.scrollIntoView({ block: 'center' }); n.click(); }
  });
  await sleep(500);
  await click('출전');
  await page.waitForSelector('.pad', { timeout: 8000 });

  // ── 문제를 실제로 푼다(숫자패드를 눌러서) ─────────────────────────────
  // 🔴 시뮬을 직접 호출하지 않는다. 아이가 하는 것과 같은 경로로 눌러야
  //    "정답 → 화면 반응"의 배선이 검사된다.
  const answer = async () => page.evaluate(() => {
    const q = document.querySelector('.quiz .q')?.textContent ?? '';
    // 🔴 화면의 빼기 기호는 ASCII 하이픈이 아니라 **U+2212(−)** 다. 이걸 빼먹으면
    //    뺄셈 문제에서 영영 매칭이 안 되고, 검사는 "1문제만 풀렸다"로 조용히 실패한다(실측).
    const m = q.match(/(\d+)\s*([+\-\u2212\u00d7\u00f7×÷])\s*(\d+)/);
    if (!m) return false;
    const [, a, op, b] = m;
    const x = Number(a), y = Number(b);
    const v = op === '+' ? x + y
      : (op === '-' || op === '\u2212') ? x - y
      : (op === '×' || op === '\u00d7') ? x * y
      : Math.round(x / y);
    for (const ch of String(v)) {
      const k = [...document.querySelectorAll('.pad button')].find((btn) => btn.textContent?.trim() === ch);
      if (!k) return false;
      k.click();
    }
    return true;
  });

  let answered = 0;
  /**
   * 🔴 **짧게 끝낸다.** 이 환경의 크롬은 세션이 길어지면 스스로 죽는다(`detached Frame`).
   *    판을 끝까지 몰고 가면 그 전에 탭이 죽어 아무것도 못 본다 —
   *    여기서 봐야 하는 건 "새 연출이 화면까지 닿는가"뿐이고, 그건 몇 문제면 확인된다.
   *    판 전체 흐름은 밸런스 프로브(게이트 11종)와 유닛테스트가 본다.
   */
  for (let i = 0; i < 10 && answered < 5; i++) {
    if (await answer()) answered++;
    await sleep(500);
  }
  ok(answered >= 3, '숫자패드로 문제를 실제로 풀었다', `${answered}문제`);

  const fx = await page.evaluate(() => window.__gugu__?.fx ?? null);
  ok(!!fx, 'QA 훅이 연출 수치를 노출한다');
  /**
   * 🔴 이번 개편의 최상위 항목(진단 영향 7/10). 예전엔 정답을 맞혀도 **캔버스가 무반응**이었고,
   *    틀리면 문제 상자가 흔들렸다 — 잘한 것보다 못한 것에 화면이 더 크게 반응했다.
   */
  ok((fx?.cheers ?? 0) > 0, '정답 순간 전장이 반응한다 (환호 연출)', `환호 ${fx?.cheers ?? 0}회`);

  const money = await page.evaluate(() => window.__gugu__?.money ?? 0);
  ok(money > 0, '정답이 셈력으로 이어진다', `셈력 ${Math.round(money)}`);

  ok(errors.length === 0, '콘솔 에러 0건', errors.slice(0, 2).join(' / '));
} catch (e) {
  fails.push(`실행 중단: ${String(e).split('\n')[0]}`);
  console.log(`❌ 실행 중단 — ${String(e).split('\n')[0]}`);
}

await browser.close();
if (!fails.length) console.log('\n✅ 전 항목 통과\n');
else { console.log(`\n❌ ${fails.length}건 실패:`); fails.forEach((f) => console.log('  - ' + f)); console.log(''); }
process.exit(fails.length ? 1 : 0);
