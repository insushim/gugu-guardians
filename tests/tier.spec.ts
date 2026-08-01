import { describe, it, expect } from 'vitest';
import {
  MAX_TIER, EASY_STREAK_TO_RAISE, nextTier, tierAoe, tierAtk, tierBreakShare, tierTargetP,
} from '../src/sim/tier';
import { Battle } from '../src/sim/core';
import { stageDef } from '../src/sim/stages';
import { ENEMY_BY_ID } from '../src/sim/units';
import { normalize } from '../src/save/schema';
// @ts-expect-error — 프로브 모델은 순수 JS다(Node 로 그대로 돌려야 해서 TS로 두지 않는다)
import * as probe from '../tools/probe-model.mjs';

/**
 * 적응형 전투 난이도의 계약을 고정한다.
 *
 * 🔴 **가장 중요한 것은 첫 블록이다: 0단계 = 종전 밸런스.**
 *    "정답 60% 아이가 소환 없이 캠페인을 통과한다"(G2)는 밸런스 프로브가 **0단계로** 검사한다.
 *    어려워하는 아이는 0단계를 벗어나지 못하므로(적응 루프는 이긴 아이만 올린다),
 *    0단계가 종전과 같기만 하면 안전망은 *설계상* 보장된다.
 *    0단계에 조미료가 하나라도 새어 들어가면 그 보장이 조용히 무너진다.
 */

describe('0단계 = 안전망 기준선', () => {
  it('0단계는 아무 조미료도 없다', () => {
    expect(tierAtk(0)).toBe(1);
    expect(tierBreakShare(0)).toBe(0);
    expect(tierAoe(0)).toBe(0);
    expect(tierTargetP(0)).toBe(0.85);   // 종전 고정값
  });

  it('0단계 전투에는 돌파형도 광역도 등장하지 않는다', () => {
    const b = new Battle(stageDef(12), {}, 0, 0);
    for (let i = 0; i < 3000; i++) b.step(1 / 30);
    // 죽은 적도 있으므로 스폰된 전체를 보기 위해 이벤트가 아니라 살아있는 유닛 + 재실행으로 확인
    const seen = new Battle(stageDef(12), {}, 0, 0);
    let sawEnemy = false;
    for (let i = 0; i < 900; i++) {
      seen.step(1 / 30);
      for (const u of seen.units) {
        if (u.side !== -1) continue;
        sawEnemy = true;
        expect(u.breaker).toBeFalsy();
        expect(u.aoe ?? 0).toBe(0);
      }
    }
    expect(sawEnemy).toBe(true);
  });

  it('새 저장은 0단계에서 시작한다', () => {
    const s = normalize({});
    expect(s.challenge.tier).toBe(0);
    expect(s.challenge.streak).toBe(0);
  });

  it('난이도 필드가 없는 옛 저장도 0단계로 열린다 (기존 아이를 갑자기 어렵게 만들지 않는다)', () => {
    // 저장 파일은 { version, data } 봉투다 — 봉투를 빠뜨리면 정규화가 전부 기본값을 돌려준다
    const old = normalize({
      version: 3,
      data: { progress: { maxStage: 12, cleared: { '12': 3 } }, currency: { meokmul: 500 } },
    });
    expect(old.challenge.tier).toBe(0);
    expect(old.progress.maxStage).toBe(12);        // 기존 기록은 보존
    expect(old.currency.meokmul).toBe(500);
  });
});

