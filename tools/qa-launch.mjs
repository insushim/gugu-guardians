#!/usr/bin/env node
/**
 * 상용 배포 전 검수 — 실제 브라우저에서 **실제 UI 코드 경로**로 돌린다.
 * (밸런스 프로브는 순수 로직만 본다. 여기서만 잡히는 것: 화면 전환·저장·중복 호출·입력 경로)
 *
 * 실행: node tools/qa-launch.mjs        (npm run dev 또는 preview 가 떠 있어야 함)
 *
 * 🔴 **드라이버를 페이지 안에 심는다.** Node ↔ 브라우저 왕복(evaluate/keyboard)마다
 *    rAF 가 멈춰 시뮬이 실제의 0.4배로 흐른다 — 한 판을 끝까지 돌리지 못한다(실측).
 *    페이지 안에서 진짜 버튼을 클릭하게 하면 코드 경로는 같고 시계만 정상으로 흐른다.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const URL_BASE = process.env.QA_URL ?? 'http://localhost:5183';
/** 문항당 응답 시간(ms). 기본 3200 = 2학년이 천천히 푸는 속도.
 *  프로브 모델은 정답률 85%에서 tOk = 2.3 + 0.15*2.4 = **2660ms** 를 가정한다. */
const MS_PER_Q = Number(process.env.QA_MS_PER_Q ?? 3200);
const STAGES = Number(process.env.QA_STAGES ?? 8);
const SKIP_A = process.env.QA_SKIP_A === '1';
const OUT = new URL('../screenshots', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const notes = [];
const say = (s) => { notes.push(s); console.log(s); };
const must = (c, m) => { if (!c) { problems.push(m); console.log(`  ✗ ${m}`); } return c; };

const browser = await puppeteer.launch({
  /**
   * 🔴 **`'shell'` 를 유지한다. `'new'` 로 바꾸지 말 것 — 실측으로 한 번 시도했다 실패했다.**
   *    2026-08-12 에 이 모드에서 렌더러가 몇 판에 한 번 스스로 죽어(`detached Frame`)
   *    검수가 중단되기에 `'new'` 로 바꿔 봤더니, 이번엔 **첫 판 이후 모든 판이 0문항**이 됐다
   *    (탭은 살아 있고 콘솔 에러 0 · `.pad` 도 뜨는데 `window.__gugu__.status` 가 안 채워진다
   *    = requestAnimationFrame 루프가 안 돈다. 새 헤드리스의 비가시 탭 RAF 스로틀링으로 보인다).
   *    이 게임은 전투 전체가 RAF 루프 위에 있어서 그 모드로는 아무것도 검수할 수 없다.
   *    그래서 `'shell'` 로 두고, 렌더러가 죽는 쪽은 **탭 재생성**(아래 renewIfDead)으로 견딘다.
   *
   *    ⚠️ 두 증상 모두 **게임 코드 문제가 아니다.** 변경분을 통째로 stash 하고 커밋 상태에서
   *    돌려도 같았고, 전체화면 기능을 꺼도 같았다(원인 귀속 완료).
   */
  headless: 'shell',
  args: ['--disable-gpu', '--disable-gpu-compositing', '--disable-accelerated-2d-canvas', '--no-sandbox'],
});
const errors = [];

/**
 * 🔴 **탭이 죽어도 검수는 계속돼야 한다.**
 *    2026-08-12 환경에서 렌더러가 몇 판에 한 번씩 스스로 죽고, 그때 `page` 객체가
 *    `Attempted to use detached Frame` 을 던지며 **검수 전체가 중단**됐다.
 *    이건 게임 코드 문제가 아니다 — 변경분을 통째로 stash 하고 커밋 상태에서 돌려도,
 *    전체화면 기능을 꺼도 같은 자리에서 죽었다(원인 귀속 완료).
 *    한 판을 잃는 것과 남은 검사를 전부 못 도는 것은 값이 다르다. 탭만 새로 연다.
 */
let page;
let renewals = 0;

async function newTab() {
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  pg.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // 렌더러가 죽으면 **기록**한다. 없으면 다음 사람이 다시 처음부터 귀속해야 한다.
  pg.on('error', (e) => errors.push(`렌더러 종료: ${e.message}`));
  return pg;
}
page = await newTab();

/** 탭이 죽었나 — 죽었으면 새로 열고 true 를 돌려준다 */
async function renewIfDead(e) {
  // 🔴 문구 변형이 여럿이다 — `detached Frame` · `Navigating frame was detached` ·
  //    `LifecycleWatcher terminated` 등. 좁게 잡았다가 한 번 놓쳤다(실측).
  if (!/detach|Target closed|Session closed|Protocol error|LifecycleWatcher/i.test(String(e))) return false;
  renewals++;
  try { await page.close(); } catch { /* 이미 죽었다 */ }
  page = await newTab();
  return true;
}

/** 탭이 죽으면 한 번 새로 열고 다시 시도한다 */
async function retryOnDeadTab(fn, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      // 🔴 새로 연 탭이 곧바로 또 죽는 경우가 있다(브라우저 자체가 불안정한 환경).
      //    한 번만 재시도하면 그 경우에 검수가 통째로 날아간다 — 몇 번은 더 버틴다.
      if (i >= tries || !(await renewIfDead(e))) throw e;
      await sleep(800);
    }
  }
}

