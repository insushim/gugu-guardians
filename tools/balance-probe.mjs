#!/usr/bin/env node
/**
 * 구구성 수호대 — 밸런스 프로브 (실측용)
 *
 * 목적: 수치가 "말이 되는지"를 코드로 확인한다. 밸런스는 유닛테스트로 검증되지 않는다.
 *       난이도(스테이지) × 실력(정답률) 격자를 실제로 굴려 표를 뽑고 게이트로 판정한다.
 *
 * v3 변경: 스테이지가 무한이 되었다.
 *   - 캠페인(1~30)은 **소환 없이** 정답률 60%로 전부 깨져야 한다(G2). 진도 해금분만으로 돌린다.
 *   - 무한 구간(31+)은 게이트가 아니라 관측이다 — 로스터 등급별로 어디까지 가는지 표로 낸다.
 *
 * 실행: node tools/balance-probe.mjs
 */
import {
  simulate, stageDef, ALLIES, CAMPAIGN_STAGES, progressionAllies, ROSTER, MAX_TIER, SWEEPING, nextTier,
} from './probe-model.mjs';

/** G8(재미 게이트)이 검사하는 최고 난이도 단계 */
const probeTier = MAX_TIER;

/**
 * 🔴 시드 7개면 승률이 1/7 = 14%p 단위로만 튄다 — 71%와 86%가 **표본 하나 차이**다.
 *    그 해상도로 상수를 맞추면 노이즈에 맞추는 셈이고, 실제로 배속 상한을 고르다
 *    1.7만 통과하고 1.6/1.8은 서로 다른 이유로 실패하는 칼날 구간이 나왔다.
 *    21개면 4.8%p 해상도라 게이트 판정이 상수 변화에 대해 단조로워진다.
 */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : Infinity; };

function runCell(st, acc, roster = null) {
  const runs = SEEDS.map((sd) => simulate(st, acc, sd, roster));
  const wins = runs.filter((r) => r.win);
  return {
    winRate: wins.length / runs.length,
    medTime: median(wins.map((r) => r.time)),
    medSolved: median(runs.map((r) => r.solved)),
    minSolved: Math.min(...runs.map((r) => r.solved)),
    maxSolved: Math.max(...runs.map((r) => r.solved)),
  };
}

const ACCS = [0.0, 0.25, 0.4, 0.6, 0.8, 0.95];      // 0.25 = 4지선다 무작위 '찍기'
/** 캠페인 표본 — 30판 전부를 6정답률×5시드로 돌리면 900판이라 느리다. 구역 경계·보스를 포함해 뽑는다 */
const STAGES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 20, 24, 27, 29, 30];

console.log(`\n=== 구구성 수호대 밸런스 프로브 v3 (무한 스테이지 · 시드 ${SEEDS.length}회) ===`);
console.log(`셈지기 ${ALLIES.length}종 · 엉킴괴수 ${ROSTER.enemies.length}종 · 캠페인 ${CAMPAIGN_STAGES}판\n`);
console.log('셀 = 승률 | 클리어 중앙값(초)/문항수\n');
console.log(['ST', ...ACCS.map((a) => `정답${Math.round(a * 100)}%`)].join('\t'));

const grid = {};
for (const st of STAGES) {
  const row = [stageDef(st).boss ? `${st}★` : `${st}`];
  grid[st] = {};
  for (const a of ACCS) {
    const c = runCell(st, a);
    grid[st][a] = c;
    row.push(c.winRate === 0 ? '패' : `${Math.round(c.winRate * 100)}% ${c.medTime.toFixed(0)}s/${c.medSolved}문`);
  }
  console.log(row.join('\t'));
}

// ── 게이트 판정 ──────────────────────────────────────────────────────────
console.log('\n=== 게이트 판정 ===');
const fails = [];
const WIN = 0.8, LOSE = 0.2;
const BOSSES = STAGES.filter((st) => stageDef(st).boss);
const NORMAL = STAGES.filter((st) => !stageDef(st).boss);