describe('단계 표', () => {
  it('모든 표가 MAX_TIER 까지 정의돼 있다', () => {
    for (let t = 0; t <= MAX_TIER; t++) {
      expect(Number.isFinite(tierAtk(t))).toBe(true);
      expect(Number.isFinite(tierBreakShare(t))).toBe(true);
      expect(Number.isFinite(tierAoe(t))).toBe(true);
      expect(Number.isFinite(tierTargetP(t))).toBe(true);
    }
  });

  it('단계가 오르면 단조롭게 어려워진다 (뒤집힘 없음)', () => {
    for (let t = 1; t <= MAX_TIER; t++) {
      expect(tierAtk(t)).toBeGreaterThan(tierAtk(t - 1));
      expect(tierBreakShare(t)).toBeGreaterThanOrEqual(tierBreakShare(t - 1));
      expect(tierAoe(t)).toBeGreaterThanOrEqual(tierAoe(t - 1));
      expect(tierTargetP(t)).toBeLessThanOrEqual(tierTargetP(t - 1));
    }
  });

  it('목표 정답률이 저학년에게 가혹한 수준으로 내려가지 않는다', () => {
    // 열 문제 중 셋을 틀리기 시작하면 어린아이에게는 벌처럼 느껴진다
    expect(tierTargetP(MAX_TIER)).toBeGreaterThanOrEqual(0.7);
  });

  it('범위를 벗어난 값은 안전하게 잘린다', () => {
    expect(tierAtk(-5)).toBe(tierAtk(0));
    expect(tierAtk(999)).toBe(tierAtk(MAX_TIER));
    expect(tierAtk(Number.NaN)).toBe(tierAtk(0));
  });

  it('Battle 이 들고 있는 단계 값 자체도 잘린다 (NaN 누수 금지)', () => {
    // 🔴 `Math.max(0, Math.min(N, Math.floor(NaN)))` 는 0 이 아니라 NaN 이다.
    //    Battle 이 자체 클램프를 쓰다 실제로 NaN 을 들고 있었다 — 결과 화면의
    //    `nextTier !== tier` 비교가 항상 참이 되어 안 바뀐 판에도 안내가 뜬다.
    expect(new Battle(stageDef(1), {}, 0, Number.NaN).tier).toBe(0);
    expect(new Battle(stageDef(1), {}, 0, -3).tier).toBe(0);
    expect(new Battle(stageDef(1), {}, 0, 99).tier).toBe(MAX_TIER);
    expect(new Battle(stageDef(1), {}, 0, 1.7).tier).toBe(1);
  });

  it('문제를 하나도 안 푼 판은 승격 근거가 되지 않는다', () => {
    const b = new Battle(stageDef(1), {}, 0, 3);
    expect(b.outcome.accuracy).toBe(0);
    expect(b.outcome.win).toBe(false);
    expect(nextTier(3, 1, b.outcome).tier).toBe(2);   // 이기지 못했으니 내려간다
  });
});

describe('단계 조정 규칙 — 올릴 땐 천천히, 내릴 땐 즉시', () => {
  const easy = { win: true, castleLeft: 1, accuracy: 0.9 };
  const narrow = { win: true, castleLeft: 0.4, accuracy: 0.9 };
  const loss = { win: false, castleLeft: 0, accuracy: 0.9 };

  it(`여유롭게 ${EASY_STREAK_TO_RAISE}판을 이겨야 한 단계 오른다`, () => {
    let s = { tier: 0, streak: 0 };
    for (let i = 1; i < EASY_STREAK_TO_RAISE; i++) {
      s = nextTier(s.tier, s.streak, easy);
      expect(s.tier).toBe(0);
    }
    s = nextTier(s.tier, s.streak, easy);
    expect(s.tier).toBe(1);
    expect(s.streak).toBe(0);
  });

  it('한 판만 져도 바로 내려간다 (막힌 아이를 붙잡아 두지 않는다)', () => {
    expect(nextTier(4, 1, loss)).toEqual({ tier: 3, streak: 0 });
  });

  it('아슬아슬하게 이기면 그 단계에 머문다 — 딱 맞는 난이도다', () => {
    expect(nextTier(3, 1, narrow)).toEqual({ tier: 3, streak: 0 });
  });

  it('정답률이 낮으면 이겨도 올리지 않는다 (전투만 쉬웠던 판)', () => {
    expect(nextTier(2, 1, { win: true, castleLeft: 1, accuracy: 0.5 }).tier).toBe(2);
  });

  it('0단계 아래로도, MAX_TIER 위로도 안 간다', () => {
    expect(nextTier(0, 0, loss).tier).toBe(0);
    let s = { tier: MAX_TIER, streak: EASY_STREAK_TO_RAISE - 1 };
    s = nextTier(s.tier, s.streak, easy);
    expect(s.tier).toBe(MAX_TIER);
  });
});