async function clickText(t) {
  const h = await page.evaluateHandle(
    (x) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(x)) ?? null, t);
  const e = h.asElement();
  if (!e) return false;
  const b = await e.boundingBox();
  if (!b) return false;
  await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.5);
  return true;
}

/**
 * 페이지 안에 자동 플레이어를 심는다. 진짜 숫자패드 버튼을 클릭한다.
 *
 * ⚠️ **이 드라이버로 "난이도가 적절한가"를 판정하면 안 된다.** 여기 아이는 문항이 아무리
 *    어려워져도 정답률이 그대로다(accuracy 고정). 그러면 θ 가 천장 없이 올라가고 레벨도 따라
 *    올라간다(실측: 8판에서 평균 레벨 2.19) — 진짜 아이라면 어려워질수록 더 틀린다.
 *    난이도·학습 판정은 **실제 능력을 고정한** `tests/learning.spec.ts` 쪽이 맞는 모델이다.
 *    여기서 재는 것은 화면 전환·저장·중복 호출·입력 경로·한 판 문항 수다.
 */
const DRIVER = `(opts) => {
  const { accuracy, msPerQ } = opts;
  window.__log = { asked: [], answers: 0, right: 0, wrong: 0, summons: 0, hpUsMin: 1, err: null };
  const key = (t) => [...document.querySelectorAll('.pad .btn')].find((b) => b.textContent.trim() === t);
  let lastLogged = null, nextAt = 0;
  // 🔴 "같은 key 는 한 번만" 으로 짜면 **틀린 문제를 다시 안 푼다** — 오답이 나오는 순간
  //    드라이버가 그 문항에서 멈춘다(실측: 정답률 85%로 돌리자 한 판에 1문항). 빈 칸을 신호로 쓴다.
  const slotEmpty = () => {
    const s = document.querySelector('.quiz .slot')?.textContent ?? '';
    return s.length > 0 && /^_+$/.test(s);
  };
  const solve = () => {
    const ask = (document.querySelector('.quiz .ask')?.textContent || '').trim();
    const raw = (document.querySelector('.quiz .q')?.textContent || '').trim();
    const m = /^\\s*(\\d+)\\s*([+\\u2212\\u00d7\\u00f7])\\s*(\\d+)\\s*=/.exec(raw);
    if (!m) return null;
    const a = +m[1], op = m[2], b = +m[3];
    let v = op === '+' ? a + b : op === '\\u2212' ? a - b : op === '\\u00d7' ? a * b
          : (ask.includes('\\ub098\\uba38\\uc9c0') ? a % b : Math.floor(a / b));
    return { v, op };
  };
  window.__tick = setInterval(() => {
    try {
      const g = window.__gugu__;
      if (!g || g.status !== 'playing') return;
      window.__log.hpUsMin = Math.min(window.__log.hpUsMin, g.hpUs ?? 1);
      // 살 수 있는 가장 비싼 셈지기를 낸다.
      // 🔴 **예비금 규칙**(프로브와 동일): 비싼 걸 사도 최저가 2기분은 남긴다. 이게 없으면
      //    돈을 바닥까지 긁어 써서 전선이 비고, 판이 두세 배로 길어진다 — 게임 문제가 아니라
      //    하네스가 못 놀아서 생기는 착시다(실측: 3판이 73초 모델 대비 195초로 나왔다).
      const all = [...document.querySelectorAll('.dcard')]
        .map((c) => ({ el: c, cost: +(c.querySelector('.cost')?.textContent || 1e9) }));
      const cheapest = Math.min(...all.map((c) => c.cost));
      const cs = all
        .filter((c) => c.cost <= g.money && (c.cost === cheapest || g.money - c.cost >= cheapest * 2))
        .sort((x, y) => y.cost - x.cost);
      if (cs[0]) { cs[0].el.click(); window.__log.summons++; }

      const now = performance.now();
      if (now < nextAt) return;
      const q = g.q;
      if (!q || !slotEmpty()) return;
      const s = solve();
      if (!s) return;
      if (q.key !== lastLogged) {
        lastLogged = q.key;
        window.__log.asked.push({ key: q.key, type: q.type, level: q.level, dda: q.dda, t: Math.round(g.t) });
      }
      const ok = Math.random() < accuracy;
      const want = ok ? s.v : (s.v === 0 ? 1 : Number(String(s.v + 1).slice(0, String(s.v).length)));
      for (const ch of String(want)) { const k = key(ch); if (k) k.click(); }
      window.__log.answers++; ok ? window.__log.right++ : window.__log.wrong++;
      nextAt = now + msPerQ;
    } catch (e) { window.__log.err = String(e); }
  }, 80);
  return 'driving';
}`;

