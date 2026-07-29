#!/usr/bin/env node
/**
 * 밸런스 파라미터 스윕 — 게이트를 감으로 맞추지 않기 위한 탐색 도구.
 *
 * 무엇을 찾는가: 물량 예산 기울기(SLOPE)와 성 체력 계수(CASTLE_K)의 조합 중
 *   G1(고성취 세션 길이) · G2(정답60% 하드월 없음) 를 동시에 만족하는 지점.
 *
 * 결과는 사람이 보고 고르는 표다 — 자동으로 코드를 고치지 않는다.
 * 실행: node tools/tune-sweep.mjs
 */
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const R = JSON.parse(readFileSync(`${ROOT}data/roster.json`, 'utf8'));
const ALLIES = R.allies, ENEMIES = R.enemies;
const ENEMY_HP = Object.fromEntries(ENEMIES.map((e) => [e.id, e.hp]));
const DECK_SIZE = R.deckSize, ALLY_CAP = R.allyCap;

const DT = 0.1, MAP_LEN = 1000, MAX_SEC = 420, RNG_SEED = 20260728;
const CAMPAIGN = 30, CHAPTER_LEN = 10, ENDLESS_STEP = 1.05;
const BOSSES = ['e_boss', 'e_boss2', 'e_boss3'];
const WAVES = [
  ['e_mul', 1, 3, 9.0, 4.0, 0.30], ['e_bat', 2, 14, 13.0, 5.5, 0.12],
  ['e_swarm', 3, 8, 8.0, 3.5, 0.10], ['e_arch', 4, 24, 20.0, 8.0, 0.12],
  ['e_rock', 6, 52, 36.0, 16.0, 0.14], ['e_zero', 7, 18, 10.0, 4.0, 0.08],
  ['e_knot', 9, 30, 22.0, 9.0, 0.12], ['e_minus', 12, 36, 26.0, 11.0, 0.10],
  ['e_shield', 16, 60, 45.0, 22.0, 0.14],
];
const BOSS_SHARE = 0.5, BOSS_MOB_SHARE = 0.75, PER_WAVE_CAP = 40;

function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const growth = (n) => Math.pow(1.13, Math.min(n, CAMPAIGN) - 1);
const mult = (n) => growth(n) * Math.pow(ENDLESS_STEP, Math.max(0, n - CAMPAIGN));
const dps = (u) => u.atk / Math.max(0.1, u.aspd);
const power = (u) => dps(u) * Math.sqrt(u.hp);

