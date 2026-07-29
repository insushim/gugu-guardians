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
export const CASTLE_K = 30000;
export const REWARD_SLOPE_RATIO = 1.6;
const ENEMY_HP = Object.fromEntries(ENEMIES.map((e) => [e.id, e.hp]));

/** 한 판에 나오는 적의 기준 총 체력(배율 적용 전) */
export function enemyBudget(index) {
  const v = Math.min(Math.max(1, index), VOLUME_CAP_STAGE);
  return 2340 * (1 + (v - 1) * BUDGET_SLOPE);
}

export const chapterOf = (n) => Math.floor((n - 1) / CHAPTER_LEN) + 1;
export const posOf = (n) => ((n - 1) % CHAPTER_LEN) + 1;
export const isBossStage = (n) => posOf(n) === CHAPTER_LEN;
export const allyGrowth = (n) => Math.pow(1.13, Math.min(n, CAMPAIGN_STAGES) - 1);
export const enemyMult = (n) => allyGrowth(n) * Math.pow(ENDLESS_STEP, Math.max(0, n - CAMPAIGN_STAGES));

export function quizTypesFor(n) {
  const open = TYPE_ORDER.slice(0, Math.min(TYPE_ORDER.length, 2 + Math.floor((n - 1) / 3)));
  const picks = [];
  const add = (t) => { if (t && !picks.includes(t)) picks.push(t); };
  add(open[open.length - 1]);
  add(open[(n * 3) % open.length]);
  add(open[(n * 7 + 2) % open.length]);
  for (let i = 0; i < open.length && picks.length < Math.min(3, open.length); i++) add(open[i]);
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
    castleHp: Math.round(CASTLE_K * growth * (boss ? 0.7 : 1)),
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

// DDA: 연속 오답 2회 → 1단계 하향(체감 정답률 +10%p), 대신 보상 -30%/단계
export const DDA_STEP_ACC = 0.10, DDA_MAX = 3, DDA_REWARD_PENALTY = 0.30;

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
  let money = START_MONEY;
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
        money += rewardBase(st) * comboMul(combo) * (1 - ddaLevel * DDA_REWARD_PENALTY);
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

    // 5) 전투 / 이동
    for (const u of units) {
      if (u.hp <= 0) continue;
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
    if (enCastle <= 0) return { win: true, time: t, solved, correct, myCastleLeft: Math.max(0, myCastle / def.playerCastleHp) };
    if (myCastle <= 0) return { win: false, time: t, solved, correct, myCastleLeft: 0 };
    t += DT;
  }
  return { win: false, time: MAX_SEC, solved, correct, myCastleLeft: Math.max(0, myCastle / def.playerCastleHp), timeout: true };
}
