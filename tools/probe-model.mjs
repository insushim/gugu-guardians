/**
 * 밸런스 프로브 모델 — 유닛/스테이지/전투 시뮬레이션.
 *
 * 🔴 유닛 수치는 `data/roster.json` 에서 읽는다(src/sim/units.ts 와 같은 파일).
 * 🔴 스테이지 공식은 src/sim/stages.ts 와 **같은 값을 내야 한다.**
 *    Node 는 TS를 못 읽으므로 공식이 두 곳에 있는데, `tests/parity.spec.ts` 가
 *    1~80판의 실제 출력값을 통째로 대조한다(소스 문자열이 아니라 숫자를 비교한다).
 *
 * ⚠️ **알고 있는 격차 하나 — 틱 시계.** 코어 `step()` 은 `this.t += dt` 를 맨 먼저 하고,
 *    여기는 루프 끝에서 `t += DT` 를 한다. 즉 첫 틱의 t 가 한 스텝만큼 어긋난다(교차검증 지적).
 *    맞추지 않는 이유: 이 모델은 실제 게임의 **복제**가 아니라 정답률·스테이지 간 **상대 비교**
 *    도구이고(타임스텝부터 다르다 — 코어 1/30초 vs 여기 0.1초), 지금 게이트의 임계값이 전부
 *    이 시계로 보정돼 있다. 맞추려면 모든 게이트를 다시 재야 하고 얻는 건 없다.
 *    **다만 절대 승패를 이 프로브로 단정하지 말 것** — 경계 근처는 한 틱만큼 흔들린다.
 */
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
export const ROSTER = JSON.parse(readFileSync(`${ROOT}data/roster.json`, 'utf8'));

export const ALLIES = ROSTER.allies;
export const ENEMIES = ROSTER.enemies;
export const DECK_SIZE = ROSTER.deckSize;
/** 전장 **자리** 상한(마리 수 아님) — src/sim/units.ts 와 1:1 */
export const ALLY_CAP = ROSTER.allyCap;
export const LEVEL_GAIN = ROSTER.levelGain;
export const SLOTS_BY_RARITY = ROSTER.slotsByRarity;
export const slotsOf = (u) => Math.max(1, Math.floor(SLOTS_BY_RARITY[u.rarity] ?? 1));
/** 방어력을 뚫지 못한 공격이 남기는 몫 — src/sim/core.ts 의 ARMOR_FLOOR 와 1:1 */
export const ARMOR_FLOOR = 0.15;
export const SPLIT_SPREAD = 26;
/** 한 마리가 갈라져 나올 수 있는 최대 수 — src/sim/core.ts 의 SPLIT_MAX 와 1:1 */
export const SPLIT_MAX = 4;

export const DT = 0.1;
export const MAP_LEN = 1000;
export const MAX_SEC = 420;
export const RNG_SEED = 20260728;

// ── 결정론 RNG (Mulberry32) ───────────────────────────────────────────────
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 스테이지 (src/sim/stages.ts 와 동일 공식) ─────────────────────────────
export const CAMPAIGN_STAGES = 30;
export const CHAPTER_LEN = 10;
const VOLUME_CAP_STAGE = 30;
const ENDLESS_STEP = 1.07;
const BOSSES = ['e_boss', 'e_boss2', 'e_boss3', 'e_boss4'];
const TYPE_ORDER = ['A1', 'S1', 'A2', 'M1', 'S2', 'AS1', 'M2', 'D1', 'AS2', 'M3', 'D2'];
export const REVIEW_WINDOW = 6;

/** 동시 활성 종류를 10종 안팎으로 유지한다 — src/sim/stages.ts 의 WAVES 와 1:1(은퇴 열 포함) */
const FOREVER = Infinity;   // 🔴 9999 로 두면 '무한'이 1만 판에서 끝난다(교차검증 지적)
const WAVES = [
  //  id          등장  은퇴     t0   주기   하한  지분
  ['e_mul',     1, FOREVER,  3,  9.0,  4.0, 0.30],
  ['e_bat',     2,      12, 14, 13.0,  5.5, 0.12],
  ['e_swarm',   3, FOREVER,  8,  8.0,  3.5, 0.10],
  ['e_arch',    4,      14, 24, 20.0,  8.0, 0.12],
  ['e_split',   5, FOREVER, 20, 16.0,  7.0, 0.06],
  ['e_rock',    6,      16, 52, 36.0, 16.0, 0.14],
  ['e_zero',    7,      13, 18, 10.0,  4.0, 0.08],
  ['e_sky',    12, FOREVER, 28, 22.0,  9.0, 0.05],
  ['e_knot',    9,      18, 30, 22.0,  9.0, 0.12],
  ['e_ghost',  15, FOREVER, 34, 26.0, 12.0, 0.06],
  ['e_minus',  12,      20, 36, 26.0, 11.0, 0.10],
  ['e_dash',   13, FOREVER, 26, 18.0,  7.0, 0.04],
  ['e_shield', 16, FOREVER, 60, 45.0, 22.0, 0.14],
  ['e_armor',  18, FOREVER, 44, 30.0, 14.0, 0.06],
  ['e_thorn',  20, FOREVER, 50, 34.0, 15.0, 0.06],
  ['e_drum',   22, FOREVER, 40, 28.0, 13.0, 0.05],
];
const BOSS_SHARE = 0.5, BOSS_MOB_SHARE = 0.75, PER_WAVE_CAP = 40;
export const BUDGET_SLOPE = 0.10;

