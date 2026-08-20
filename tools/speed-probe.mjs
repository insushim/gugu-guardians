#!/usr/bin/env node
/**
 * 구구성 수호대 — **응답 속도(pace) 프로브**
 *
 * 🔴 왜 만들었나: 기존 밸런스 프로브는 실력을 **정답률 하나**로만 모델링했다.
 *    그런데 셈력(자원)은 정답에서 나오므로 이 게임에서 실력은 두 축이다 —
 *    **얼마나 맞히나(정답률)** 와 **얼마나 빨리 맞히나(속도)**.
 *    probe-model 의 응답 시간은 `tOk(acc) = 2.3 + (1-acc)*2.4` 라서
 *    **가장 빠른 플레이어조차 문항당 2.3초**였다. 어른(선생님)은 구구단을 0.8~1.2초에 답한다.
 *    즉 실사용자의 절반은 게이트가 **한 번도 본 적 없는 구간**에 있었고,
 *    "정답 95% 아이도 40% 진다"는 초록불이 실제 체감("너무 쉽다")과 어긋난 이유가 여기다.
 *
 * pace = 응답 시간 배율. 1.0 = 기존 모델(2.3~2.4초), 0.42 ≈ 1.0초(숙달한 어른).
 *
 * 실행: node tools/speed-probe.mjs
 */
import {
  simulate, nextTier, CAMPAIGN_STAGES, MAX_TIER, ALLIES, progressionAllies, tOk,
} from './probe-model.mjs';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

/** 사람 유형 — pace 는 문항당 실제 초로 환산해 같이 보여 준다(감이 잡히게) */
const PACES = [
  ['느린 아이   ', 1.30],
  ['보통 아이   ', 1.00],
  ['빠른 아이   ', 0.70],
  ['숙달 아동   ', 0.55],
  ['어른(선생님)', 0.42],
];

const pct = (x) => `${Math.round(x * 100)}%`;

/** 적응 루프 — balance-probe 의 G8 과 같은 규칙, pace 만 추가 */
function playAdaptive(skill, pace, stages = CAMPAIGN_STAGES) {
  let lost = 0, touched = 0, n = 0, tierSum = 0, tierMax = 0;
  for (const seed of SEEDS) {
    let tier = 0, streak = 0;
    for (let st = 1; st <= stages; st++) {
      const r = simulate(st, skill, seed * 31 + st, null, tier, {}, pace);
      tierSum += tier; n++;
      if (tier > tierMax) tierMax = tier;
      if (!r.win) lost++;
      if (r.myCastleLeft < 0.999) touched++;
      ({ tier, streak } = nextTier(tier, streak, {
        win: r.win, castleLeft: r.myCastleLeft,
        accuracy: r.solved > 0 ? r.correct / r.solved : 0,
        paceMs: r.paceMs,
      }));
    }
  }
  return { lost: lost / n, touched: touched / n, tier: tierSum / n, tierMax };
}

console.log(`\n=== 응답 속도 프로브 (시드 ${SEEDS.length} · 캠페인 ${CAMPAIGN_STAGES}판 적응 루프) ===`);
console.log(`현재 MAX_TIER = ${MAX_TIER}\n`);

console.log('── 정답률 95% 고정, 속도만 바꿨을 때 ──');
console.log('사람\t\t문항당\t머문 단계\t최고 단계\t패배율\t성 피격률');
for (const [label, pace] of PACES) {
  const r = playAdaptive(0.95, pace);
  const sec = (tOk(0.95) * pace).toFixed(1);
  console.log(`${label}\t${sec}s\t${r.tier.toFixed(1)}\t\t${r.tierMax}\t\t${pct(r.lost)}\t${pct(r.touched)}`);
}

console.log('\n── 정답률 85% 고정, 속도만 바꿨을 때 ──');
console.log('사람\t\t문항당\t머문 단계\t최고 단계\t패배율\t성 피격률');
for (const [label, pace] of PACES) {
  const r = playAdaptive(0.85, pace);
  const sec = (tOk(0.85) * pace).toFixed(1);
  console.log(`${label}\t${sec}s\t${r.tier.toFixed(1)}\t\t${r.tierMax}\t\t${pct(r.lost)}\t${pct(r.touched)}`);
}

/** 천장 검사 — 최고 단계에 **고정**해 놓고도 이기는가 */
console.log(`\n── 천장 검사: 단계를 MAX_TIER(${MAX_TIER})에 고정하고 캠페인 전 구간 ──`);
console.log('사람\t\t정답95% 승률\t정답85% 승률');
const CEIL_STAGES = [5, 10, 20, 30];
for (const [label, pace] of PACES) {
  const rate = (acc) => {
    let w = 0, n = 0;
    for (const st of CEIL_STAGES) {
      for (const sd of SEEDS) {
        n++;
        if (simulate(st, acc, sd * 13 + st, null, MAX_TIER, {}, pace).win) w++;
      }
    }
    return w / n;
  };
  console.log(`${label}\t${pct(rate(0.95))}\t\t${pct(rate(0.85))}`);
}

/** 무한 구간 — 최고 단계 + 전설 로스터로 어디까지 가나 */
console.log(`\n── 무한 구간 도달 한계(단계 MAX_TIER 고정 · 전설 로스터 승급 10) ──`);
const legend = Object.fromEntries(ALLIES.map((u) => [u.id, u.rarity === 'legend' ? 10 : 6]));
console.log('사람\t\t' + [40, 60, 80, 100, 120].map((s) => `ST${s}`).join('\t'));
for (const [label, pace] of PACES) {
  const row = [40, 60, 80, 100, 120].map((st) => {
    const w = SEEDS.filter((sd) => simulate(st, 0.95, sd * 17 + st, legend, MAX_TIER, {}, pace).win).length;
    return pct(w / SEEDS.length);
  });
  console.log(`${label}\t` + row.join('\t'));
}

console.log('\n※ 판정 기준: 어른(선생님) 줄의 패배율이 10% 미만이거나 천장 승률이 90% 이상이면');
console.log('   "빠른 풀이자에게는 난이도 천장이 존재하지 않는다"는 뜻이다.\n');
console.log(`(참고) 진도 로스터 종수 ST30 = ${progressionAllies(CAMPAIGN_STAGES).length}종\n`);