describe('돌파형·광역이 실제로 동작한다', () => {
  it('높은 단계에서는 돌파형이 등장한다', () => {
    const b = new Battle(stageDef(12), {}, 0, MAX_TIER);
    let breakers = 0;
    const seen = new Set<number>();
    for (let i = 0; i < 900; i++) {
      b.step(1 / 30);
      for (const u of b.units) {
        if (u.side === -1 && u.breaker && !seen.has(u.uid)) { seen.add(u.uid); breakers++; }
      }
    }
    expect(breakers).toBeGreaterThan(0);
  });

  it('돌파형은 아군 전선을 **지나쳐** 우리 성 쪽으로 간다', () => {
    // 🔴 아군을 세우지 않으면 allyFront 가 -Infinity 라 '전선을 넘었다'를 **관측할 수 없다**.
    //    (처음에 이걸 빼먹어 테스트가 기능이 아니라 자기 설정을 재고 있었다.)
    const b = new Battle(stageDef(12), {}, 6, MAX_TIER);
    let passed = false;
    for (let i = 0; i < 9000 && !passed; i++) {
      b.money = 99999;
      for (const id of ['jipsin', 'kkachi', 'musoe']) b.summon(id);
      b.step(1 / 30);
      let allyFront = -Infinity;
      for (const u of b.units) if (u.side === 1 && u.hp > 0) allyFront = Math.max(allyFront, u.x);
      if (allyFront === -Infinity) continue;
      for (const u of b.units) {
        // 일반 적은 allyFront-60 아래로 못 간다. 돌파형만 그 선을 넘을 수 있다.
        if (u.side === -1 && u.hp > 0 && u.breaker && u.x < allyFront - 60) passed = true;
      }
    }
    expect(passed).toBe(true);
  });

  it('0단계에서는 어떤 적도 아군 전선을 넘지 못한다 (돌파형이 없으므로)', () => {
    const b = new Battle(stageDef(12), {}, 6, 0);
    let sawAlly = false;
    for (let i = 0; i < 9000; i++) {
      b.money = 99999;
      for (const id of ['jipsin', 'kkachi', 'musoe']) b.summon(id);
      b.step(1 / 30);
      let allyFront = -Infinity;
      for (const u of b.units) if (u.side === 1 && u.hp > 0) allyFront = Math.max(allyFront, u.x);
      if (allyFront === -Infinity) continue;
      sawAlly = true;
      for (const u of b.units) {
        if (u.side === -1 && u.hp > 0) expect(u.x).toBeGreaterThanOrEqual(allyFront - 60 - 1e-6);
      }
    }
    expect(sawAlly).toBe(true);   // 관측이 실제로 일어났는지 확인 — 빈 검사 방지
  });

  it('광역 공격은 한 번에 여러 아군을 때린다', () => {
    const b = new Battle(stageDef(20), {}, 0, MAX_TIER);
    // 같은 자리에 아군 여럿을 세우고, 광역 적을 그 옆에 놓는다
    for (let i = 0; i < 4; i++) {
      b.units.push({
        uid: 900 + i, side: 1, defId: 'jipsin', x: 500, hp: 1000, maxHp: 1000,
        atk: 1, aspd: 99, range: 40, spd: 0, atkAt: 999, hurtAt: -99, swingAt: -99,
      });
    }
    b.units.push({
      uid: 800, side: -1, defId: 'e_rock', x: 520, hp: 9e9, maxHp: 9e9,
      atk: 50, aspd: 0.1, range: 60, spd: 0, atkAt: 0, hurtAt: -99, swingAt: -99,
      aoe: tierAoe(MAX_TIER),
    });
    b.step(1 / 30);
    const hurt = b.units.filter((u) => u.side === 1 && u.hp < 1000).length;
    expect(hurt).toBeGreaterThan(1);
  });

  it('돌파형은 고정형(수문장·보스)에는 걸리지 않는다 — 자리를 지키는 게 역할이다', () => {
    // 🔴 이 테스트는 두 번 헛돌았다. 남겨 두는 이유가 곧 설명이다.
    //    ① 아군을 안 세우면 성이 t=25.9초에 무너지는데 보스 스폰은 t=35초라
    //       고정형이 아예 등장하지 않는다(실측 관측 0회) → 안쪽 단언 미실행.
    //    ② 아군을 세워 등장시켜도, 보스는 자기 스폰 ID의 0번이고 Bresenham 은
    //       비율<1 에서 0번을 절대 고르지 않는다 → `e.spd > 0` 가드를 **지워도** 통과한다.
    //    그래서 가드가 유일한 방어선이 되는 판을 직접 만든다: 고정형 cap 을 늘려
    //    1번 순번(= 비율 0.7 에서 반드시 뽑히는 자리)을 실제로 발생시킨다.
    const base = stageDef(20);                                  // 20판 = 보스 판
    const spawns = base.spawns.map((s) => (
      (ENEMY_BY_ID.get(s.id)?.spd ?? 1) === 0 ? { ...s, every: 3, cap: 4 } : s
    ));
    const fixedIds = spawns.filter((s) => (ENEMY_BY_ID.get(s.id)?.spd ?? 1) === 0);
    expect(fixedIds.length).toBeGreaterThan(0);                 // 고정형이 실제로 있는 판인지
    expect(tierBreakShare(MAX_TIER)).toBeGreaterThan(0.5);      // 1번 순번이 뽑히는 비율인지

    const b = new Battle({ ...base, spawns }, {}, 6, MAX_TIER);
    let sawFixed = 0;
    for (let i = 0; i < 9000; i++) {
      b.money = 99999;
      for (const id of ['jipsin', 'kkachi', 'musoe']) b.summon(id);
      b.step(1 / 30);
      for (const u of b.units) {
        if (u.side !== -1 || u.spd !== 0) continue;
        sawFixed++;
        expect(u.breaker).toBeFalsy();
      }
    }
    expect(sawFixed).toBeGreaterThan(0);   // 관측이 실제로 일어났는지 — 빈 검사 방지
  });
});