/**
 * 🔴 **스윕 전용 배율.** 상수를 손으로 고쳐 가며 재면 되돌리는 걸 잊는다 —
 *    그러면 게이트가 다른 숫자로 통과해 버린다. 대신 환경변수로만 흔들고,
 *    흔들렸을 때는 **표준 출력에 크게 찍어** 그 실행 결과를 게이트 통과로 착각하지 않게 한다.
 *    (설정되지 않으면 1.0 = 아무 영향 없음. CI 는 이 변수를 쓰지 않는다.)
 */
const SWEEP_BUDGET = Number(process.env['GUGU_SWEEP_BUDGET'] ?? 1);
const SWEEP_CASTLE = Number(process.env['GUGU_SWEEP_CASTLE'] ?? 1);
const SWEEP_EVERY = Number(process.env['GUGU_SWEEP_EVERY'] ?? 1);   // 스폰 간격 배율(작을수록 몰려온다)
export const SWEEP_ATK = Number(process.env['GUGU_SWEEP_ATK'] ?? 1);   // 적 공격력 배율
/**
 * 특정 괴수를 빼고 돌린다(쉼표 구분 id). **원인 귀속용**이다 —
 * 신규 괴수를 넣고 게이트가 깨졌을 때 "어느 놈 때문인가"는 추측이 아니라 빼 보면 안다.
 */