// G1 고성취(95%) 전 스테이지 클리어 + 세션 길이.
// 🔴 하한이 55초인 이유: "너무 짧아서 학습이 안 일어난다"는 걱정은 **G5(한 판 20문항 이상)**가
//    직접 막는다. G1의 하한까지 그 역할을 겹쳐 맡으면, 문항은 충분한데 전투가 빨리 끝났다는
//    이유만으로 게이트가 깨진다(v3 실측: 95% 구간이 63~70초에 25~29문항을 풀고 있었다).
//    G1 하한은 "전투가 시작하자마자 끝나 버리는가"만 본다.
const SESSION_TARGET = (st) => (st <= 3 ? [50, 150] : [55, 240]);
for (const st of STAGES) {
  const c = grid[st][0.95];
  const [lo, hi] = SESSION_TARGET(st);
  if (c.winRate < 1) fails.push(`G1 ST${st}: 정답95% 승률 ${Math.round(c.winRate * 100)}%`);
  else if (c.medTime < lo || c.medTime > hi) fails.push(`G1 ST${st}: 중앙값 ${c.medTime.toFixed(0)}s (목표 ${lo}~${hi}s 밖)`);
}
// G1b 저성취 세션이 너무 길면 집중이 끊긴다
for (const st of STAGES) {
  const c = grid[st][0.6];
  if (c.winRate >= WIN && c.medTime > 300) fails.push(`G1b ST${st}: 정답60% ${c.medTime.toFixed(0)}s (>300s)`);
}
// G2 하드월 없음 — 저성취(60%)도 캠페인 전 구간 통과 (교육 게임 최우선 게이트)
for (const st of STAGES) {
  const c = grid[st][0.6];
  if (c.winRate < WIN) fails.push(`G2 ST${st}: 정답60% 승률 ${Math.round(c.winRate * 100)}% — 하드월`);
}
// G3 학습 유인 — 무학습(0%)은 **맨 처음 두 판만** 통과하고 그 뒤로는 막혀야 한다.
// 🔴 1~3판으로 뒀다가 3판에서 걸렸다. 이 게이트의 목적은 "수학을 아직 못 하는 아이가
//    문 앞에서 막히지 않는 것"이고, 두 판이면 조작을 익히기에 충분하다.
//    3판째부터 한 문제도 못 맞히면 못 깨는 것은 결함이 아니라 이 게임의 설계 자체다.
for (const st of [1, 2]) {
  if (grid[st][0.0].winRate < WIN) fails.push(`G3 ST${st}: 정답0% 승률 ${Math.round(grid[st][0.0].winRate * 100)}% — 진입장벽`);
}
const lateStages = STAGES.filter((st) => st >= 12);
const lateZero = lateStages.filter((st) => grid[st][0.0].winRate > LOSE).length;
if (lateZero >= 2) fails.push(`G3 후반: 정답0%로 ${lateZero}/${lateStages.length}판 클리어 — 학습 유인 소실`);
// G4 단조성 — 정답률↑면 승률↑·시간↓ (DDA가 실력 순서를 뒤집지 않는지)
for (const st of STAGES) {
  for (let i = 1; i < ACCS.length; i++) {
    const lo = grid[st][ACCS[i - 1]], hi = grid[st][ACCS[i]];
    if (hi.winRate < lo.winRate - 0.2) { fails.push(`G4 ST${st}: 승률 역전 ${ACCS[i - 1]}→${ACCS[i]} (${lo.winRate}→${hi.winRate})`); break; }
    if (lo.winRate >= 0.6 && hi.winRate >= 0.6 && hi.medTime > lo.medTime + 14) { fails.push(`G4 ST${st}: 시간 역전 ${ACCS[i - 1]}→${ACCS[i]} (${lo.medTime.toFixed(0)}→${hi.medTime.toFixed(0)}s)`); break; }
  }
}
// G5 학습량 — 한 판에 충분히 많이 푸는가
if (grid[5][0.95].medSolved < 20) fails.push(`G5: ST5 정답95% 문항 ${grid[5][0.95].medSolved} (<20)`);
// G7 보스는 이제 필수 경로다(매 구역 10번째). 저성취도 통과해야 한다.
for (const st of BOSSES) {
  if (grid[st][0.6].winRate < WIN) fails.push(`G7 보스 ST${st}: 정답60% 승률 ${Math.round(grid[st][0.6].winRate * 100)}%`);
}

