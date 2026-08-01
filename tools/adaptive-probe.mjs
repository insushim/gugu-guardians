#!/usr/bin/env node
/**
 * 적응 루프를 **끝까지 돌려** 아이별로 난이도가 어디에 안착하는지 본다.
 *
 * 단계별 표(tension-probe)는 "그 단계가 어떤가"만 보여 준다. 정작 중요한 건
 * **아이가 실제로 어느 단계에 머무르게 되는가**다 — 그게 그 아이가 겪는 게임이다.
 *
 *   node tools/adaptive-probe.mjs
 */
// 승강 규칙은 probe-model.mjs 의 nextTier 하나만 쓴다(사본 금지)
import { simulate, TIER_TARGET_P, MAX_TIER, nextTier } from './probe-model.mjs';

const pct = (x) => `${Math.round(x * 100)}%`;
/** 아이의 '실력' = 0단계에서 나오는 실현 정답률 */
const KIDS = [0.4, 0.6, 0.75, 0.85, 0.95];
const RUNS = 21;

console.log('\n=== 적응 루프 — 30판을 이어서 플레이한다 ===\n');
console.log('아이 실력\t머문 단계(평균/최빈)\t패배율\t성피격\t아슬아슬\t마지막 단계 분포');

for (const skill of KIDS) {
  const tierHist = [];
  let losses = 0, touched = 0, close = 0, matches = 0;
  const endTiers = [];

  for (let run = 1; run <= RUNS; run++) {
    let tier = 0, streak = 0;
    for (let st = 1; st <= 30; st++) {
      const r = simulate(st, skill, run * 31 + st, null, tier);
      const acc = r.solved > 0 ? r.correct / r.solved : 0;
      const m = { win: r.win, castleLeft: r.myCastleLeft, accuracy: acc };
      tierHist.push(tier);
      matches++;
      if (!r.win) losses++;
      if (r.myCastleLeft < 0.999) touched++;
      if (r.win && r.myCastleLeft < 0.5) close++;
      ({ tier, streak } = nextTier(tier, streak, m));
    }
    endTiers.push(tier);
  }

  const avg = tierHist.reduce((a, b) => a + b, 0) / tierHist.length;
  const counts = Array.from({ length: MAX_TIER + 1 }, (_, i) => tierHist.filter((t) => t === i).length);
  const mode = counts.indexOf(Math.max(...counts));
  const dist = Array.from({ length: MAX_TIER + 1 }, (_, i) => endTiers.filter((t) => t === i).length).join('/');
  console.log(
    `정답 ${pct(skill)}\t${avg.toFixed(1)} / ${mode}단계\t\t${pct(losses / matches)}\t${pct(touched / matches)}\t${pct(close / matches)}\t\t${dist}`,
  );
}

console.log('\n마지막 단계 분포 = 0단계/1단계/2단계/3단계/4단계 인원 수 (21명 기준)');
console.log(`단계별 문항 목표 정답률: ${TIER_TARGET_P.join(' / ')}`);