const SWEEP_SKIP = (process.env['GUGU_SWEEP_SKIP'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
export const SWEEPING = SWEEP_BUDGET !== 1 || SWEEP_CASTLE !== 1 || SWEEP_EVERY !== 1 || SWEEP_ATK !== 1
  || SWEEP_SKIP.length > 0;
if (SWEEPING) {
  console.log(`\n⚠️  스윕 모드 — 적 예산 ×${SWEEP_BUDGET} · 성 체력 ×${SWEEP_CASTLE} · 스폰간격 ×${SWEEP_EVERY} · 적공격 ×${SWEEP_ATK}${SWEEP_SKIP.length ? ` · 제외 ${SWEEP_SKIP.join(',')}` : ''}. 이 실행은 게이트가 아니다.\n`);
}

export const CASTLE_K = 25000 * SWEEP_CASTLE;
/** 1판 적 **군대** 총 체력 기준값 — src/sim/stages.ts 의 BUDGET_K 와 1:1 */
export const BUDGET_K = 2340 * SWEEP_BUDGET;
/**
 * 적응형 전투 난이도 — src/sim/tier.ts 와 **1:1**. (tests/parity.spec.ts 가 값을 대조한다)
 * 🔴 0단계는 종전 밸런스와 완전히 같아야 한다: 배율 1.0 · 돌파 0 · 광역 0 · 목표정답률 0.85.
 */
export const MAX_TIER = 12;
export const TIER_ATK = [1.0, 1.9, 2.8, 3.8, 5.1, 6.8, 9.1, 12.2, 16.4, 22.1, 29.8, 40.2, 54.2];
export const TIER_BREAK = [0, 0.26, 0.36, 0.43, 0.49, 0.55, 0.61, 0.67, 0.72, 0.77, 0.81, 0.85, 0.88];
export const TIER_AOE = [0, 55, 75, 90, 105, 118, 132, 146, 160, 175, 190, 205, 220];
export const TIER_TARGET_P =
  [0.85, 0.84, 0.82, 0.81, 0.79, 0.78, 0.77, 0.77, 0.77, 0.77, 0.77, 0.77, 0.77];
const tclamp = (t) => Math.max(0, Math.min(MAX_TIER, Math.floor(Number.isFinite(t) ? t : 0)));

// 성문 앞 통로 / 예비대 — src/sim/core.ts 와 1:1 (tests/tier.spec.ts 가 값을 대조한다)
export const ALLY_CEIL_GAP = 90;
const ALLY_CEIL = MAP_LEN - ALLY_CEIL_GAP;
export const RESERVE_SHARE = 0.25;

/**
 * 예비대가 **다 나와 있어야 하는** 성 진행도. 1.0 으로 두면 마지막 예비대가
 * 성이 무너지는 순간 나와 사실상 안 싸운다(실측: 게이트가 오히려 쉬워져 3건 실패).
 */
export const RESERVE_COVER = 0.85;

/**
 * 단계 승강 규칙 — src/sim/tier.ts 의 nextTier 와 1:1.
 * 🔴 프로브 쪽 사본은 **여기 하나뿐이어야 한다.** 예전엔 balance-probe.mjs 와
 *    adaptive-probe.mjs 가 각자 복사본을 들고 있었다. 표 값만 대조하는 parity
 *    테스트로는 규칙이 갈라져도 안 잡혀서, 게이트가 구버전 규칙으로 조용히
 *    초록불을 낼 수 있었다. tests/tier.spec.ts 가 이 함수의 **출력**을 대조한다.
 */
export const EASY_STREAK_TO_RAISE = 1;
export const LOSE_STREAK_TO_DROP = 2;
export function nextTier(tier, streak, m) {
  const t = tclamp(tier);
  if (!m.win) {
    const s = Math.min(0, streak) - 1;      // 연패는 음수로 센다
    return s <= -LOSE_STREAK_TO_DROP ? { tier: tclamp(t - 1), streak: 0 } : { tier: t, streak: s };
  }
  // 압도(성 무피격 + 정답 90%↑)는 한 판으로 두 칸 — src/sim/tier.ts 의 dominant 와 1:1
  if (m.castleLeft >= 0.999 && m.accuracy >= 0.9) return { tier: tclamp(t + 2), streak: 0 };
  if (!(m.castleLeft >= 0.85 && m.accuracy >= 0.7)) return { tier: t, streak: 0 };
  const s = Math.max(0, streak) + 1;
  return s >= EASY_STREAK_TO_RAISE ? { tier: tclamp(t + 1), streak: 0 } : { tier: t, streak: s };
}

// 판 길이 램프 — src/sim/stages.ts 의 lengthRamp 와 1:1 (tests/parity.spec.ts 가 대조)
export const LEN_RAMP_END = 12;
export const LEN_RAMP_MIN = 0.50;
export const lengthRamp = (n) =>
  LEN_RAMP_MIN + (1 - LEN_RAMP_MIN) * Math.min(1, Math.max(0, (n - 1) / (LEN_RAMP_END - 1)));
export const REWARD_SLOPE_RATIO = 1.6;
const ENEMY_HP = Object.fromEntries(ENEMIES.map((e) => [e.id, e.hp]));
const ENEMY_BY_ID = Object.fromEntries(ENEMIES.map((e) => [e.id, e]));

/**
 * 수량 계산에 쓰는 실효 체력 — src/sim/stages.ts 의 effectiveHp 와 1:1.
 * 분열형은 새끼 체력까지 자기 몫으로 쳐야 지분 예산이 안 샌다.
 */
export function effectiveHp(id) {
  const e = ENEMY_BY_ID[id];
  if (!e) return 200;
  const child = e.split ? (ENEMY_HP[e.split.id] ?? 0) * e.split.n : 0;
  return e.hp + child;
}

/** 한 판에 나오는 적의 기준 총 체력(배율 적용 전) */
export function enemyBudget(index) {
  const v = Math.min(Math.max(1, index), VOLUME_CAP_STAGE);
  return BUDGET_K * (1 + (v - 1) * BUDGET_SLOPE);
}

export const chapterOf = (n) => Math.floor((n - 1) / CHAPTER_LEN) + 1;
export const posOf = (n) => ((n - 1) % CHAPTER_LEN) + 1;
export const isBossStage = (n) => posOf(n) === CHAPTER_LEN;
export const allyGrowth = (n) => Math.pow(1.13, Math.min(n, CAMPAIGN_STAGES) - 1);
export const enemyMult = (n) => allyGrowth(n) * Math.pow(ENDLESS_STEP, Math.max(0, n - CAMPAIGN_STAGES));

export function quizTypesFor(n) {
  const open = TYPE_ORDER.slice(0, Math.min(TYPE_ORDER.length, 2 + Math.floor((n - 1) / 3)));
  // 복습은 최근 배운 것 안에서만 — src/sim/stages.ts 의 REVIEW_WINDOW 와 1:1
  const pool = open.slice(Math.max(0, open.length - REVIEW_WINDOW));
  const picks = [];
  const add = (t) => { if (t && !picks.includes(t)) picks.push(t); };
  add(pool[pool.length - 1]);
  add(pool[(n * 3) % pool.length]);
  add(pool[(n * 7 + 2) % pool.length]);
  for (let i = pool.length - 1; i >= 0 && picks.length < Math.min(3, pool.length); i--) add(pool[i]);
  return picks.sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b));
}

export function stageDef(index) {
  const n = Math.max(1, Math.floor(index));
  const chapter = chapterOf(n);
  const boss = isBossStage(n);
  const growth = allyGrowth(n);
  const budget = enemyBudget(n);
  const v = Math.min(n, VOLUME_CAP_STAGE);

  const active = WAVES.filter(([id, from, to]) => n >= from && n <= to && !SWEEP_SKIP.includes(id));
  const shareSum = active.reduce((s, w) => s + w[6], 0) || 1;
  const mobBudget = budget * (boss ? BOSS_MOB_SHARE : 1);

  const spawns = [];
  for (const [id, , , t0, everyBase, everyMin, share] of active) {
    const hp = effectiveHp(id);
    spawns.push({
      id,
      t0,
      every: Math.max(everyMin, everyBase - (v * (everyBase - everyMin)) / VOLUME_CAP_STAGE) * SWEEP_EVERY,
      cap: Math.max(1, Math.min(PER_WAVE_CAP, Math.round((mobBudget * (share / shareSum)) / hp))),
    });
  }
  if (boss) {
    const id = BOSSES[(chapter - 1) % BOSSES.length];
    spawns.push({ id, t0: 35, every: 9999, cap: 1, hpMul: (budget * BOSS_SHARE) / ENEMY_HP[id] });
  }

  return {
    index: n,
    chapter,
    pos: posOf(n),
    mult: enemyMult(n),
    castleHp: Math.round(CASTLE_K * growth * lengthRamp(n) * (boss ? 0.7 : 1)),
    playerCastleHp: Math.round(3400 * growth),
    spawns,
    quizTypes: quizTypesFor(n),
    boss,
    endless: n > CAMPAIGN_STAGES,
  };
}

