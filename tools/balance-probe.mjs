#!/usr/bin/env node
/**
 * 구구성 수호대 — 밸런스 프로브 (기획 단계 실측용)
 *
 * 목적: GDD의 수치가 "말이 되는지"를 코드로 확인한다.
 *   L-001(game-builder field-learnings): 밸런스는 유닛테스트 통과로 검증되지 않는다.
 *   난이도(스테이지) × 실력(정답률) 격자를 실제로 굴려 표를 뽑는다.
 *
 * 이 파일은 나중에 src/sim/core.ts 의 씨앗이 된다(로직·렌더 분리 원칙).
 * 렌더러/DOM 의존 0. 고정 타임스텝 결정론.
 *
 * 실행: node tools/balance-probe.mjs [--verbose]
 */

const DT = 0.1;            // 고정 타임스텝(초)
const MAP_LEN = 1000;      // 아군 성 x=0, 적 성 x=MAP_LEN
const MAX_SEC = 420;       // 한 판 상한(초) — 초과 시 무승부 처리
const RNG_SEED = 20260728;

// ── 결정론 RNG (Mulberry32) ───────────────────────────────────────────────
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 유닛 데이터 (아군 = 셈지기) ───────────────────────────────────────────
// cost: 소환 비용, cd: 재소환 쿨다운(초), range: 사거리(px), spd: 이동속도(px/s)
// atk: 1회 타격 피해, aspd: 공격 주기(초), unlock: 해금 스테이지
const ALLIES = [
  { id: 'kkachi', name: '까치돌이', cost: 45,  hp: 240,  atk: 26,  aspd: 1.0, range: 40,  spd: 58, cd: 2.0, unlock: 1 },
  { id: 'musoe',  name: '무쇠솥이', cost: 90,  hp: 620,  atk: 18,  aspd: 1.3, range: 40,  spd: 38, cd: 5.0, unlock: 1 },
  { id: 'bungbung',name:'붕붕이',    cost: 130, hp: 210,  atk: 52,  aspd: 1.5, range: 190, spd: 44, cd: 6.0, unlock: 2 },
  { id: 'dokkabi',name: '먹도깨비',  cost: 210, hp: 420,  atk: 130, aspd: 2.0, range: 60,  spd: 66, cd: 9.0, unlock: 3 },
  { id: 'haetae', name: '해태장군',  cost: 340, hp: 1500, atk: 95,  aspd: 1.8, range: 55,  spd: 32, cd: 14.0,unlock: 5 },
  { id: 'ttokttak', name: '똑딱이'   , cost: 160, hp: 300,  atk: 40,  aspd: 0.7, range: 45,  spd: 50, cd: 6.5, unlock: 6 },
  { id: 'butdaegam',name: '붓대감'  ,  cost: 260, hp: 380,  atk: 88,  aspd: 1.4, range: 230, spd: 40, cd: 10.0,unlock: 7 },
  { id: 'jangseung',name:'장승수문장',cost: 520, hp: 2600, atk: 150, aspd: 2.2, range: 60,  spd: 26, cd: 22.0,unlock: 9 },
];

// ── 적 데이터 (엉킴괴수) ──────────────────────────────────────────────────
const ENEMIES = [
  { id: 'e_mul',  name: '물음표벌레', hp: 260,  atk: 24,  aspd: 1.1, range: 40,  spd: 42 },
  { id: 'e_bat',  name: '뒤집힌박쥐', hp: 180,  atk: 34,  aspd: 0.9, range: 40,  spd: 66 },
  { id: 'e_arch', name: '삐뚤활잡이', hp: 240,  atk: 58,  aspd: 1.7, range: 200, spd: 36 },
  { id: 'e_rock', name: '엉킴바위',   hp: 1400, atk: 60,  aspd: 2.0, range: 45,  spd: 22 },
  { id: 'e_boss', name: '뒤죽박죽왕', hp: 4000, atk: 50,  aspd: 2.2, range: 90,  spd: 0 },
];