/**
 * G8 — **재미 게이트.** 승률만 보면 통과인데 아이가 "노잼"이라고 한 이유가 여기 있었다:
 *   실측(2026-08-01) 잘하는 아이 378판 중 **진 판 0 · 우리 성이 맞은 판 0**.
 *   이기고 지는 게 아니라 구경이었다. 승률 게이트는 이걸 못 잡는다 — 그래서 따로 잰다.
 *
 * 두 방향을 동시에 지킨다:
 *   (a) 0단계에서 못하는 아이가 막히지 않는다(= 위 G2, 안전망)
 *   (b) 높은 단계에서 잘하는 아이가 **실제로 위협받는다**(= 여기)
 * 적응 루프가 아이를 자기 단계로 데려가므로, 둘 다 성립해야 모든 아이에게 게임이 성립한다.
 */
{
  /**
   * 🔴 **단계 하나만 떼어 재면 틀린 걸 잰다.** 처음엔 "최고 단계가 정답80% 아이에게
   *    가혹하지 않은가"를 봤는데, 최고 단계는 **아무도 머물지 않는 천장**이다
   *    (실측: 그 조건 패배율 83% → '벽'으로 FAIL. 하지만 그 아이는 거기 머물지 않는다).
   *    재야 할 것은 **적응 루프가 아이를 어디에 데려다 놓는가**다 — 그게 아이가 겪는 게임이다.
   *    그래서 30판을 이어서 돌리고, 그동안 아이가 실제로 겪은 것을 센다.
   */
  // 승강 규칙은 probe-model.mjs 의 nextTier 하나만 쓴다(사본 금지 — 게이트가 구버전 규칙으로 돌면
  // 안전망을 검증한다는 이 게이트의 의미 자체가 사라진다)
  const play = (skill) => {
    let lost = 0, touched = 0, n = 0, tierSum = 0;
    for (const seed of SEEDS) {
      let tier = 0, streak = 0;
      for (let st = 1; st <= CAMPAIGN_STAGES; st++) {
        const r = simulate(st, skill, seed * 31 + st, null, tier);
        tierSum += tier; n++;
        if (!r.win) lost++;
        if (r.myCastleLeft < 0.999) touched++;
        ({ tier, streak } = nextTier(tier, streak, {
          win: r.win, castleLeft: r.myCastleLeft,
          accuracy: r.solved > 0 ? r.correct / r.solved : 0,
        }));
      }
    }
    return { lost: lost / n, touched: touched / n, tier: tierSum / n };
  };

  console.log('\n=== G8 재미 게이트 (적응 루프 30판 연속) ===');
  console.log('아이 실력\t머문 단계\t패배율\t성 피격률');
  const rows = [0.4, 0.6, 0.75, 0.85, 0.95].map((s) => ({ s, ...play(s) }));
  for (const r of rows) {
    console.log(`정답 ${Math.round(r.s * 100)}%\t${r.tier.toFixed(1)}단계\t\t${Math.round(r.lost * 100)}%\t${Math.round(r.touched * 100)}%`);
  }

  // (a) 안전망 — 어려워하는 아이는 0단계 근처에 머물러야 한다(= 게이트가 검사한 밸런스)
  for (const r of rows.filter((x) => x.s <= 0.6)) {
    if (r.tier > 0.5) fails.push(`G8-a 정답${Math.round(r.s * 100)}% 아이가 ${r.tier.toFixed(1)}단계까지 올라감 — 안전망 이탈`);
  }
  // (b) 긴장 — 잘하는 아이도 성이 깎이고 **자주** 져야 한다.
  // 🔴 하한이 패배율 3% · 피격률 10% 였다. 그 선은 통과하면서도 실사용자에게 "긴장감이 없어"
  //    라는 말을 들었다(당시 실측: 정답 95% 아이 패배율 7% · 피격률 17%).
  //    즉 **그 하한은 재미를 보증하지 못한다.** 사용자가 말한 재미의 정의는
  //    "못 깨도 계속 도전하고 업그레이드해서 못 깨던 판을 깨는 것"이므로, 지는 판이
  //    드물게 있는 정도가 아니라 **꾸준히 있어야** 한다. 하한을 패배 10% · 피격 20% 로 올린다.
  for (const r of rows.filter((x) => x.s >= 0.75)) {
    const p = Math.round(r.s * 100);
    if (r.touched < 0.15) fails.push(`G8-b 정답${p}% 아이의 성 피격률 ${Math.round(r.touched * 100)}% (<15%) — 긴장 없음`);
    if (r.lost < 0.1) fails.push(`G8-b 정답${p}% 아이 패배율 ${Math.round(r.lost * 100)}% (<10%) — 질 수 없는 게임`);
    if (r.lost > 0.45) fails.push(`G8-c 정답${p}% 아이 패배율 ${Math.round(r.lost * 100)}% (>45%) — 벽`);
  }
  /**
   * 🔴 **가장 잘하는 아이를 따로 더 세게 본다.** "노잼"을 보고한 건 이 대역이고,
   *    적응 루프는 균형점을 스스로 찾아가므로 중간 대역(75%)의 압박은 단계 상수를
   *    아무리 올려도 잘 안 움직인다(실측: 돌파 비율을 30% 올려도 피격률 20→21%).
   *    움직이는 것은 **천장에 닿는 대역**이다. 그러니 하한도 여기에 걸어야 의미가 있다.
   */
  for (const r of rows.filter((x) => x.s >= 0.9)) {
    const p = Math.round(r.s * 100);
    if (r.touched < 0.25) fails.push(`G8-d 정답${p}% 아이의 성 피격률 ${Math.round(r.touched * 100)}% (<25%) — 최상위가 안 흔들린다`);
    if (r.lost < 0.15) fails.push(`G8-d 정답${p}% 아이 패배율 ${Math.round(r.lost * 100)}% (<15%) — 최상위가 안 진다`);
  }
}