// ── 학습(문제 풀이) 모델 ─────────────────────────────────────────────────
export const REWARD = 46;
export const rewardBase = (st) => REWARD * (1 + (Math.min(st, CAMPAIGN_STAGES) - 1) * BUDGET_SLOPE * REWARD_SLOPE_RATIO);
export const START_MONEY = 200;
// 숙련도가 낮으면 "느리게 그리고 자주 틀린다" — 유창성은 정확도와 속도가 함께 움직인다.
export const tOk = (acc) => 2.3 + (1 - acc) * 2.4;
export const tBad = (acc) => tOk(acc) + 1.6;
export const comboMul = (c) => (c >= 8 ? 1.6 : c >= 5 ? 1.4 : c >= 3 ? 1.2 : 1.0);
// 🔴 바닥선을 스테이지와 함께 크게 키우면 후반에도 '찍기'가 통한다(v1 실측).
export const BASE_REGEN = (st) => 5.8 + Math.min(1.6, (Math.min(st, 10) - 1) * 0.2);

// 셈력 그릇·배속 — src/sim/economy.ts 와 1:1 (tests/parity.spec.ts 가 대조)
// 🔴 기본 상한은 로스터에서 유도한다 — 가장 비싼 셈지기보다 작으면 그 유닛이 소환 불가가 된다
export const MANA_CAP_BASE = Math.max(
  600,
  Math.max(...ALLIES.map((u) => u.cost)) + Math.min(...ALLIES.map((u) => u.cost)) * 2,
);
export const MANA_CAP_STEP = 180, MANA_CAP_MAX_LV = 6;
export const manaCap = (lv) => MANA_CAP_BASE + Math.max(0, Math.min(MANA_CAP_MAX_LV, Math.floor(lv))) * MANA_CAP_STEP;
// 신바람(아군 가속) — 세상의 시계가 아니라 **아군 유닛**만 빨라진다
export const HASTE_MAX = 1.8, HASTE_PER_CORRECT = 0.22, HASTE_DECAY = 0.08;
export const hasteOf = (b) => 1 + Math.max(0, Math.min(HASTE_MAX - 1, b));

// 셈력 샘(회복 속도 강화) — src/sim/economy.ts 와 1:1. 게이트는 0단계(안 산 아이)로 잰다
export const REGEN_MAX_LV = 5, REGEN_PER_LV = 0.08;
export const regenMult = (lv) => 1 + REGEN_PER_LV * Math.max(0, Math.min(REGEN_MAX_LV, Math.floor(lv)));

// 먹 대포 — src/sim/economy.ts 와 1:1
export const CANNON_PER_CORRECT = 0.07, CANNON_KNOCKBACK = 90;
export const CANNON_MAX_LV = 5;
export const cannonMult = (lv) => 0.6 + 0.14 * Math.max(0, Math.min(CANNON_MAX_LV, Math.floor(lv)));
// 프로브 전용 보수 가정: 아이가 '다 찼다'를 알아채고 누르기까지의 지연(초)
export const CANNON_REACT_SEC = 6;
export const cannonDamage = (budget) => budget * 0.05;
// 🔴 대포는 적 성에도 피해를 준다 — src/sim/economy.ts 의 CANNON_CASTLE_SHARE 와 1:1.
//    (전선이 적 성까지 밀고 올라가면 화면에 적이 없어 대포가 '고장난 버튼'이 되던 문제)
export const CANNON_CASTLE_SHARE = 0.03;

// DDA: 연속 오답 2회 → 1단계 하향(체감 정답률 +10%p), 대신 보상 -30%/단계
/**
 * 🔴 DDA_STEP_ACC = **0**. 예전엔 0.10(단계당 정답률 +10%p)이었는데, 그건 실제 게임이
 *    해 주지 못하는 구제를 모델이 대신 해 주고 있던 것이다 — 게임의 DDA 는 문항 *레벨*을
 *    낮추는데, 레벨 사다리가 좁아 대부분의 아이가 이미 레벨 1(바닥)이라 더 내려갈 데가 없다.
 *    즉 모델 속 "막힌 아이"만 최대 +30%p 를 받고 있었다(실측: 실제 보정 0).
 *    빼고 다시 돌려도 전 게이트 통과한다(일반 판 정답60% 최저 승률 90% → 86%,
 *    보스 100% → 95%). 밸런스 표가 실제보다 후하게 나오는 쪽이 훨씬 위험하므로 0으로 둔다.
 *    사다리를 넓혀 DDA 가 실제로 발화하게 되면(=`curriculum.difficultyOf` 손보면) 되돌릴 것.
 */
export const DDA_STEP_ACC = 0.0, DDA_MAX = 3, DDA_REWARD_PENALTY = 0.30;

/** 진도로 무료 해금되는 유닛 */
export function progressionAllies(stage) {
  return ALLIES.filter((u) => u.unlock >= 1 && u.unlock <= stage);
}