// ── 스테이지 정의 (챕터 1 = 10판) ─────────────────────────────────────────
// mult: 적 스탯 배율, castle: 적 성 HP, spawn: [적id, 첫스폰(초), 주기(초), 최대수]
function stageDef(st) {
  const mult = Math.pow(1.13, Math.min(st, 10) - 1);            // 적 성장 = 지수 1.13^(n-1)
  const castle = Math.round(20500 * Math.pow(1.13, Math.min(st, 10) - 1) * (st === 11 ? 0.65 : 1));
  // 🔴 스폰은 유한하다. 무한 반복(시간 기반)으로 두면 느린 플레이어일수록 적이 누적돼
  //    "못하면 더 불리해지는" 죽음의 악순환이 생긴다 — 저성취 하드월의 구조적 원인이었다(실측).
  //    총 물량을 고정하면 실력이 낮은 플레이어는 '느리게' 이길 뿐 '못' 이기지 않는다.
  const spawns = [
    { id: 'e_mul',  t0: 3,  every: Math.max(4.5, 9 - Math.min(st, 10) * 0.45), cap: 8 + Math.min(st, 10) },
  ];
  if (st >= 2) spawns.push({ id: 'e_bat', t0: 14, every: Math.max(6, 13 - Math.min(st, 10) * 0.5), cap: Math.round(3 + Math.min(st, 10) * 0.7) });
  if (st >= 4) spawns.push({ id: 'e_arch',t0: 24, every: Math.max(9, 20 - Math.min(st, 10) * 0.7), cap: Math.round(1 + Math.min(st, 10) * 0.5) });
  if (st >= 6) spawns.push({ id: 'e_rock',t0: 52, every: Math.max(18, 36 - Math.min(st, 10) * 1.2), cap: Math.round(Math.min(st, 10) * 0.4) });
  // 🔴 보스는 ST11 '도전 스테이지'다 — 필수 진행 경로(ST1~10)에 두면 저성취 아동이 진도에서 막힌다.
  //    실측: 보스를 ST10(필수)에 두면 정답60% 승률이 20%까지 떨어져 G2(하드월 없음)를 통과하지 못했다.
  if (st === 11) spawns.push({ id: 'e_boss', t0: 40, every: 9999, cap: 1 });
  return { mult, castle, spawns, playerCastle: Math.round(3400 * Math.pow(1.13, Math.min(st, 10) - 1)) };
}

// ── 플레이어 성장 (스테이지 클리어 누적 강화) ─────────────────────────────
// 🔴 L-001 처방: 적과 플레이어가 "같은 배수"로 자라야 파탄이 없다.
//    적 mult 1.13^(n-1) ↔ 아군 '셈나라 기운' 1.13^(n-1)
// 🔴 이 성장은 **진도 연동 자동 적용**이다(먹물로 구매하지 않는다).
//    구매식으로 두면 필요 먹물 23,818 vs 획득가능 540으로 경제가 성립하지 않는다(실측).
//    먹물은 셈지기 해금·꾸미기 등 선택 소비에만 쓴다.
const allyGrowth = (st) => Math.pow(1.13, Math.min(st, 10) - 1);

// ── 학습(문제 풀이) 모델 ─────────────────────────────────────────────────
// 정답: 셈력 +REWARD × 콤보배율, 다음 문제까지 T_OK초
// 오답: 콤보 0 리셋 + T_BAD초(피드백 노출) 정지
const REWARD = 46;
// 숙련도가 낮으면 "느리게 그리고 자주 틀린다" — 유창성(fluency)은 정확도와 속도가 함께 움직인다.
// 상수 응답시간(v1)은 실력 차이를 절반만 반영해, 찍기 플레이가 후반까지 통과하는 원인이 됐다.
const tOk  = (acc) => 2.3 + (1 - acc) * 2.4;   // 정답95% 2.4s ~ 정답0% 4.7s
const tBad = (acc) => tOk(acc) + 1.6;          // 오답: 피드백 노출 시간 추가
const comboMul = (c) => (c >= 8 ? 1.6 : c >= 5 ? 1.4 : c >= 3 ? 1.2 : 1.0);
const BASE_REGEN = (st) => 5.8 + Math.min(1.6, (st - 1) * 0.2);  // 바닥선: ST1 5.8 → ST9+ 7.4/s
// 🔴 바닥선을 스테이지와 함께 키우면 후반에도 '찍기'가 통한다(실측). 성장은 학습 보상 쪽에만 둔다.

