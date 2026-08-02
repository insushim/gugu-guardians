import { describe, it, expect } from 'vitest';
import { ALLY_CEIL_GAP, Battle, RESERVE_COVER, RESERVE_SHARE } from '../src/sim/core';
import { stageDef, MAP_LEN } from '../src/sim/stages';
// @ts-expect-error — 프로브 모델은 순수 JS다(Node 로 그대로 돌려야 해서 TS로 두지 않는다)
import * as probe from '../tools/probe-model.mjs';

/**
 * "적이 아예 안 나온다"의 두 원인을 고정한다. 실사용자가 두 번 보고한 증상이고,
 * 두 번 다 **렌더 문제로 오진했다.** 원인은 시뮬 쪽에 둘 있었다:
 *
 *  ① 성문 앞에 자리가 없다 — 적 스폰 지점(1000)과 근접 아군 정지선(962)이 화면상 23px.
 *     실측: 전선이 성에 닿은 뒤 나온 적 31/31기가 **한 픽셀도 못 움직이고** 평균 0.8초에 죽었다.
 *  ② 적 총량이 판 중간에 마른다 — 판은 시간이 아니라 **적 성 체력 0** 으로 끝나는데
 *     스폰은 시간표만 봤다. 실측: 12판 121초 중 마지막 65초(54%) 동안 스폰 0.
 */

/** 아군을 계속 밀어 넣으며 한 판을 끝까지 돌린다 */
function run(stage: number, steps = 13000): {
  b: Battle; maxAllyX: number; spawned: number; lastSpawn: number; end: number;
  movers: number; deaths: number;
} {
  const b = new Battle(stageDef(stage), {}, 6, 0);
  const born = new Map<number, number>();
  let t = 0, maxAllyX = 0, spawned = 0, lastSpawn = 0, movers = 0, deaths = 0;
  for (let i = 0; i < steps && b.status === 'playing'; i++) {
    b.money = 99999;
    for (const id of ['jipsin', 'kkachi', 'musoe']) b.summon(id);
    const before = new Map(b.units.filter((u) => u.side === -1).map((u) => [u.uid, u.x]));
    b.step(1 / 30);
    t += 1 / 30;
    if (b.events.some((e) => e.type === 'spawn')) {
      spawned += b.events.filter((e) => e.type === 'spawn').length;
      lastSpawn = t;
    }
    b.events.length = 0;   // 🔴 안 비우면 큐가 누적돼 매 프레임 스폰으로 잘못 읽힌다(실측으로 한 번 속았다)
    for (const u of b.units) {
      if (u.side === 1) maxAllyX = Math.max(maxAllyX, u.x);
      else if (!born.has(u.uid)) born.set(u.uid, u.x);
    }
    const alive = new Set(b.units.filter((u) => u.side === -1).map((u) => u.uid));
    for (const [uid, x] of before) {
      if (alive.has(uid) || !born.has(uid)) continue;
      deaths++;
      if (Math.abs(x - born.get(uid)!) >= 1) movers++;
    }
  }
  return { b, maxAllyX, spawned, lastSpawn, end: t, movers, deaths };
}

describe('성문 앞 통로 — 적이 나올 자리', () => {
  it('아군은 성문 앞 통로를 침범하지 않는다', () => {
    for (const st of [1, 5, 12, 20]) {
      const { maxAllyX } = run(st, 4000);
      expect(maxAllyX).toBeLessThanOrEqual(MAP_LEN - ALLY_CEIL_GAP + 1e-6);
    }
  });

  it('통로 끝에 선 아군은 사거리가 짧아도 적 성을 때린다 (안 그러면 판을 못 이긴다)', () => {
    // 🔴 이 단언이 없으면 통로를 넓히다 근접 셈지기가 성에 닿지 못하는 걸 놓친다.
    //    짚신이 사거리 38 < 통로 90 이라, atCeil 예외가 빠지면 이 판은 영원히 안 끝난다.
    const { b } = run(1, 6000);
    expect(b.status).toBe('win');
  });

  it('전선이 성에 닿은 뒤 나온 적도 실제로 움직인다', () => {
    // 예전엔 31/31기가 한 픽셀도 못 움직이고 아군 스프라이트에 파묻힌 채 죽었다
    for (const st of [1, 5, 12]) {
      const { movers, deaths } = run(st);
      expect(deaths).toBeGreaterThan(3);           // 관측이 실제로 일어났는지
      expect(movers / deaths).toBeGreaterThan(0.9);
    }
  });
});