describe('프로브 모델과 단계 표가 일치한다', () => {
  it('TS 와 프로브의 단계 표가 같은 값이다', () => {
    expect(probe.MAX_TIER).toBe(MAX_TIER);
    for (let t = 0; t <= MAX_TIER; t++) {
      expect(probe.TIER_ATK[t]).toBeCloseTo(tierAtk(t), 10);
      expect(probe.TIER_BREAK[t]).toBeCloseTo(tierBreakShare(t), 10);
      expect(probe.TIER_AOE[t]).toBeCloseTo(tierAoe(t), 10);
      expect(probe.TIER_TARGET_P[t]).toBeCloseTo(tierTargetP(t), 10);
    }
  });

  it('승강 **규칙**도 같다 — 표만 대조하면 규칙이 갈라져도 못 잡는다', () => {
    // 🔴 표 값만 맞춰 두면 `nextTier` 의 임계값(0.85 / 0.7)이나 연승 조건이 갈라져도
    //    parity 가 초록불이다. 그 상태로 G8 재미 게이트가 구버전 규칙으로 돌면,
    //    "안전망이 지켜진다"는 게이트의 결론 자체가 근거를 잃는다. 그래서 **출력**을 대조한다.
    expect(probe.EASY_STREAK_TO_RAISE).toBe(EASY_STREAK_TO_RAISE);
    let cases = 0;
    for (let t = -1; t <= MAX_TIER + 1; t++) {
      for (const streak of [0, 1, 2]) {
        for (const win of [true, false]) {
          for (const castleLeft of [0, 0.5, 0.84, 0.85, 0.86, 1]) {
            for (const accuracy of [0, 0.5, 0.69, 0.7, 0.71, 1]) {
              const m = { win, castleLeft, accuracy };
              expect(probe.nextTier(t, streak, m)).toEqual(nextTier(t, streak, m));
              cases++;
            }
          }
        }
      }
    }
    expect(cases).toBe(11 * 3 * 2 * 6 * 6);   // 격자가 실제로 다 돌았는지
  });
});