// ── DDA(적응형 난이도) ────────────────────────────────────────────────────
// 연속 오답 3회 → 1단계 하향(체감 정답률 +10%p), 대신 보상 -30%/단계.
// 🔴 보상 페널티는 "못 할수록 이득"이 되지 않을 만큼 커야 한다 — G4 단조성 게이트로 확인한다.
const DDA_STEP_ACC = 0.10, DDA_MAX = 3, DDA_REWARD_PENALTY = 0.30;

// ── 출전 덱 5기 제한 (GDD 1-4) ───────────────────────────────────────────
// 정책: 최저가 물량 1 + 탱커 1 고정, 나머지 3기는 해금분 중 비용 상위
const DECK_SIZE = 5;
const ALLY_CAP = 60;   // 동시 출전 상한 — 없으면 유닛이 무한 누적된다
function buildDeck(st) {
  const unlocked = ALLIES.filter((a) => a.unlock <= Math.min(st, 10));
  const fixed = ['kkachi', 'musoe'].map((id) => unlocked.find((u) => u.id === id)).filter(Boolean);
  const rest = unlocked.filter((u) => !fixed.includes(u))
    .sort((a, b) => b.cost - a.cost).slice(0, DECK_SIZE - fixed.length);
  return [...fixed, ...rest];
}