export const rarityRank = (id) => ROSTER.rarities.findIndex((r) => r.id === id);
/** 전설 특별기술의 평균 기여까지 넣어 센다 — src/sim/units.ts 의 dps 와 1:1 */
export const dps = (u) => {
  const base = u.atk / Math.max(0.1, u.aspd);
  if (!u.skill || u.skill.every < 2) return base;
  return base * ((u.skill.every - 1 + u.skill.mult) / u.skill.every);
};
export const power = (u) => dps(u) * Math.sqrt(u.hp);
export const levelMult = (lv) => 1 + LEVEL_GAIN * (Math.max(1, lv) - 1);

/**
 * 덱 구성 — src/sim/units.ts 의 defaultDeck 과 같은 정책(역할 커버리지).
 */
export function buildDeck(owned) {
  if (owned.length === 0) return [];
  const pick = [];
  const take = (u) => { if (u && !pick.includes(u)) pick.push(u); };
  const rest = () => owned.filter((u) => !pick.includes(u));
  take([...owned].sort((a, b) => a.cost - b.cost)[0]);
  take([...rest()].sort((a, b) => b.hp / b.cost - a.hp / a.cost)[0]);
  take([...rest()].filter((u) => u.range >= 150).sort((a, b) => dps(b) / b.cost - dps(a) / a.cost)[0]);
  take([...rest()].sort((a, b) => power(b) - power(a))[0]);
  for (const u of [...rest()].sort((a, b) => power(b) / b.cost - power(a) / a.cost)) {
    if (pick.length >= DECK_SIZE) break;
    take(u);
  }
  return pick.slice(0, DECK_SIZE);
}

/**
 * 한 판 시뮬레이션.
 * @param roster {Record<string, number>} 보유 유닛 id → 레벨. 생략하면 진도 해금분만 레벨1.
 */
/**
 * @param up {{mana?:number, regen?:number, cannon?:number}} 먹물로 산 영구 강화 단계.
 *   🔴 기본은 **0단계(아무것도 안 산 아이)** 다 — 게이트는 가장 불리한 쪽을 통과해야 한다.
 *      그런데 0단계만 재면 **끝까지 키운 상태가 게임을 망가뜨리는지**는 아무도 못 본다
 *      (교차검증 지적: 최대 강화 시 대포 2.17배·샘 1.4배인데 그 상태의 승률이 미측정).
 *      그래서 인자로 열어 두고, balance-probe 의 G10 이 최대 강화 상태를 따로 잰다.
 */