async function reset() {
  await retryOnDeadTab(async () => {
    await page.goto(URL_BASE, { waitUntil: 'networkidle2' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction('window.__gugu__?.ready');
  });
}

/** 지도에서 열려 있는 마지막 판으로 들어가 한 판을 끝까지 플레이한다 */
// 🔴 판 상한(MAX_SEC=420초)보다 짧게 잡으면 **아직 진행 중인 판을 잘라 놓고 '못 이겼다'로 읽게 된다**
//    (실측: 3판이 241초에 잘려 status=playing 으로 남았다). 게임의 상한보다 넉넉히 둔다.
async function playOne({ accuracy, msPerQ, pauses = 0, budgetMs = 460000 }) {
  // 🔴 매 판 새로고침해서 들어간다 — 결과 화면의 버튼 이름을 따라다니는 것보다 튼튼하고,
  //    덤으로 **저장이 실제로 복원되는지**를 판마다 검증하게 된다.
  await retryOnDeadTab(async () => {
    await page.goto(URL_BASE, { waitUntil: 'networkidle2' });
    await page.waitForFunction('window.__gugu__?.ready');
  });
  await clickText('이어서 하기') || await clickText('시작하기');
  await sleep(500);
  const nodes = await page.$$('.node:not([disabled])');
  const target = nodes[nodes.length - 1];
  if (!target) return { stuck: `지도에 들어갈 수 있는 판이 없다 (화면=${await page.evaluate(() => document.querySelector('.screen')?.className ?? '?')})` };
  const nb = await target.boundingBox();
  await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await sleep(500);
  const hitStart = await clickText('출전!');
  try {
    await page.waitForSelector('.pad', { timeout: 8000 });
  } catch {
    // 🔴 여기서 그냥 throw 하면 남은 판을 못 돌려 검수가 통째로 날아간다. 상태를 남기고 넘긴다.
    const dbg = await page.evaluate(() => ({
      screen: document.querySelector('.screen')?.className ?? '없음',
      head: document.querySelector('h1,h2')?.textContent ?? '',
      buttons: [...document.querySelectorAll('button')].slice(0, 8).map((b) => b.textContent?.trim().slice(0, 14)),
      nodes: document.querySelectorAll('.node').length,
      open: document.querySelectorAll('.node:not([disabled])').length,
    }));
    await page.screenshot({ path: `${OUT}/qa-stuck.png` });
    return { stuck: `출전 클릭=${hitStart} · 화면=${dbg.screen} · 제목=${dbg.head} · 판노드 ${dbg.open}/${dbg.nodes} · 버튼[${dbg.buttons.join('|')}]` };
  }

  for (let i = 0; i < pauses; i++) {
    await clickText('잠깐'); await sleep(150);
    await clickText('계속'); await sleep(150);
  }

  await page.evaluate(new Function('return ' + DRIVER)(), { accuracy, msPerQ });
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < budgetMs) {
    await sleep(1000);
    // 🔴 폴링 중 페이지가 갈리면(직접 새로고침, 검수 중 재빌드로 인한 HMR/캐시 교체 등)
    //    evaluate 가 'detached Frame' 으로 던지고 **검수 전체가 죽는다**(실측).
    //    한 판을 포기하는 것과 남은 판을 전부 못 도는 것은 값이 다르다.
    try {
      last = await page.evaluate(() => ({ g: window.__gugu__, log: window.__log }));
      if (!last.g || last.g.status !== 'playing') break;
      if (await page.evaluate(() => !document.querySelector('.pad'))) break;
    } catch (e) {
      return { stuck: `폴링 중 페이지가 끊겼다: ${String(e).split('\n')[0]}` };
    }
  }
  try { await page.evaluate(() => { clearInterval(window.__tick); }); } catch { /* 이미 끊긴 페이지 */ }
  await sleep(1500);
  return last;
}

// ═══ A. 일시정지 → 종료 처리 중복 ══════════════════════════════════════
say('\n## A. 일시정지 후 종료 처리');
async function pauseRun(pauses) {
  await reset();
  const r = await playOne({ accuracy: 1.0, msPerQ: 700, pauses });
  await sleep(1200);
  const save = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('gugu:save') ?? '{}');
    const d = raw.data ?? raw;
    return { rounds: d?.edu?.rounds ?? -1, playMs: Math.round(d?.edu?.playMs ?? 0), weekly: d?.weekly ?? null };
  });
  return { status: r?.g?.status, answers: r?.log?.answers, save };
}
/**
 * 🔴 한 절이 죽어도 나머지는 돌아야 한다. 2026-08-12 환경에서 브라우저가 스스로 죽는데,
 *    그때 A절에서 던지면 B·B2 를 통째로 못 돌아 **아무것도 검수 못 한 채** 끝난다.
 */