// ── 시뮬레이션 본체 ──────────────────────────────────────────────────────
function simulate(st, accuracy, seed = 1) {
  // 🔴 공통난수(common random numbers): 시드를 정확도와 무관하게 고정해야
  //    정답률 간 비교가 짝지어진 비교가 된다(v1은 정확도가 시드에 섞여 비교가 무의미했다).
  const rng = makeRng(RNG_SEED + seed * 7919 + st * 1000);
  const def = stageDef(st);
  const g = allyGrowth(st);

  let t = 0;
  let money = 200;   // 시작 소지금 — 초반 연속 오답이 회복 불가 나선이 되지 않게 하는 완충
  let combo = 0;
  let nextQuizAt = 1.5;
  let solved = 0, correct = 0;
  let wrongStreak = 0, rightStreak = 0, ddaLevel = 0;
  let myCastle = def.playerCastle;
  let enCastle = def.castle;

  const units = [];   // {side, x, hp, atk, aspd, range, spd, cdReady}
  const cds = {};     // 아군 재소환 쿨다운
  const spawnNext = {};
  def.spawns.forEach((s) => { spawnNext[s.id] = s.t0; });
  const spawnedCount = {};

  const deck = buildDeck(st);

  while (t < MAX_SEC) {
    // 1) 학습(문제) — 자원 공급의 주 경로
    if (t >= nextQuizAt) {
      solved++;
      const effAcc = Math.min(0.99, accuracy + ddaLevel * DDA_STEP_ACC);
      if (rng() < effAcc) {
        correct++;
        money += REWARD * comboMul(combo) * (1 - ddaLevel * DDA_REWARD_PENALTY);
        combo++;
        wrongStreak = 0; rightStreak++;
        if (rightStreak >= 3 && ddaLevel > 0) { ddaLevel--; rightStreak = 0; }
        nextQuizAt = t + tOk(accuracy);
      } else {
        combo = 0;
        rightStreak = 0; wrongStreak++;
        if (wrongStreak >= 2 && ddaLevel < DDA_MAX) { ddaLevel++; wrongStreak = 0; }
        nextQuizAt = t + tBad(accuracy);
      }
    }
    // 2) 자동 수급(학습을 전혀 안 해도 진행은 되게 하는 바닥선)
    money += BASE_REGEN(st) * DT;

    // 3) 아군 소환 — 정책: 살 수 있는 것 중 가장 비싼 것(쿨다운 아닌 것)
    //    단 "예비금 규칙": 고코스트를 사도 최저가 유닛 2기분은 남겨 전선이 비지 않게 한다.
    //    (실제 플레이어 휴리스틱. 이 규칙이 없으면 돈이 많을수록 물량이 끊겨 정답률↑인데 클리어가 느려지는 역전이 난다)
    const cheapest = Math.min(...deck.map((u) => u.cost));
    const reserve = cheapest * 2;
    const aliveAllies = units.reduce((n, u) => n + (u.side === 1 && u.hp > 0 ? 1 : 0), 0);
    const affordable = aliveAllies >= ALLY_CAP ? [] : deck
      .filter((u) => (cds[u.id] ?? 0) <= t)
      .filter((u) => money >= u.cost && (u.cost === cheapest || money - u.cost >= reserve))
      .sort((a, b) => b.cost - a.cost);
    if (affordable.length) {
      const u = affordable[0];
      money -= u.cost;
      cds[u.id] = t + u.cd;
      units.push({
        side: 1, id: u.id, x: 0,
        hp: u.hp * g, atk: u.atk * g, aspd: u.aspd, range: u.range, spd: u.spd, atkAt: 0,
      });
    }

    // 4) 적 스폰
    for (const s of def.spawns) {
      if (t >= (spawnNext[s.id] ?? Infinity)) {
        const n = (spawnedCount[s.id] ?? 0);
        if (n < s.cap) {
          const e = ENEMIES.find((x) => x.id === s.id);
          units.push({
            side: -1, id: e.id, x: e.spd === 0 ? MAP_LEN - 80 : MAP_LEN,   // 고정형(수문장)은 적 성 앞에 선다
            hp: e.hp * def.mult, atk: e.atk * def.mult, aspd: e.aspd, range: e.range, spd: e.spd, atkAt: 0,
          });
          spawnedCount[s.id] = n + 1;
        }
        spawnNext[s.id] = t + s.every;
      }
    }

    // 5) 전투 / 이동
    for (const u of units) {
      if (u.hp <= 0) continue;
      // 사거리 내 최근접 적 탐색
      let target = null, best = Infinity;
      for (const v of units) {
        if (v.side === u.side || v.hp <= 0) continue;
        const d = Math.abs(v.x - u.x);
        if (d <= u.range && d < best) { best = d; target = v; }
      }
      // 성 공격 판정
      const castleDist = u.side === 1 ? Math.abs(MAP_LEN - u.x) : Math.abs(u.x - 0);
      if (!target && castleDist <= u.range) {
        if (t >= u.atkAt) {
          if (u.side === 1) enCastle -= u.atk; else myCastle -= u.atk;
          u.atkAt = t + u.aspd;
        }
        continue;
      }
      if (target) {
        if (t >= u.atkAt) { target.hp -= u.atk; u.atkAt = t + u.aspd; }
      } else {
        u.x += u.side * u.spd * DT;
        u.x = Math.max(0, Math.min(MAP_LEN, u.x));
      }
    }

    // 6) 정리 / 승패
    for (let i = units.length - 1; i >= 0; i--) if (units[i].hp <= 0) units.splice(i, 1);
    if (enCastle <= 0) {
      return { win: true, time: t, solved, correct, myCastleLeft: Math.max(0, myCastle / def.playerCastle) };
    }
    if (myCastle <= 0) {
      return { win: false, time: t, solved, correct, myCastleLeft: 0 };
    }
    t += DT;
  }
  return { win: false, time: MAX_SEC, solved, correct, myCastleLeft: Math.max(0, myCastle / def.playerCastle), timeout: true };
}