function buildDeck(owned) {
  if (!owned.length) return [];
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

function stageDef(n, P) {
  const chapter = Math.floor((n - 1) / CHAPTER_LEN) + 1;
  const boss = ((n - 1) % CHAPTER_LEN) + 1 === CHAPTER_LEN;
  const v = Math.min(n, CAMPAIGN);
  const budget = 2340 * (1 + (v - 1) * P.slope);
  const active = WAVES.filter(([, f]) => n >= f);
  const shareSum = active.reduce((s, w) => s + w[5], 0) || 1;
  const mob = budget * (boss ? BOSS_MOB_SHARE : 1);
  const spawns = active.map(([id, , t0, eb, em, sh]) => ({
    id, t0,
    every: Math.max(em, eb - (v * (eb - em)) / CAMPAIGN),
    cap: Math.max(1, Math.min(PER_WAVE_CAP, Math.round((mob * (sh / shareSum)) / ENEMY_HP[id]))),
  }));
  if (boss) {
    const id = BOSSES[(chapter - 1) % BOSSES.length];
    spawns.push({ id, t0: 35, every: 9999, cap: 1, hpMul: (budget * BOSS_SHARE) / ENEMY_HP[id] });
  }
  return {
    spawns, mult: mult(n),
    castleHp: Math.round(P.castleK * growth(n) * (boss ? 0.7 : 1)),
    playerCastleHp: Math.round(3400 * growth(n)),
    boss,
  };
}

const tOk = (a) => 2.3 + (1 - a) * 2.4;
const tBad = (a) => tOk(a) + 1.6;
const comboMul = (c) => (c >= 8 ? 1.6 : c >= 5 ? 1.4 : c >= 3 ? 1.2 : 1.0);

function simulate(st, acc, seed, P) {
  const rng = makeRng(RNG_SEED + seed * 7919 + st * 1000);
  const def = stageDef(st, P);
  const g = growth(st);
  const deck = buildDeck(ALLIES.filter((u) => u.unlock >= 1 && u.unlock <= Math.min(st, CAMPAIGN)));
  let t = 0, money = 200, combo = 0, nextQuiz = 1.5, solved = 0;
  let ws = 0, rs = 0, dda = 0;
  let mine = def.playerCastleHp, foe = def.castleHp;
  const units = [], cds = {}, next = {}, count = {};
  def.spawns.forEach((s) => { next[s.id] = s.t0; });
  const regen = 5.8 + Math.min(1.6, (Math.min(st, 10) - 1) * 0.2);

  while (t < MAX_SEC) {
    if (t >= nextQuiz) {
      solved++;
      if (rng() < Math.min(0.99, acc + dda * 0.10)) {
        money += 46 * (1 + (Math.min(st, CAMPAIGN) - 1) * P.slope * P.ratio) * comboMul(combo) * (1 - dda * 0.30);
        combo++; ws = 0; rs++;
        if (rs >= 3 && dda > 0) { dda--; rs = 0; }
        nextQuiz = t + tOk(acc);
      } else {
        combo = 0; rs = 0; ws++;
        if (ws >= 2 && dda < 3) { dda++; ws = 0; }
        nextQuiz = t + tBad(acc);
      }
    }
    money += regen * DT;
    if (deck.length) {
      const cheap = Math.min(...deck.map((u) => u.cost));
      const alive = units.reduce((n, u) => n + (u.side === 1 && u.hp > 0 ? 1 : 0), 0);
      const ok = alive >= ALLY_CAP ? [] : deck
        .filter((u) => (cds[u.id] ?? 0) <= t)
        .filter((u) => money >= u.cost && (u.cost === cheap || money - u.cost >= cheap * 2))
        .sort((a, b) => b.cost - a.cost);
      if (ok.length) {
        const u = ok[0];
        money -= u.cost; cds[u.id] = t + u.cd;
        units.push({ side: 1, x: 0, hp: u.hp * g, atk: u.atk * g, aspd: u.aspd, range: u.range, spd: u.spd, atkAt: 0 });
      }
    }
    for (const s of def.spawns) {
      if (t >= (next[s.id] ?? Infinity)) {
        const n = count[s.id] ?? 0;
        if (n < s.cap) {
          const e = ENEMIES.find((x) => x.id === s.id);
          units.push({
            side: -1, x: e.spd === 0 ? MAP_LEN - 80 : MAP_LEN,
            hp: e.hp * def.mult * (s.hpMul ?? 1), atk: e.atk * def.mult,
            aspd: e.aspd, range: e.range, spd: e.spd, atkAt: 0,
          });
          count[s.id] = n + 1;
        }
        next[s.id] = t + s.every;
      }
    }
    for (const u of units) {
      if (u.hp <= 0) continue;
      let tg = null, best = Infinity;
      for (const v of units) {
        if (v.side === u.side || v.hp <= 0) continue;
        const d = Math.abs(v.x - u.x);
        if (d <= u.range && d < best) { best = d; tg = v; }
      }
      const cd = u.side === 1 ? Math.abs(MAP_LEN - u.x) : Math.abs(u.x);
      if (!tg && cd <= u.range) {
        if (t >= u.atkAt) { if (u.side === 1) foe -= u.atk; else mine -= u.atk; u.atkAt = t + u.aspd; }
        continue;
      }
      if (tg) { if (t >= u.atkAt) { tg.hp -= u.atk; u.atkAt = t + u.aspd; } }
      else { u.x = Math.max(0, Math.min(MAP_LEN, u.x + u.side * u.spd * DT)); }
    }
    for (let i = units.length - 1; i >= 0; i--) if (units[i].hp <= 0) units.splice(i, 1);
    if (foe <= 0) return { win: true, time: t, solved };
    if (mine <= 0) return { win: false, time: t, solved };
    t += DT;
  }
  return { win: false, time: MAX_SEC, solved };
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7];
const STAGES = [1, 3, 5, 8, 10, 14, 18, 22, 26, 28, 29, 30];
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : Infinity; };

function score(P) {
  let g2fail = 0, g1fail = 0; let worst60 = 1; const times95 = [];
  for (const st of STAGES) {
    const r60 = SEEDS.map((s) => simulate(st, 0.6, s, P));
    const w60 = r60.filter((r) => r.win).length / SEEDS.length;
    worst60 = Math.min(worst60, w60);
    if (w60 < 0.8) g2fail++;
    const r95 = SEEDS.map((s) => simulate(st, 0.95, s, P));
    const w95 = r95.filter((r) => r.win).length / SEEDS.length;
    const mt = median(r95.filter((r) => r.win).map((r) => r.time));
    times95.push(mt);
    const [lo, hi] = st <= 3 ? [55, 150] : [70, 240];
    if (w95 < 1 || mt < lo || mt > hi) g1fail++;
  }
  return { g1fail, g2fail, worst60, t95: times95 };
}

const CAND = [
  { slope: 0.06, castleK: 30000, ratio: 1.0 },
  { slope: 0.06, castleK: 30000, ratio: 1.3 },
  { slope: 0.10, castleK: 30000, ratio: 1.3 },
  { slope: 0.10, castleK: 30000, ratio: 1.6 },
];
const ACCS = [0.25, 0.4, 0.6, 0.8, 0.95];
for (const P of CAND) {
  console.log(`\n### slope=${P.slope} castleK=${P.castleK} 보상비율 ${P.ratio}`);
  console.log('ST\t' + ACCS.map((a) => `${Math.round(a*100)}%`).join('\t') + '\t95%문항');
  let g2 = 0, minQ = 999;
  for (const st of STAGES) {
    const row = [st];
    for (const a of ACCS) {
      const r = SEEDS.map((sd) => simulate(st, a, sd, P));
      const w = r.filter((x) => x.win).length / SEEDS.length;
      const mt = median(r.filter((x) => x.win).map((x) => x.time));
      row.push(w === 0 ? '패' : `${Math.round(w*100)}%/${Math.round(mt)}s`);
      if (a === 0.6 && w < 0.8) g2++;
    }
    const q = median(SEEDS.map((sd) => simulate(st, 0.95, sd, P).solved));
    minQ = Math.min(minQ, q);
    row.push(q + '문');
    console.log(row.join('\t'));
  }
  console.log(`  → G2 실패 ${g2}건 · 95% 최소 문항수 ${minQ}`);
}