export function simulate(st, accuracy, seed = 1, roster = null, tier = 0, up = {}) {
  const T = tclamp(tier);
  /**
   * 🔴 목표 정답률을 낮추면 **같은 아이의 실제 정답률이 내려간다.** 문항이 더 어려워지니까.
   *    프로브의 `accuracy` 는 '실현 정답률'이라, 단계가 오르면 그만큼 깎아 넣어야
   *    "문항이 어려워져서 셈력이 줄고 전투도 같이 힘들어진다"는 결합이 모델에 반영된다.
   *    이걸 빼먹으면 게이트가 실제보다 후해진다.
   */
  //    실측 대응표(30판 종단): 목표 0.85→체감 84% · 0.80→77% · 0.72→62%.
  //    목표 1 만큼 낮추면 체감은 약 1.45 만큼 떨어진다 — 그 기울기를 그대로 쓴다.
  const accEff = Math.max(0, accuracy - 1.45 * (TIER_TARGET_P[0] - TIER_TARGET_P[T]));
  // 🔴 공통난수: 시드를 정확도와 무관하게 고정해야 정답률 간 비교가 짝지어진 비교가 된다.
  const rng = makeRng(RNG_SEED + seed * 7919 + st * 1000);
  const def = stageDef(st);
  const g = allyGrowth(st);

  const ownedList = roster
    ? ALLIES.filter((u) => roster[u.id] !== undefined)
    : progressionAllies(Math.min(st, CAMPAIGN_STAGES));
  const deck = buildDeck(ownedList);
  const lvOf = (id) => (roster ? roster[id] ?? 1 : 1);

  let t = 0;
  const cap = manaCap(up.mana ?? 0);
  const regenMul = regenMult(up.regen ?? 0);
  const cannonMul = cannonMult(up.cannon ?? 0);
  let money = Math.min(START_MONEY, cap);
  let hasteBoost = 0;
  let cannon = 0;
  let cannonFullAt = -1;   // 다 찬 시각(반응 지연 계산용)
  let combo = 0;
  let nextQuizAt = 1.5;
  let solved = 0, correct = 0;
  let wrongStreak = 0, rightStreak = 0, ddaLevel = 0;
  let myCastle = def.playerCastleHp;
  let enCastle = def.castleHp;
  let maxAllyX = 0;   // 테스트가 통로 거동을 검사한다 — tests/spawn-corridor.spec.ts
  /** 동시 출전 최대 **마리 수**. 🔴 자리(slot) 상한이 프로브에도 걸려 있는지를
   *  거동으로 확인하는 값이다 — 상수만 대조하면 프로브가 마리 수로 세도 안 잡힌다. */
  let maxAllies = 0;
  /** 동시 사용 최대 **자리** 수 — 상한(ALLY_CAP)이 프로브에도 걸려 있는지를 재는 값 */
  let maxSlots = 0;
  /**
   * 🔴 신규 메카닉이 프로브에서 **실제로 돌았는지** 세는 계수기.
   *    미러가 조용히 갈라지면(코어엔 있고 프로브엔 없으면) 밸런스 게이트가 실제 게임과
   *    다른 것을 검증하게 되는데, 상수 대조로는 그걸 못 잡는다 — 예비대 미러가 그렇게 뚫렸다.
   *    거동을 세어 두면 "프로브에서 방어력이 한 번도 안 걸렸다" 같은 누락이 테스트에서 드러난다.
   */
  const fired = { armorBlocked: 0, skillHits: 0, splitBorn: 0, aoeHits: 0 };
  /** 스폰 시각 기록 — 미러 테스트가 **상수가 아니라 거동**을 코어와 대조한다 */
  const spawnLog = [];

  const units = [];
  const cds = {};
  const spawnNext = {};
  def.spawns.forEach((s) => { spawnNext[s.id] = s.t0; });
  const spawnedCount = {};

  // ── src/sim/core.ts 의 makeEnemy / hurt / swing 과 1:1 ────────────────────
  // 🔴 스폰과 분열이 같은 규칙을 쓰도록 한 곳에 모은다(코어와 같은 이유).
  const makeEnemy = (e, hpMul, rollBreaker, x, canSplit = true) => {
    const breaker = e.spd > 0 && (e.breaker === true || rollBreaker);
    const aoe = Math.max(e.aoe ?? 0, e.spd <= 24 ? TIER_AOE[T] : 0);
    return {
      side: -1, id: e.id,
      x: x ?? (e.spd === 0 ? MAP_LEN - 80 : MAP_LEN),
      hp: e.hp * def.mult * hpMul,
      atk: e.atk * def.mult * SWEEP_ATK * TIER_ATK[T],
      aspd: e.aspd, range: e.range,
      spd: breaker ? e.spd * 1.25 : e.spd,
      atkAt: 0, breaker,
      // 방어력도 스테이지 배율을 따라 커진다 — src/sim/core.ts 와 1:1
      aoe, armor: (e.armor ?? 0) * def.mult, hits: 0, skill: null,
      // 분열로 태어난 개체는 다시 갈라지지 않는다 — src/sim/core.ts 의 canSplit 과 1:1
      slots: 0,
      split: canSplit && e.split
        ? { id: e.split.id, n: Math.max(1, Math.min(SPLIT_MAX, Math.floor(e.split.n))) }
        : null,
    };
  };
  /** 방어력 감산. 완전 무효는 만들지 않는다(ARMOR_FLOOR) */
  const hurt = (v, dmg) => {
    if (v.armor > 0) {
      const after = Math.max(dmg * ARMOR_FLOOR, dmg - v.armor);
      if (after < dmg) fired.armorBlocked += dmg - after;
      v.hp -= after;
      return;
    }
    v.hp -= dmg;
  };
  /** 이번 한 대의 위력·광역. 때린 횟수는 여기서만 센다(성 공격도 같은 카운터) */
  const swing = (u) => {
    u.hits += 1;
    const sk = u.skill;
    if (sk && sk.every >= 2 && u.hits % sk.every === 0) {
      fired.skillHits++;
      return { dmg: u.atk * sk.mult, aoe: sk.aoe };
    }
    return { dmg: u.atk, aoe: u.aoe };
  };

  while (t < MAX_SEC) {
    // 1) 학습(문제) — 자원 공급의 주 경로
    if (t >= nextQuizAt) {
      solved++;
      const effAcc = Math.min(0.99, accEff + ddaLevel * DDA_STEP_ACC);
      if (rng() < effAcc) {
        correct++;
        money = Math.min(cap, money + rewardBase(st) * comboMul(combo) * (1 - ddaLevel * DDA_REWARD_PENALTY));
        hasteBoost = Math.min(HASTE_MAX - 1, hasteBoost + HASTE_PER_CORRECT);
        cannon = Math.min(1, cannon + CANNON_PER_CORRECT);
        combo++;
        wrongStreak = 0; rightStreak++;
        if (rightStreak >= 3 && ddaLevel > 0) { ddaLevel--; rightStreak = 0; }
        nextQuizAt = t + tOk(accEff);
      } else {
        combo = 0;
        rightStreak = 0; wrongStreak++;
        if (wrongStreak >= 2 && ddaLevel < DDA_MAX) { ddaLevel++; wrongStreak = 0; }
        nextQuizAt = t + tBad(accEff);
      }
    }
    // 2) 자동 수급(학습을 전혀 안 해도 진행은 되게 하는 바닥선)
    money = Math.min(cap, money + BASE_REGEN(st) * regenMul * DT);
    hasteBoost = Math.max(0, hasteBoost - HASTE_DECAY * DT);

    // 2-b) 먹 대포 — 다 차면 **알아채고** 쏜다.
    //   🔴 "충전되는 즉시 자동 발사"로 두면 아이보다 프로브가 더 잘 쓰는 게 되어
    //      게이트가 실제보다 후하게 나온다. 게이트는 **못 쓰는 쪽으로 치우쳐야** 안전하다.
    //      그래서 (a) 다 찬 뒤 반응 지연을 두고 (b) 적이 둘 이상 몰렸을 때만 쓴다 —
    //      아이는 게이지를 계속 쳐다보지 않고, 밀린다고 느낄 때 누른다.
    if (cannon >= 1 && cannonFullAt < 0) cannonFullAt = t;
    if (cannon >= 1 && t - cannonFullAt >= CANNON_REACT_SEC) {
      const live = units.filter((u) => u.side === -1 && u.hp > 0);
      // 🔴 예전엔 '적 2마리 이상일 때만' 쐈다. 이제 대포는 성에도 피해를 주므로 아이는
      //    **불이 들어오면 그냥 누른다.** 게이트가 봐야 할 것은 그 최대치다 —
      //    "대포만으로 굴러가서 소환이 무의미해지지 않는가"를 검사하려면 아끼면 안 된다.
      {
        cannon = 0;
        cannonFullAt = -1;
        const dmg = cannonDamage(enemyBudget(st)) * allyGrowth(st) * cannonMul;
        for (const u of live) {
          hurt(u, dmg);
          if (u.spd > 0) u.x = Math.min(MAP_LEN, u.x + CANNON_KNOCKBACK);
        }
        enCastle -= def.castleHp * CANNON_CASTLE_SHARE * cannonMul;
      }
    }

    // 3) 아군 소환 — 살 수 있는 것 중 가장 비싼 것.
    //    "예비금 규칙": 고코스트를 사도 최저가 유닛 2기분은 남겨 전선이 비지 않게 한다.
    //    (이 규칙이 없으면 돈이 많을수록 물량이 끊겨 정답률↑인데 클리어가 느려지는 역전이 난다)
    if (deck.length) {
      const cheapest = Math.min(...deck.map((u) => u.cost));
      const reserve = cheapest * 2;
      // 🔴 상한은 마리 수가 아니라 **자리 수**다 — src/sim/core.ts 의 usedSlots 와 1:1.
      //    마리 수로 세면 프로브만 전설을 18기 세워 게이트가 실제보다 후하게 나온다.
      const usedSlots = units.reduce((n, u) => n + (u.side === 1 && u.hp > 0 ? u.slots : 0), 0);
      const alive = units.reduce((n, u) => n + (u.side === 1 && u.hp > 0 ? 1 : 0), 0);
      if (alive > maxAllies) maxAllies = alive;
      const affordable = deck
        .filter((u) => usedSlots + slotsOf(u) <= ALLY_CAP)
        .filter((u) => (cds[u.id] ?? 0) <= t)
        .filter((u) => money >= u.cost && (u.cost === cheapest || money - u.cost >= reserve))
        .sort((a, b) => b.cost - a.cost);
      if (affordable.length) {
        const u = affordable[0];
        const m = g * levelMult(lvOf(u.id));
        money -= u.cost;
        cds[u.id] = t + u.cd;
        units.push({
          side: 1, id: u.id, x: 0, hp: u.hp * m, atk: u.atk * m, aspd: u.aspd,
          range: u.range, spd: u.spd, atkAt: 0, breaker: false,
          aoe: u.aoe ?? 0, armor: 0, hits: 0, skill: u.skill ?? null,
          slots: slotsOf(u), split: null,
        });
      }
    }

    // 4) 적 스폰
    for (const s of def.spawns) {
      if (t >= (spawnNext[s.id] ?? Infinity)) {
        const n = spawnedCount[s.id] ?? 0;
        // 예비대 — src/sim/core.ts 의 RESERVE_SHARE 와 1:1
        // 🔴 `ceil` 만 쓰면 cap 1~3 에서 onTime === cap 이 되어 **예비대가 0기**가 된다
        //    (12판은 웨이브 8개 중 4개가 여기 걸렸다 — 주석은 "뒤쪽 25%"라는데 실제론 안 걸렸다).
        //    cap 1(수문장)은 시간표대로 나와야 하므로 예외로 두고, 2 이상은 최소 1기를 남긴다.
        const onTime = s.cap <= 1 ? s.cap : Math.min(s.cap - 1, Math.ceil(s.cap * (1 - RESERVE_SHARE)));
        if (n >= onTime) {
          const progress = 1 - enCastle / def.castleHp;
          if (progress < RESERVE_COVER * (n - onTime + 1) / Math.max(1, s.cap - onTime)) {
            // 미루지 않는다 — src/sim/core.ts 와 동일(진행도를 넘긴 즉시 나와야 한다)
            continue;
          }
        }
        if (n < s.cap) {
          const e = ENEMY_BY_ID[s.id];
          // 돌파형 판정은 난수가 아니라 스폰 순번으로 균등 배분(src/sim/core.ts breakerRoll 과 동일)
          const share = TIER_BREAK[T];
          const roll = share > 0 && Math.floor((n + 1) * share) > Math.floor(n * share);
          units.push(makeEnemy(e, s.hpMul ?? 1, roll));
          spawnedCount[s.id] = n + 1;
          spawnLog.push({ id: s.id, t: Math.round(t * 30) / 30, p: 1 - enCastle / def.castleHp });
        }
        spawnNext[s.id] = t + s.every;
      }
    }

    // 5) 전투 / 이동 — 신바람은 아군에게만 걸린다(src/sim/core.ts 와 동일)
    // 🔴 전선 하한(enemyFloor). 이게 빠져 있으면 프로브의 **일반 적이 아군 전선을 통과**해
    //    실제 게임과 다르게 움직인다 — 즉 돌파형의 고유 능력이 프로브에선 전원에게 있는 셈이라
    //    G8 재미 게이트 수치가 게임 거동과 어긋난다. (표 값 parity 테스트로는 안 잡히는 행위 격차)
    let allyFront = -Infinity;
    for (const u of units) if (u.side === 1 && u.hp > 0) allyFront = Math.max(allyFront, u.x);
    const enemyFloor = allyFront === -Infinity ? 0 : Math.max(0, allyFront - 60);
    // 테스트가 **거동**을 검사할 수 있게 최대 전진 위치를 남긴다(상수만 대조하면 미러 누락을 못 잡는다)
    if (allyFront > maxAllyX) maxAllyX = allyFront;
    // 🔴 자리 사용량은 **소환 판정과 따로** 여기서 다시 센다. 같은 식을 재사용하면
    //    소환 판정이 마리 수로 갈라져도 이 값이 함께 갈라져 이탈이 안 보인다
    //    (실측: 판정만 마리 수로 바꿔 놓고 미러 테스트가 초록불이었다).
    {
      let s = 0;
      for (const u of units) if (u.side === 1 && u.hp > 0) s += u.slots;
      if (s > maxSlots) maxSlots = s;
    }

    const haste = hasteOf(hasteBoost);
    for (const u of units) {
      if (u.hp <= 0) continue;
      const hs = u.side === 1 ? haste : 1;
      let target = null, best = Infinity;
      if (!u.breaker) {
        for (const v of units) {
          if (v.side === u.side || v.hp <= 0) continue;
          const d = Math.abs(v.x - u.x);
          if (d <= u.range && d < best) { best = d; target = v; }
        }
      }
      const castleDist = u.side === 1 ? Math.abs(MAP_LEN - u.x) : Math.abs(u.x - 0);
      const atCeil = u.side === 1 && u.x >= ALLY_CEIL - 1e-6;
      if (!target && (castleDist <= u.range || atCeil)) {
        if (t >= u.atkAt) {
          // 성에도 특별기술 배율이 걸린다 — src/sim/core.ts 와 1:1
          const sw = swing(u);
          if (u.side === 1) enCastle -= sw.dmg; else myCastle -= sw.dmg;
          u.atkAt = t + u.aspd / hs;
        }
        continue;
      }
      if (target) {
        if (t >= u.atkAt) {
          const sw = swing(u);
          if (sw.aoe > 0) {
            let n = 0;
            for (const v of units) {
              if (v.side === u.side || v.hp <= 0) continue;
              if (Math.abs(v.x - target.x) <= sw.aoe) { hurt(v, sw.dmg); n++; }
            }
            if (n > 1) fired.aoeHits++;   // 둘 이상 맞아야 '광역이 실제로 일했다'
          } else hurt(target, sw.dmg);
          u.atkAt = t + u.aspd / hs;
        }
      } else if (u.spd > 0) {
        u.x += u.side * u.spd * hs * DT;
        // 돌파형에게는 전진 상한을 걸지 않는다 — 지나가는 것이 그 유닛의 존재 이유다
        if (u.side === -1 && !u.breaker) u.x = Math.max(enemyFloor, u.x);
        // 아군은 성문 앞 통로를 침범하지 않는다 — src/sim/core.ts 의 ALLY_CEIL 과 1:1
        if (u.side === 1) u.x = Math.min(ALLY_CEIL, u.x);
        u.x = Math.max(0, Math.min(MAP_LEN, u.x));
      }
    }

    // 6) 정리(분열 포함) / 승패 — src/sim/core.ts 의 cleanup 과 1:1
    const born = [];
    for (let i = units.length - 1; i >= 0; i--) {
      const u = units[i];
      if (u.hp > 0) continue;
      if (u.split && u.side === -1) {
        const child = ENEMY_BY_ID[u.split.id];
        if (child) {
          for (let k = 0; k < u.split.n; k++) {
            const dx = (k - (u.split.n - 1) / 2) * SPLIT_SPREAD;
            born.push(makeEnemy(child, 1, false, Math.max(0, Math.min(MAP_LEN, u.x + dx)), false));
            fired.splitBorn++;
          }
        }
      }
      units.splice(i, 1);
    }
    if (born.length) units.push(...born);
    if (enCastle <= 0) return { win: true, time: t, solved, correct, maxAllyX, maxAllies, maxSlots, fired, spawnLog, myCastleLeft: Math.max(0, myCastle / def.playerCastleHp) };
    if (myCastle <= 0) return { win: false, time: t, solved, correct, maxAllyX, maxAllies, maxSlots, fired, spawnLog, myCastleLeft: 0 };
    t += DT;
  }
  return { win: false, time: MAX_SEC, solved, correct, maxAllyX, maxAllies, maxSlots, fired, spawnLog, myCastleLeft: Math.max(0, myCastle / def.playerCastleHp), timeout: true };
}