// ── 셀 단위 집계 (시드 5개) ──────────────────────────────────────────────
// v1은 셀당 시드 1개였다 — 표본 1개는 추정치가 아니라 표본이다. RNG 변동이 게이트
// 통과/실패를 뒤집는 것을 실제로 관찰해, 승률 + 중앙값 집계로 바꿨다.
const SEEDS = [1, 2, 3, 4, 5];
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : Infinity; };
function runCell(st, acc) {
  const runs = SEEDS.map((sd) => simulate(st, acc, sd));
  const wins = runs.filter((r) => r.win);
  return {
    winRate: wins.length / runs.length,
    medTime: median(wins.map((r) => r.time)),
    medSolved: median(runs.map((r) => r.solved)),
    minSolved: Math.min(...runs.map((r) => r.solved)),
    maxSolved: Math.max(...runs.map((r) => r.solved)),
  };
}

const ACCS = [0.0, 0.25, 0.4, 0.6, 0.8, 0.95];   // 0.25 = 4지선다 무작위 '찍기'
const STAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const CHALLENGE = 11;   // 보스 = 선택 도전 스테이지(필수 진행 경로 아님)

console.log(`\n=== 구구성 수호대 밸런스 프로브 v2 (난이도 × 정답률 · 시드 ${SEEDS.length}회) ===`);
console.log('셀 = 승률 | 클리어 중앙값(초)/문항수\n');
console.log(['ST', ...ACCS.map((a) => `정답${Math.round(a * 100)}%`)].join('\t'));

const grid = {};
for (const st of [...STAGES, CHALLENGE]) {
  const row = [st === CHALLENGE ? `${st}★` : `${st}`]; grid[st] = {};
  for (const a of ACCS) {
    const c = runCell(st, a); grid[st][a] = c;
    row.push(c.winRate === 0 ? '패' : `${Math.round(c.winRate * 100)}% ${c.medTime.toFixed(0)}s/${c.medSolved}문`);
  }
  console.log(row.join('\t'));
}

console.log('\n=== 게이트 판정 ===');
const fails = [];
const WIN = 0.8, LOSE = 0.2;