const softFail = (label) => (e) => {
  problems.push(`${label} 실행 중단(브라우저 불안정): ${String(e).split('\n')[0]}`);
  say(`  ✗ ${label} 실행 중단 — ${String(e).split('\n')[0]}`);
  return null;
};

const p0 = SKIP_A ? { save: { rounds: 1 } } : await pauseRun(0).catch(softFail('A절 일시정지 0회')) ?? { save: {} };
say(`  일시정지 0회 → status=${p0.status} 저장된 판수=${p0.save.rounds} 푼문항=${p0.answers}`);
const p5 = SKIP_A ? { save: { rounds: 1 } } : await pauseRun(5).catch(softFail('A절 일시정지 5회')) ?? { save: {} };
say(`  일시정지 5회 → status=${p5.status} 저장된 판수=${p5.save.rounds} 푼문항=${p5.answers}`);
must(p0.save.rounds === 1, `일시정지 0회인데 판수가 ${p0.save.rounds} (1이어야 함)`);
must(p5.save.rounds === 1, `일시정지 5회 후 판수가 ${p5.save.rounds}로 부풀었다 (1이어야 함)`);
if (p0.save.weekly && p5.save.weekly) {
  say(`  주간 버킷 0회: ${JSON.stringify(p0.save.weekly).slice(0, 160)}`);
  say(`  주간 버킷 5회: ${JSON.stringify(p5.save.weekly).slice(0, 160)}`);
}

// ═══ B. 실제 아이 페이스로 연속 플레이 → 학습량·다양성·난이도 ═════════
say(`\n## B. 연속 플레이 (정답률 85%, 문항당 ${(MS_PER_Q / 1000).toFixed(2)}초)`);
await reset();
const all = [];
for (let n = 1; n <= STAGES; n++) {
  const r = await playOne({ accuracy: 0.85, msPerQ: MS_PER_Q });
  if (r?.stuck) { say(`  ${n}판 진입 실패 — ${r.stuck}`); problems.push(`${n}판 진입 실패: ${r.stuck}`); break; }
  const log = r?.log ?? { asked: [] };
  const st = r?.g?.status ?? '?';
  const types = [...new Set(log.asked.map((a) => a.type))];
  const lv = log.asked.map((a) => a.level);
  const uniq = new Set(log.asked.map((a) => a.key)).size;
  all.push({ n, st, asked: log.asked, uniq });
  say(`  ${n}판 ${st.padEnd(5)} 문항 ${String(log.asked.length).padStart(3)}개 (서로 다른 식 ${uniq}) `
    + `유형[${types.join(',')}] 레벨 평균 ${(lv.reduce((s, x) => s + x, 0) / (lv.length || 1)).toFixed(2)} `
    + `t=${Math.round(r?.g?.t ?? 0)}초 최저성체력=${Math.round((log.hpUsMin ?? 1) * 100)}%`);
  if (st === 'win') {
    // 관문 5문항 통과 → 다음 판 열기
    for (let i = 0; i < 16; i++) {
      const done = await page.evaluate(() => !document.querySelector('.gate-q'));
      if (done) break;
      const q = await page.evaluate(() => ({
        q: document.querySelector('.gate-q')?.textContent ?? '',
        ask: [...document.querySelectorAll('.gate-wrap .muted')].map((x) => x.textContent).join(' '),
      }));
      const m = /(\d+)\s*([+−×÷])\s*(\d+)/.exec(q.q);
      if (m) {
        const a = +m[1], b = +m[3];
        let ans = m[2] === '+' ? a + b : m[2] === '−' ? a - b : m[2] === '×' ? a * b : Math.floor(a / b);
        if (m[2] === '÷' && q.ask.includes('나머지')) ans = a % b;
        const h = await page.evaluateHandle(
          (t) => [...document.querySelectorAll('.choices button')].find((x) => x.textContent?.trim() === t) ?? null,
          String(ans));
        const el = h.asElement();
        if (el) { const bb = await el.boundingBox(); if (bb) await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); }
      }
      await sleep(700);
    }
  }
  await sleep(600);
}