describe('예비대 — 판이 끝날 때까지 적이 끊기지 않게', () => {
  it('총량은 늘지 않는다 (느릴수록 불리해지는 죽음의 나선 금지)', () => {
    // 🔴 stages.ts 가 명시한 설계 제약이다. 예비대는 **언제 나오는지만** 바꾼다.
    for (const st of [1, 5, 12, 20]) {
      const cap = stageDef(st).spawns.reduce((s, x) => s + x.cap, 0);
      expect(run(st).spawned).toBeLessThanOrEqual(cap);
    }
  });

  it('스폰이 판 중간에 말라붙지 않는다', () => {
    for (const st of [3, 5, 12, 20]) {
      const { lastSpawn, end } = run(st);
      // 🔴 이 하네스는 **비현실적으로 강한 플레이어**다(돈 무한 + 매 프레임 3기 소환).
      //    그래서 판이 실제(68~137초)보다 훨씬 길어지고, 마지막 적이 죽은 뒤 성을 깎는
      //    꼬리가 길게 남는다. 절대값이 아니라 **수정 전 대비**로 읽어야 하는 수치다.
      //    수정 전 같은 하네스: ST12 가 판의 54% 를 빈 화면으로 보냈다.
      expect((end - lastSpawn) / end).toBeLessThan(0.3);
    }
  });

  it('예비대 상수가 의미 있는 범위 안에 있다', () => {
    expect(RESERVE_SHARE).toBeGreaterThan(0);
    expect(RESERVE_SHARE).toBeLessThan(1);
    // 1.0 이면 마지막 예비대가 성이 무너지는 순간 나와 사실상 안 싸운다(실측: 게이트 3건 실패)
    expect(RESERVE_COVER).toBeLessThan(1);
    expect(RESERVE_COVER).toBeGreaterThan(0);   // 0 이하면 게이팅이 통째로 무력화된다
  });

  it('cap 이 작은 웨이브도 예비대를 갖는다 (수문장 cap=1 만 예외)', () => {
    // 🔴 `ceil` 만 쓰던 시절 cap 1~3 은 예비대가 0기였다 — 주석은 "뒤쪽 25%"라고 하는데
    //    12판 웨이브 8개 중 4개가 그 사각지대였다. 주석과 코드가 어긋난 상태였다.
    const onTimeOf = (cap: number) =>
      (cap <= 1 ? cap : Math.min(cap - 1, Math.ceil(cap * (1 - RESERVE_SHARE))));
    expect(onTimeOf(1)).toBe(1);                       // 수문장은 시간표대로
    for (const cap of [2, 3, 4, 5, 8, 12, 40]) {
      expect(cap - onTimeOf(cap)).toBeGreaterThanOrEqual(1);
    }
    // 실제 판의 웨이브에도 적용되는지 — 공식이 아니라 데이터로 확인한다.
    // cap=1 웨이브(수문장·비중 낮은 적)는 예비대가 없는 게 맞으므로 cap>=2 만 센다.
    let gated = 0, many = 0, single = 0;
    for (const st of [1, 5, 12, 20]) {
      for (const s of stageDef(st).spawns) {
        if (s.cap <= 1) { single++; continue; }
        many++;
        if (s.cap - onTimeOf(s.cap) >= 1) gated++;
      }
    }
    expect(many).toBeGreaterThan(8);      // 관측이 실제로 일어났는지
    expect(single).toBeGreaterThan(0);    // cap=1 예외도 실제로 존재하는지
    expect(gated).toBe(many);             // cap>=2 는 하나도 빠짐없이 예비대를 갖는다
  });
});