// G1 고성취(95%) 전 스테이지 클리어 + 세션 길이 (온보딩은 의도적으로 짧다)
const SESSION_TARGET = (st) => (st <= 3 ? [60, 150] : [80, 220]);
for (const st of STAGES) {
  const c = grid[st][0.95]; const [lo, hi] = SESSION_TARGET(st);
  if (c.winRate < 1) fails.push(`G1 ST${st}: 정답95% 승률 ${Math.round(c.winRate * 100)}%`);
  else if (c.medTime < lo || c.medTime > hi) fails.push(`G1 ST${st}: 중앙값 ${c.medTime.toFixed(0)}s (목표 ${lo}~${hi}s 밖)`);
}
// G1b 저성취 세션이 너무 길면 집중이 끊긴다
for (const st of STAGES) { const c = grid[st][0.6]; if (c.winRate >= WIN && c.medTime > 260) fails.push(`G1b ST${st}: 정답60% ${c.medTime.toFixed(0)}s (>260s)`); }
// G2 하드월 없음 — 저성취(60%)도 전 스테이지 통과 (교육 게임 최우선)
for (const st of STAGES) { const c = grid[st][0.6]; if (c.winRate < WIN) fails.push(`G2 ST${st}: 정답60% 승률 ${Math.round(c.winRate * 100)}% — 하드월`); }
// G3 학습 유인 — 무학습(0%)은 초반만 통과
for (const st of [1, 2, 3]) if (grid[st][0.0].winRate < WIN) fails.push(`G3 ST${st}: 정답0% 승률 ${Math.round(grid[st][0.0].winRate * 100)}% — 진입장벽`);
const lateZero = [6, 7, 8, 9, 10].filter((st) => grid[st][0.0].winRate > LOSE).length;
if (lateZero >= 2) fails.push(`G3 후반: 정답0%로 ${lateZero}/5판 클리어 — 학습 유인 소실`);
// G4 단조성 — 정답률↑면 승률↑·시간↓ (DDA가 실력 순서를 뒤집지 않는지 확인)
for (const st of STAGES) {
  for (let i = 1; i < ACCS.length; i++) {
    const lo = grid[st][ACCS[i - 1]], hi = grid[st][ACCS[i]];
    if (hi.winRate < lo.winRate - 0.2) { fails.push(`G4 ST${st}: 승률 역전 ${ACCS[i - 1]}→${ACCS[i]} (${lo.winRate}→${hi.winRate})`); break; }
    if (lo.winRate >= 0.6 && hi.winRate >= 0.6 && hi.medTime > lo.medTime + 12) { fails.push(`G4 ST${st}: 시간 역전 ${ACCS[i - 1]}→${ACCS[i]} (${lo.medTime.toFixed(0)}→${hi.medTime.toFixed(0)}s)`); break; }
  }
}
// G7 도전 스테이지(보스) — 필수 아님. 고성취는 반드시 클리어 가능해야 하고, 저성취는 못 깨도 진도가 막히지 않는다.
if (grid[CHALLENGE][0.95].winRate < WIN) fails.push(`G7 보스(ST11 도전): 정답95% 승률 ${Math.round(grid[CHALLENGE][0.95].winRate * 100)}% — 고성취도 못 깬다`);
// G5 학습량
if (grid[5][0.95].medSolved < 20) fails.push(`G5: ST5 정답95% 문항 ${grid[5][0.95].medSolved} (<20)`);
// G6 = 통과/실패 게이트가 아니라 **설계 제약 판정**(반사실 실험).
// 처음엔 "찍기가 ST5+를 통과하면 실패"로 뒀으나, 그 형태로는 G2(하드월 없음)와 정면 충돌한다 —
// 실력과 무관한 모든 구제책(시작 소지금·성벽 보호)은 찍기도 똑같이 구제하기 때문이다.
// 이 열의 목적은 밸런스 통과가 아니라 "4지선다를 주입력으로 쓸 수 있는가"에 답하는 것이다.
const guessClears = STAGES.filter((st) => grid[st][0.25].winRate > LOSE);
const G6_VERDICT = guessClears.length === 0
  ? '4지선다 주입력 가능(찍기로 아무 스테이지도 못 깬다)'
  : `4지선다 주입력 **불가** — 찍기(25%)로 ST${guessClears.join(',')} 통과. 주입력은 숫자패드여야 한다`;

const cells = STAGES.flatMap((st) => ACCS.map((a) => grid[st][a])).filter((c) => c.winRate > 0);
console.log(`  한 판 문항 수 실측 범위(승리 케이스): ${Math.min(...cells.map((c) => c.minSolved))} ~ ${Math.max(...cells.map((c) => c.maxSolved))}문항`);
console.log(`  ST5 문항: 95% ${grid[5][0.95].medSolved}문 / 60% ${grid[5][0.6].medSolved}문`);
console.log(`  찍기(25%) 승률 ST4~10: ${[4,5,6,7,8,9,10].map((st) => `${st}:${Math.round(grid[st][0.25].winRate*100)}%`).join(' ')}`);
console.log(`  ST10 보스 승률: 95% ${grid[10][0.95].winRate*100}% / 60% ${grid[10][0.6].winRate*100}%`);

console.log(`  [G6 설계 제약] ${G6_VERDICT}`);

if (fails.length === 0) console.log('\n✅ 전 게이트 통과 — 이 수치를 GDD에 반영 가능\n');
else { console.log(`\n❌ ${fails.length}건 실패:`); fails.forEach((f) => console.log('  - ' + f)); console.log(''); }
process.exit(fails.length ? 1 : 0);
