/**
 * 밸런스 프로브 모델 — 유닛/스테이지/전투 시뮬레이션.
 *
 * 🔴 유닛 수치는 `data/roster.json` 에서 읽는다(src/sim/units.ts 와 같은 파일).
 * 🔴 스테이지 공식은 src/sim/stages.ts 와 **같은 값을 내야 한다.**
 *    Node 는 TS를 못 읽으므로 공식이 두 곳에 있는데, `tests/parity.spec.ts` 가
 *    1~80판의 실제 출력값을 통째로 대조한다(소스 문자열이 아니라 숫자를 비교한다).
 */
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
export const ROSTER = JSON.parse(readFileSync(`${ROOT}data/roster.json`, 'utf8'));

export const ALLIES = ROSTER.allies;
export const ENEMIES = ROSTER.enemies;
export const DECK_SIZE = ROSTER.deckSize;
export const ALLY_CAP = ROSTER.allyCap;
export const LEVEL_GAIN = ROSTER.levelGain;

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
const ENDLESS_STEP = 1.05;
const BOSSES = ['e_boss', 'e_boss2', 'e_boss3'];
const TYPE_ORDER = ['A1', 'S1', 'A2', 'M1', 'S2', 'AS1', 'M2', 'D1', 'AS2', 'M3', 'D2'];
export const REVIEW_WINDOW = 6;

const WAVES = [
  ['e_mul',    1,  3,  9.0,  4.0, 0.30],
  ['e_bat',    2, 14, 13.0,  5.5, 0.12],
  ['e_swarm',  3,  8,  8.0,  3.5, 0.10],
  ['e_arch',   4, 24, 20.0,  8.0, 0.12],
  ['e_rock',   6, 52, 36.0, 16.0, 0.14],
  ['e_zero',   7, 18, 10.0,  4.0, 0.08],
  ['e_knot',   9, 30, 22.0,  9.0, 0.12],
  ['e_minus', 12, 36, 26.0, 11.0, 0.10],
  ['e_shield',16, 60, 45.0, 22.0, 0.14],
];
const BOSS_SHARE = 0.5, BOSS_MOB_SHARE = 0.75, PER_WAVE_CAP = 40;
export const BUDGET_SLOPE = 0.10;
export const CASTLE_K = 25000;
/** 1판 적 **군대** 총 체력 기준값 — src/sim/stages.ts 의 BUDGET_K 와 1:1 */
export const BUDGET_K = 2340;
// 판 길이 램프 — src/sim/stages.ts 의 lengthRamp 와 1:1 (tests/parity.spec.ts 가 대조)
export const LEN_RAMP_END = 12;
export const LEN_RAMP_MIN = 0.50;
export const lengthRamp = (n) =>
  LEN_RAMP_MIN + (1 - LEN_RAMP_MIN) * Math.min(1, Math.max(0, (n - 1) / (LEN_RAMP_END - 1)));