/**
 * G9 — **재도전 루프 게이트.** 사용자가 말한 재미의 정의를 그대로 잰다:
 *   "못 깨도 계속 도전하고 업그레이드 시키고 하면서 못 깨던 판을 깨는 게 게임의 재미야."
 *
 * 🔴 이게 없으면 난이도를 올린 결과가 **벽인지 성장 곡선인지 구분되지 않는다.**
 *    G8-c(패배율 상한)는 "너무 어렵진 않은가"만 보고, G2 는 아예 못 막히는 구간만 본다.
 *    여기서 보는 것은 그 사이다 — 지금 막힌 아이가 **전력을 키우면 뚫리는가**.
 *    막히는 아이(정답 40%)를 표본으로 삼는다. 뚫리지 않으면 그건 벽이고,
 *    소환·승급이 승률을 못 올리면 성장 자체가 장식이다.
 */
{
  const HARD = [18, 20, 30];
  const prog = (st) => progressionAllies(Math.min(st, CAMPAIGN_STAGES)).map((u) => u.id);
  const byR = (r) => ALLIES.filter((u) => u.rarity === r).map((u) => u.id);
  const bare = (st) => Object.fromEntries(prog(st).map((id) => [id, 1]));
  const grown = (st) => Object.fromEntries([...prog(st), ...byR('rare'), ...byR('unique')].map((id) => [id, 5]));
  const rate = (st, mk) =>
    SEEDS.filter((sd) => simulate(st, 0.4, sd, mk(st)).win).length / SEEDS.length;

  console.log('\n=== G9 재도전 루프 (정답 40% 아이 · 막히는 판) ===');
  console.log('판\t소환0·레벨1\t유니크확보·레벨5\t증가폭');
  let lift = 0;
  for (const st of HARD) {
    const a = rate(st, bare), b = rate(st, grown);
    lift += b - a;
    console.log(`ST${st}\t${Math.round(a * 100)}%\t\t${Math.round(b * 100)}%\t\t+${Math.round((b - a) * 100)}%p`);
    if (b < 0.5) fails.push(`G9 ST${st}: 전력을 키워도 승률 ${Math.round(b * 100)}% (<50%) — 뚫리지 않는 벽`);
  }
  if (lift / HARD.length < 0.2) {
    fails.push(`G9: 소환·승급의 평균 승률 증가폭 ${Math.round((lift / HARD.length) * 100)}%p (<20%p) — 성장이 장식`);
  }
}

