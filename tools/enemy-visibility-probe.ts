/**
 * 적군이 "안 보이는" 원인을 좌표·생존시간으로 분해하는 일회성 계측기.
 *
 * 사용자 관찰: "아군이 성을 때리는데 적군이 안 보인다. 성 안에서 나오다 죽는 건가?"
 * 이 스크립트는 추측 대신 **적 한 마리 한 마리의 궤적**을 찍는다.
 *
 *   npx vite-node tools/enemy-visibility-probe.ts
 *
 * 재는 것:
 *  - 스폰 시각 / 사망 시각 / 생존 스텝 수
 *  - 살아있는 동안 도달한 최소 x (= 성에서 얼마나 걸어나왔나)
 *  - 화면에 그려질 프레임 수 (DT=1/30 이므로 생존 스텝 수와 같다)
 */
import { Battle } from '../src/sim/core';
import { stageDef, MAP_LEN } from '../src/sim/stages';
import { ALLIES } from '../src/sim/units';

const DT = 1 / 30;

type Track = { id: string; born: number; died: number | null; minX: number; steps: number };

function run(stageIndex: number, deck: string[]) {
  const stage = stageDef(stageIndex);
  const b = new Battle(stage);
  const tracks = new Map<number, Track>();
  const cds = new Map<string, number>();

  let steps = 0;
  while (b.status === 'playing' && b.t < 420) {
    // 사람처럼 논다: 3.2초마다 한 문제, 85% 정답
    if (steps % Math.round(3.2 / DT) === 0 && steps > 0) {
      b.answer(steps % 7 !== 0, 3200);
    }
    // 쿨다운 끝나고 셈력이 되면 소환 (예비비 없이 공격적으로 — 사용자 플레이와 유사)
    for (const id of deck) {
      const def = ALLIES.find((a) => a.id === id)!;
      if ((cds.get(id) ?? 0) <= b.t && b.money >= def.cost) {
        if (b.summon(id)) cds.set(id, b.t + def.cd);
      }
    }

    b.step(DT);
    steps++;

    // 생존 적 스냅샷
    const aliveNow = new Set<number>();
    for (const u of (b as unknown as { units: { uid: number; side: number; defId: string; x: number; hp: number }[] }).units) {
      if (u.side !== -1 || u.hp <= 0) continue;
      aliveNow.add(u.uid);
      const t = tracks.get(u.uid);
      if (!t) tracks.set(u.uid, { id: u.defId, born: b.t, died: null, minX: u.x, steps: 1 });
      else { t.minX = Math.min(t.minX, u.x); t.steps++; }
    }
    for (const [uid, t] of tracks) if (t.died === null && !aliveNow.has(uid)) t.died = b.t;
  }

  return { stage, b, tracks: [...tracks.values()], steps };
}

for (const st of [1, 3, 8]) {
  const deck = ['jipsin', 'kkachi', 'musoe'];
  const { b, tracks, steps } = run(st, deck);
  const dead = tracks.filter((t) => t.died !== null);
  const walked = tracks.filter((t) => t.minX < MAP_LEN - 1);
  const oneFrame = tracks.filter((t) => t.steps <= 2);

  console.log(`\n=== ST${st} · ${b.status} · t=${b.t.toFixed(0)}초 (${steps}스텝) ===`);
  console.log(`  스폰된 적 총 ${tracks.length}마리 / 죽은 적 ${dead.length}마리`);
  console.log(`  성에서 1px라도 걸어나온 적: ${walked.length}마리 (${((walked.length / Math.max(1, tracks.length)) * 100).toFixed(0)}%)`);
  console.log(`  2프레임 이하만 존재한 적: ${oneFrame.length}마리  ← 사실상 안 보임`);
  const lifes = tracks.map((t) => t.steps * DT).sort((a, b) => a - b);
  if (lifes.length) {
    const q = (p: number) => lifes[Math.min(lifes.length - 1, Math.floor(lifes.length * p))]!.toFixed(2);
    console.log(`  생존시간 중앙 ${q(0.5)}초 (최소 ${q(0)} / 최대 ${q(0.99)})`);
    const adv = tracks.map((t) => MAP_LEN - t.minX).sort((a, b) => a - b);
    const qa = (p: number) => adv[Math.min(adv.length - 1, Math.floor(adv.length * p))]!.toFixed(0);
    console.log(`  성에서 나온 거리 중앙 ${qa(0.5)}px / 최대 ${qa(0.99)}px  (맵 전체 ${MAP_LEN}px)`);
  }
  console.log('  --- 처음 6마리 ---');
  for (const t of tracks.slice(0, 6)) {
    console.log(`   ${t.id.padEnd(10)} 등장 ${t.born.toFixed(1)}초  생존 ${(t.steps * DT).toFixed(2)}초(${t.steps}프레임)  최전진 x=${t.minX.toFixed(0)} (성에서 ${(MAP_LEN - t.minX).toFixed(0)}px)`);
  }
}
