#!/usr/bin/env node
/**
 * "쉽다"가 아니라 **"긴장이 없다"** 를 재는 프로브.
 *
 * 승률만 보면 게이트는 통과인데 아이는 노잼이라고 한다. 승률은 결과고, 재미는 과정이다.
 * 그래서 과정을 잰다 — 우리 성이 실제로 맞는가, 아슬아슬한 판이 있는가.
 *
 *   node tools/tension-probe.mjs
 */
import { simulate } from './probe-model.mjs';

const SEEDS = Array.from({ length: 21 }, (_, i) => i + 1);
const TIER = Number(process.env['GUGU_TIER'] ?? 0);
const STAGES = [1, 3, 5, 8, 10, 15, 20, 25, 30];
const ACCS = [0.4, 0.6, 0.8, 0.95];

const pct = (x) => `${Math.round(x * 100)}%`;

console.log(`\n=== 긴장도 프로브 — 난이도 ${TIER}단계 ===\n`);
console.log('셀 = 승률 | 성이 맞은 판 비율 | 아슬아슬하게 이긴 판 비율\n');
console.log(['ST', ...ACCS.map((a) => `정답${pct(a)}`)].join('\t'));

/**
 * 🔴 **판 단위로 센다.** 처음엔 21판의 *중앙값* 성 체력을 봤는데, 결과가 0% 아니면 100%로
 *    갈리는 분포라 중앙값이 그 사이를 통째로 지웠다 — 어떤 배율에서도 "아슬아슬 0건"이
 *    나와서 손잡이가 안 듣는 것처럼 보였다. 요약통계가 분포를 가리면 실측이 아니다.
 */
const allRuns = [];
for (const st of STAGES) {
  const cells = ACCS.map((a) => {
    const runs = SEEDS.map((sd) => ({ ...simulate(st, a, sd, null, TIER), st, a }));
    allRuns.push(...runs);
    const win = runs.filter((r) => r.win).length / runs.length;
    const touched = runs.filter((r) => r.myCastleLeft < 0.999).length / runs.length;
    const closeN = runs.filter((r) => r.win && r.myCastleLeft < 0.5).length / runs.length;
    return { win, touched, closeN };
  });
  console.log([`${st}`, ...cells.map((c) => `${pct(c.win)} ${pct(c.touched)} ${pct(c.closeN)}`)].join('\t'));
}

const good = allRuns.filter((r) => r.a >= 0.8);
const gTouched = good.filter((r) => r.myCastleLeft < 0.999).length;
const gLost = good.filter((r) => !r.win).length;
/** 아슬아슬 = 이겼는데 우리 성이 절반 아래로 깎인 판. 이게 "재미있었다"의 대리 지표다. */
const gClose = good.filter((r) => r.win && r.myCastleLeft < 0.5).length;

console.log('\n=== 요약 (판 단위) ===');
console.log(`잘하는 아이(정답 80%·95%) ${good.length}판 중`);
console.log(`  · 우리 성이 한 대라도 맞은 판 : ${gTouched} (${pct(gTouched / good.length)})`);
console.log(`  · 진 판                      : ${gLost} (${pct(gLost / good.length)})`);
console.log(`  · 아슬아슬하게 이긴 판(성<50%): ${gClose} (${pct(gClose / good.length)})`);
for (const a of ACCS) {
  const rs = allRuns.filter((r) => r.a === a);
  const lost = rs.filter((r) => !r.win).length;
  const close = rs.filter((r) => r.win && r.myCastleLeft < 0.5).length;
  const touch = rs.filter((r) => r.myCastleLeft < 0.999).length;
  console.log(`  정답${pct(a)}: ${rs.length}판 · 패 ${pct(lost / rs.length)} · 성피격 ${pct(touch / rs.length)} · 아슬아슬 ${pct(close / rs.length)}`);
}