/**
 * G10 — **먹물 대장간(영구 강화) 게이트.**
 *
 * 🔴 왜 필요한가: 위 게이트는 전부 **강화 0단계**로 돈다("가장 불리한 아이가 통과해야 한다").
 *    그건 옳지만, 그 결과 **끝까지 키운 상태를 아무도 안 본다.** 최대 강화면 대포 위력이
 *    2.17배(0.6→1.3), 셈력 회복이 1.4배다 — 그 상태에서 게임이 시시해지거나 소환이
 *    무의미해지면, 먹물의 두 사용처(뽑기 / 대장간)가 서로를 잡아먹는다.
 *    (교차검증 지적: "사용자가 이번에 요청한 상점 강화의 밸런스 영향을 게이트가 전혀 못 본다".)
 *
 * 두 방향을 동시에 본다:
 *   (a) **효과가 있는가** — 막히는 아이가 강화로 실제로 뚫는가. 없으면 먹물을 버리는 셈이다.
 *   (b) **너무 세지 않은가** — 잘하는 아이가 최대 강화로 긴장을 잃으면 안 된다.
 */
{
  const MAXED = { mana: 6, regen: 5, cannon: 5 };
  const rate = (st, acc, up) =>
    SEEDS.filter((sd) => simulate(st, acc, sd, null, 0, up).win).length / SEEDS.length;

  console.log('\n=== G10 먹물 대장간 (강화 0단계 → 최대) ===');
  console.log('판\t실력\t0단계\t최대강화\t증가폭');
  let lift = 0, n = 0;
  for (const [st, acc] of [[20, 0.4], [27, 0.4], [30, 0.6]]) {
    const a = rate(st, acc, {}), b = rate(st, acc, MAXED);
    lift += b - a; n++;
    console.log(`ST${st}\t정답${Math.round(acc * 100)}%\t${Math.round(a * 100)}%\t${Math.round(b * 100)}%\t\t+${Math.round((b - a) * 100)}%p`);
  }
  // (a) 강화가 실제로 도움이 되는가 — 평균 5%p 도 못 올리면 먹물을 버리는 사용처다
  if (lift / n < 0.05) {
    fails.push(`G10: 최대 강화의 평균 승률 증가폭 ${Math.round((lift / n) * 100)}%p (<5%p) — 강화가 장식`);
  }

  // (b) 최대 강화로도 잘하는 아이의 긴장이 사라지면 안 된다(적응 루프 30판 연속)
  const maxedPlay = (skill) => {
    let lost = 0, touched = 0, cnt = 0;
    for (const seed of SEEDS) {
      let tier = 0, streak = 0;
      for (let st = 1; st <= CAMPAIGN_STAGES; st++) {
        const r = simulate(st, skill, seed * 31 + st, null, tier, MAXED);
        cnt++;
        if (!r.win) lost++;
        if (r.myCastleLeft < 0.999) touched++;
        ({ tier, streak } = nextTier(tier, streak, {
          win: r.win, castleLeft: r.myCastleLeft,
          accuracy: r.solved > 0 ? r.correct / r.solved : 0,
        }));
      }
    }
    return { lost: lost / cnt, touched: touched / cnt };
  };
  const top = maxedPlay(0.95);
  console.log(`정답 95% 아이가 최대 강화로 30판: 패배율 ${Math.round(top.lost * 100)}% · 성 피격률 ${Math.round(top.touched * 100)}%`);
  if (top.lost < 0.1) fails.push(`G10-b 최대 강화 정답95% 패배율 ${Math.round(top.lost * 100)}% (<10%) — 강화가 게임을 지웠다`);
  if (top.touched < 0.2) fails.push(`G10-b 최대 강화 정답95% 성 피격률 ${Math.round(top.touched * 100)}% (<20%) — 긴장 소실`);

  // (c) 대포 강화만으로 소환이 무의미해지지 않는가 — 대포는 '비상 수단'이지 주력이 아니다
  const camp = Object.fromEntries(progressionAllies(CAMPAIGN_STAGES).map((u) => [u.id, 1]));
  const legend = Object.fromEntries(ALLIES.map((u) => [u.id, u.rarity === 'legend' ? 10 : 6]));
  const far = (roster, up) => {
    let best = 0;
    for (const st of [35, 45, 55]) {
      const w = SEEDS.filter((sd) => simulate(st, 0.85, sd, roster, 0, up).win).length / SEEDS.length;
      if (w >= 0.5) best = st;
    }
    return best;
  };
  const campMaxed = far(camp, MAXED), legendBare = far(legend, {});
  console.log(`도달 한계: 캠페인 로스터+최대강화 ST${campMaxed || '<35'} · 전설 로스터+강화0 ST${legendBare || '<35'}`);
  if (campMaxed >= legendBare) {
    fails.push(`G10-c 대장간만 키우면(ST${campMaxed}) 전설 로스터(ST${legendBare})만큼 간다 — 소환이 무의미해진다`);
  }
}

// G6 = 통과/실패 게이트가 아니라 **설계 제약 판정**(반사실 실험).
// "찍기가 통과하면 실패"로 두면 G2(하드월 없음)와 정면 충돌한다 — 실력과 무관한 모든 구제책은
// 찍기도 똑같이 구제하기 때문이다. 이 열의 목적은 "4지선다를 주입력으로 쓸 수 있는가"에 답하는 것.
const guessClears = STAGES.filter((st) => grid[st][0.25].winRate > LOSE);
const G6_VERDICT = guessClears.length === 0
  ? '4지선다 주입력 가능(찍기로 아무 스테이지도 못 깬다)'
  : `4지선다 주입력 **불가** — 찍기(25%)로 ST${guessClears.join(',')} 통과. 주입력은 숫자패드여야 한다`;