export const REWARD_SLOPE_RATIO = 1.6;
const ENEMY_HP = Object.fromEntries(ENEMIES.map((e) => [e.id, e.hp]));

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

  const active = WAVES.filter(([, from]) => n >= from);
  const shareSum = active.reduce((s, w) => s + w[5], 0) || 1;
  const mobBudget = budget * (boss ? BOSS_MOB_SHARE : 1);

  const spawns = [];
  for (const [id, , t0, everyBase, everyMin, share] of active) {
    const hp = ENEMY_HP[id] ?? 200;
    spawns.push({
      id,
      t0,
      every: Math.max(everyMin, everyBase - (v * (everyBase - everyMin)) / VOLUME_CAP_STAGE),
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

// 먹 대포 — src/sim/economy.ts 와 1:1
export const CANNON_PER_CORRECT = 0.09, CANNON_KNOCKBACK = 90;
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
export const dps = (u) => u.atk / Math.max(0.1, u.aspd);
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
export function simulate(st, accuracy, seed = 1, roster = null) {
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
  // 그릇은 강화 0단계(새 아이) 기준으로 잰다 — 게이트는 가장 불리한 쪽을 통과해야 한다
  const cap = manaCap(0);
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

  const units = [];
  const cds = {};
  const spawnNext = {};
  def.spawns.forEach((s) => { spawnNext[s.id] = s.t0; });
  const spawnedCount = {};

  while (t < MAX_SEC) {
    // 1) 학습(문제) — 자원 공급의 주 경로
    if (t >= nextQuizAt) {
      solved++;
      const effAcc = Math.min(0.99, accuracy + ddaLevel * DDA_STEP_ACC);
      if (rng() < effAcc) {
        correct++;
        money = Math.min(cap, money + rewardBase(st) * comboMul(combo) * (1 - ddaLevel * DDA_REWARD_PENALTY));
        hasteBoost = Math.min(HASTE_MAX - 1, hasteBoost + HASTE_PER_CORRECT);
        cannon = Math.min(1, cannon + CANNON_PER_CORRECT);
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
    money = Math.min(cap, money + BASE_REGEN(st) * DT);
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
        const dmg = cannonDamage(enemyBudget(st)) * allyGrowth(st);
        for (const u of live) {
          u.hp -= dmg;
          if (u.spd > 0) u.x = Math.min(MAP_LEN, u.x + CANNON_KNOCKBACK);
        }
        enCastle -= def.castleHp * CANNON_CASTLE_SHARE;
      }
    }

    // 3) 아군 소환 — 살 수 있는 것 중 가장 비싼 것.
    //    "예비금 규칙": 고코스트를 사도 최저가 유닛 2기분은 남겨 전선이 비지 않게 한다.
    //    (이 규칙이 없으면 돈이 많을수록 물량이 끊겨 정답률↑인데 클리어가 느려지는 역전이 난다)
    if (deck.length) {
      const cheapest = Math.min(...deck.map((u) => u.cost));
      const reserve = cheapest * 2;
      const aliveAllies = units.reduce((n, u) => n + (u.side === 1 && u.hp > 0 ? 1 : 0), 0);
      const affordable = aliveAllies >= ALLY_CAP ? [] : deck
        .filter((u) => (cds[u.id] ?? 0) <= t)
        .filter((u) => money >= u.cost && (u.cost === cheapest || money - u.cost >= reserve))
        .sort((a, b) => b.cost - a.cost);
      if (affordable.length) {
        const u = affordable[0];
        const m = g * levelMult(lvOf(u.id));
        money -= u.cost;
        cds[u.id] = t + u.cd;
        units.push({ side: 1, id: u.id, x: 0, hp: u.hp * m, atk: u.atk * m, aspd: u.aspd, range: u.range, spd: u.spd, atkAt: 0 });
      }
    }

    // 4) 적 스폰
    for (const s of def.spawns) {
      if (t >= (spawnNext[s.id] ?? Infinity)) {
        const n = spawnedCount[s.id] ?? 0;
        if (n < s.cap) {
          const e = ENEMIES.find((x) => x.id === s.id);
          units.push({
            side: -1, id: e.id, x: e.spd === 0 ? MAP_LEN - 80 : MAP_LEN,
            hp: e.hp * def.mult * (s.hpMul ?? 1), atk: e.atk * def.mult, aspd: e.aspd, range: e.range, spd: e.spd, atkAt: 0,
          });
          spawnedCount[s.id] = n + 1;
        }
        spawnNext[s.id] = t + s.every;
      }
    }

    // 5) 전투 / 이동 — 신바람은 아군에게만 걸린다(src/sim/core.ts 와 동일)
    const haste = hasteOf(hasteBoost);
    for (const u of units) {
      if (u.hp <= 0) continue;
      const hs = u.side === 1 ? haste : 1;
      let target = null, best = Infinity;
      for (const v of units) {
        if (v.side === u.side || v.hp <= 0) continue;
        const d = Math.abs(v.x - u.x);
        if (d <= u.range && d < best) { best = d; target = v; }
      }
      const castleDist = u.side === 1 ? Math.abs(MAP_LEN - u.x) : Math.abs(u.x - 0);
      if (!target && castleDist <= u.range) {
        if (t >= u.atkAt) {
          if (u.side === 1) enCastle -= u.atk; else myCastle -= u.atk;
          u.atkAt = t + u.aspd / hs;
        }
        continue;
      }
      if (target) {
        if (t >= u.atkAt) { target.hp -= u.atk; u.atkAt = t + u.aspd / hs; }
      } else {
        u.x += u.side * u.spd * hs * DT;
        u.x = Math.max(0, Math.min(MAP_LEN, u.x));
      }
    }

    // 6) 정리 / 승패
    for (let i = units.length - 1; i >= 0; i--) if (units[i].hp <= 0) units.splice(i, 1);
    if (enCastle <= 0) return { win: true, time: t, solved, correct, myCastleLeft: Math.max(0, myCastle / def.playerCastleHp) };
    if (myCastle <= 0) return { win: false, time: t, solved, correct, myCastleLeft: 0 };
    t += DT;
  }
  return { win: false, time: MAX_SEC, solved, correct, myCastleLeft: Math.max(0, myCastle / def.playerCastleHp), timeout: true };
}