describe('프로브 미러', () => {
  it('통로·예비대 상수가 프로브와 같다', () => {
    expect(probe.ALLY_CEIL_GAP).toBe(ALLY_CEIL_GAP);
    expect(probe.RESERVE_SHARE).toBe(RESERVE_SHARE);
    expect(probe.RESERVE_COVER).toBe(RESERVE_COVER);
  });

  it('예비대 **거동**이 코어와 같다 — 상수 대조만으로는 못 잡는다', () => {
    // 🔴 표·상수만 대조하면 프로브에서 예비대 조건문을 통째로 지워도 통과한다(교차검증 지적).
    //    스폰이 **몇 기·언제** 나왔는지를 코어와 직접 대조한다.
    const roster = Object.fromEntries(probe.progressionAllies(12).map((u: { id: string }) => [u.id, 1]));
    const pr = probe.simulate(12, 0.85, 7, roster, 0);
    const log = pr.spawnLog as { id: string; t: number; p: number }[];
    const byId = new Map<string, number>();
    for (const e of log) byId.set(e.id, (byId.get(e.id) ?? 0) + 1);
    expect(log.length).toBeGreaterThan(5);          // 관측이 실제로 일어났는지

    // 🔴 개수만 보면 프로브에서 예비대 조건문을 **통째로 지워도 통과한다**(실측으로 확인).
    //    예비대의 본질은 "성이 깎인 뒤에도 적이 나온다"이므로 **스폰 시점의 성 진행도**를 본다.
    //    실측: 예비대 있음 → 최대 진행도 0.85 / 0.3 초과 스폰 7기, 없음 → 0.38 / 2기.
    const late = log.filter((e) => e.p > 0.3).length;
    expect(Math.max(...log.map((e) => e.p))).toBeGreaterThan(0.5);
    expect(late).toBeGreaterThan(3);

    // 코어에서 같은 판을 돌려 종류별 총량이 상한 안에 있고, 예비대가 실제로 뒤로 밀렸는지 본다
    const b = new Battle(stageDef(12), {}, 6, 0);
    const core = new Map<string, number>();
    let t = 0; let lateCore = 0, earlyCore = 0;
    for (let i = 0; i < 13000 && b.status === 'playing'; i++) {
      b.money = 99999;
      for (const id of ['jipsin', 'kkachi', 'musoe']) b.summon(id);
      const n0 = b.units.length;
      b.step(1 / 30); t += 1 / 30;
      for (let k = n0; k < b.units.length; k++) {
        const u = b.units[k]!;
        if (u.side !== -1) continue;
        core.set(u.defId, (core.get(u.defId) ?? 0) + 1);
        if (b.castleHp / b.stage.castleHp < 0.9) lateCore++; else earlyCore++;
      }
      b.events.length = 0;
    }
    for (const s of stageDef(12).spawns) {
      expect(core.get(s.id) ?? 0).toBeLessThanOrEqual(s.cap);   // 총량 상한
      expect(byId.get(s.id) ?? 0).toBeLessThanOrEqual(s.cap);   // 프로브도 같은 상한
    }
    // 예비대가 있다는 것 = 적 성이 깎인 뒤에도 새 적이 나온다는 것
    expect(earlyCore).toBeGreaterThan(0);
    expect(lateCore).toBeGreaterThan(0);
  });

  it('프로브에서도 아군이 통로를 침범하지 않는다 (값이 아니라 거동을 본다)', () => {
    // 🔴 상수만 대조하면 프로브가 그 상수를 **쓰지 않아도** 통과한다.
    // 🔴 호출 규약을 두 번 틀렸고 sanity 단언이 두 번 다 잡았다(maxAllyX===0):
    //    ① 첫 인자는 stageDef 가 아니라 **판 번호**다(probe-model.mjs:266).
    //    ② progressionAllies 는 인자가 **판 번호 하나**이고 유닛 배열을 준다 —
    //       simulate 의 roster 는 `{id: level}` 맵이라 배열을 넘기면 아군이 0기가 된다.
    const roster = Object.fromEntries(probe.progressionAllies(12).map((u: { id: string }) => [u.id, 1]));
    const r = probe.simulate(12, 0.85, 7, roster, 0);
    expect(r.maxAllyX).toBeLessThanOrEqual(MAP_LEN - ALLY_CEIL_GAP + 1e-6);
    expect(r.maxAllyX).toBeGreaterThan(0);   // 아군이 실제로 전진하긴 했는지
  });
});

describe('원거리 공격이 화면에 보이는가', () => {
  it('때린 자리뿐 아니라 **쏜 자리**도 이벤트에 실린다', () => {
    // 🔴 시뮬은 사거리 안이면 즉시 체력을 깎는다. 출발점이 없으면 렌더러가 날아가는 그림을
    //    그릴 수 없고, 사거리 250짜리 청룡이 뭘 하는지 화면에서 안 읽힌다(실사용자 보고).
    const b = new Battle(stageDef(12), { chorong: 4, cheongryong: 4, jipsin: 4 }, 6, 0);
    let ranged = 0, melee = 0;
    for (let i = 0; i < 4000; i++) {
      b.money = 99999;
      for (const id of ['chorong', 'cheongryong', 'jipsin']) b.summon(id);
      b.step(1 / 30);
      for (const e of b.events) {
        if (e.type !== 'hit') continue;
        expect(e.from).toBeTypeOf('number');       // 모든 타격이 출발점을 싣는다
        if (Math.abs(e.x - (e.from ?? 0)) >= 62) ranged++; else melee++;
      }
      b.events.length = 0;
    }
    expect(melee).toBeGreaterThan(0);              // 관측이 실제로 일어났는지
    expect(ranged).toBeGreaterThan(0);             // 원거리로 그려질 타격이 실제로 있는지
  });
});