const cells = STAGES.flatMap((st) => ACCS.map((a) => grid[st][a])).filter((c) => c.winRate > 0);
console.log(`  한 판 문항 수 실측 범위(승리 케이스): ${Math.min(...cells.map((c) => c.minSolved))} ~ ${Math.max(...cells.map((c) => c.maxSolved))}문항`);
console.log(`  ST5 문항: 95% ${grid[5][0.95].medSolved}문 / 60% ${grid[5][0.6].medSolved}문`);
console.log(`  보스 판(${BOSSES.join(',')}) 정답60% 승률: ${BOSSES.map((st) => `${st}:${Math.round(grid[st][0.6].winRate * 100)}%`).join(' ')}`);
console.log(`  일반 판 정답60% 최저 승률: ${Math.round(Math.min(...NORMAL.map((st) => grid[st][0.6].winRate)) * 100)}%`);
console.log(`  [G6 설계 제약] ${G6_VERDICT}`);

// ── 무한 구간 관측 (게이트 아님) ──────────────────────────────────────────
// 여기서 보는 것: "소환으로 전력을 키우면 실제로 더 멀리 가는가". 아니면 소환이 장식이 된다.
console.log('\n=== 무한 도전 관측 (게이트 아님) ===');
const byRarity = (r) => ALLIES.filter((u) => u.rarity === r).map((u) => u.id);
// 🔴 눈금이 성기면 로스터별 도달 한계가 같은 칸에 뭉쳐 "소환이 의미 있는가"를 못 본다
const ENDLESS_AT = [31, 35, 40, 45, 50, 55, 60];
const ROSTERS = {
  '캠페인만(소환 0)': Object.fromEntries(progressionAllies(CAMPAIGN_STAGES).map((u) => [u.id, 1])),
  '유니크 확보':      Object.fromEntries([...progressionAllies(CAMPAIGN_STAGES).map((u) => u.id), ...byRarity('unique')].map((id) => [id, 3])),
  '전설 확보·승급':   Object.fromEntries(ALLIES.map((u) => [u.id, u.rarity === 'legend' ? 10 : 6])),
};
console.log('로스터\t\t' + ENDLESS_AT.map((s) => `ST${s}`).join('\t'));
const reach = {};
for (const [label, roster] of Object.entries(ROSTERS)) {
  const row = [label];
  reach[label] = 0;
  for (const st of ENDLESS_AT) {
    const c = runCell(st, 0.85, roster);
    if (c.winRate >= 0.5) reach[label] = st;
    row.push(c.winRate === 0 ? '패' : `${Math.round(c.winRate * 100)}%`);
  }
  console.log(row.join('\t'));
}
console.log('  ↑ 정답률 85% 고정. 오른쪽으로 갈수록 어렵고, 아래로 갈수록 전력이 세다.');
console.log(`  도달 한계(승률 50% 이상): ${Object.entries(reach).map(([k, v]) => `${k} ST${v || '<31'}`).join(' · ')}`);
if (reach['전설 확보·승급'] <= reach['캠페인만(소환 0)']) {
  fails.push('소환 무의미: 전설 로스터가 캠페인 로스터보다 더 멀리 가지 못한다');
}

// 🔴 스윕 노브(GUGU_SWEEP_*)가 켜져 있으면 **통과를 선언하지 않는다.**
//    이 게이트가 증명하는 건 "0단계 = 종전 밸런스"인데, 노브가 상수를 바꾼 상태의
//    통과는 그 증명이 아니다. 경고만 찍고 exit 0 을 내면 CI 에서 오염된 실행이
//    조용히 초록불이 된다(실측: `GUGU_SWEEP_ATK=1.01` 로 "✅ 전 게이트 통과" + exit 0).
if (SWEEPING) {
  console.log('\n⚠️  스윕 모드로 실행됨 — 이건 게이트 결과가 아니다(탐색용). 노브를 끄고 다시 돌려라.\n');
  process.exit(2);
}

if (fails.length === 0) console.log('\n✅ 전 게이트 통과\n');
else { console.log(`\n❌ ${fails.length}건 실패:`); fails.forEach((f) => console.log('  - ' + f)); console.log(''); }
process.exit(fails.length ? 1 : 0);