const flat = all.flatMap((r) => r.asked);
const byType = {};
for (const a of flat) byType[a.type] = (byType[a.type] ?? 0) + 1;
const lvByStage = all.map((r) => (r.asked.reduce((s, a) => s + a.level, 0) / (r.asked.length || 1)));
say(`\n  총 문항 ${flat.length}개 · 서로 다른 식 ${new Set(flat.map((a) => a.key)).size}개`);
say(`  유형 분포: ${Object.entries(byType).map(([k, v]) => `${k}:${v}`).join(' ')}`);
say(`  판별 평균 레벨: ${lvByStage.map((x) => x.toFixed(2)).join(' → ')}`);
const ddaSeen = [...new Set(flat.map((a) => a.dda))];
say(`  관측된 DDA 단계: ${ddaSeen.join(',')}`);

const winCount = all.filter((r) => r.st === 'win').length;
say(`  승리 ${winCount}/${all.length}판`);
must(flat.length / all.length >= 20, `한 판 평균 문항이 ${(flat.length / all.length).toFixed(1)}개로 학습량 하한(20) 미달`);

// ═══ B2. 신규 전투 킷이 **실제 브라우저에서** 나는가 ══════════════════════
// 🔴 시뮬 테스트는 이벤트가 큐에 담기는 것까지만 본다. 큐에서 렌더러로 넘기는 한 줄이
//    빠지면 게임 안에서는 아무 일도 안 일어나는데 테스트는 전부 초록이다 —
//    이번에 성 타격 경로가 정확히 그 상태였다(교차검증 적발). 여기서 화면 쪽을 확인한다.
say('\n## B2. 전설 특별기술·자리 상한 (실브라우저)');
{
  // 🔴 전설 id 를 손으로 적지 않는다 — 로스터가 바뀌면 조용히 없는 유닛을 쥐어 주게 된다
  const roster = JSON.parse(readFileSync(new URL('../data/roster.json', import.meta.url).pathname, 'utf8'));
  const LEGEND = roster.allies.find((u) => u.rarity === 'legend').id;
  await page.goto(URL_BASE, { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.clear());
  // 전설 + 값싼 물량을 쥐어 주고 뒤쪽 판으로 들어간다(전설이 실제로 나갈 셈력이 있어야 한다)
  await page.evaluate((legend) => {
    const ids = ['jipsin', 'kkachi', 'musoe', 'onggi', 'bungbung', legend];
    localStorage.setItem('gugu:save', JSON.stringify({
      version: 5,
      data: {
        progress: { maxStage: 12, cleared: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), 3])) },
        roster: Object.fromEntries(ids.map((id) => [id, { level: 5, shards: 0 }])),
        deck: ids, codex: { unlocked: ids },
        upgrades: { mana: 6, regen: 5, cannon: 5 },
      },
    }));
  }, LEGEND);
  const r = await playOne({ accuracy: 1.0, msPerQ: 600 });
  const g = r?.g ?? {};
  say(`  결과=${g.status} · 기술연출 ${g.fx?.skills ?? '?'}회 · 원거리 ${g.fx?.shots ?? '?'}발 · 최대자리 ${g.maxSlots ?? '?'}`);
  must((g.fx?.skills ?? 0) > 0, `전설이 덱에 있는데 특별기술 연출이 ${g.fx?.skills ?? 0}회 — 이벤트가 렌더러까지 안 갔다`);
}

if (renewals > 0) say(`\n## C0. 탭 재생성 ${renewals}회 — 브라우저가 스스로 죽어 새로 열었다(게임 코드 아님)`);
if (renewals > 0) say(`\n## C0. 탭 재생성 ${renewals}회 — 브라우저가 스스로 죽어 새로 열었다(게임 코드 아님)`);
say(`\n## C. 콘솔 에러: ${errors.length}건`);
for (const e of errors.slice(0, 12)) say(`  ! ${e}`);
must(errors.length === 0, `콘솔 에러 ${errors.length}건`);

say(`\n=== 실패 ${problems.length}건 ===`);
for (const p of problems) say(`  ✗ ${p}`);
await browser.close();
process.exit(problems.length ? 1 : 0);
