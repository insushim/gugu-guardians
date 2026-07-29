import { describe, it, expect } from 'vitest';
import { ALLIES, ENEMIES, DECK_SIZE, ALLY_CAP, defaultDeck, progressionAllies, RARITIES } from '../src/sim/units';
import { stageDef, allyGrowth, enemyMult, enemyBudget, quizTypesFor, MAX_SEC, MAP_LEN, CAMPAIGN_STAGES } from '../src/sim/stages';
import { REWARD, START_MONEY, baseRegen, comboMul, rewardBase, DDA_MAX, DDA_REWARD_PENALTY, DDA_WRONG_TRIGGER } from '../src/sim/economy';
import { manaCap, MANA_CAP_BASE, MANA_CAP_MAX_LV, hasteOf, HASTE_MAX, HASTE_PER_CORRECT, HASTE_DECAY, cannonDamage, CANNON_PER_CORRECT, CANNON_KNOCKBACK } from '../src/sim/economy';
import { lengthRamp } from '../src/sim/stages';
// @ts-expect-error — 프로브 모델은 순수 JS다(Node 로 그대로 돌려야 해서 TS로 두지 않는다)
import * as probe from '../tools/probe-model.mjs';

/**
 * 🔴 게임 코드와 밸런스 프로브가 어긋나면 "실측 검증됨" 표가 통째로 무효가 된다.
 *    (v1에서 실제로 일어났다: 프로브가 덱 5기 제한을 구현하지 않은 채 표를 만들었다.)
 *
 * v2에서 유닛 수치는 `data/roster.json` 하나로 합쳤으므로 베껴쓰기 드리프트가 구조적으로 없다.
 * 남은 위험은 **스테이지 공식**이다 — Node 가 TS를 못 읽어 두 벌로 존재한다.
 * 그래서 소스 문자열이 아니라 **1~80판의 실제 출력값 전체**를 대조한다.
 */

describe('로스터 단일 진실원', () => {
  it('프로브와 게임이 같은 파일을 읽는다', () => {
    expect(probe.ALLIES).toEqual(ALLIES);
    expect(probe.ENEMIES).toEqual(ENEMIES);
    expect(probe.DECK_SIZE).toBe(DECK_SIZE);
    expect(probe.ALLY_CAP).toBe(ALLY_CAP);
  });

  it('등급은 5종이고 가중치 합이 1000이다(확률 공시가 % 로 딱 떨어져야 한다)', () => {
    expect(RARITIES).toHaveLength(5);
    expect(RARITIES.reduce((s, r) => s + r.weight, 0)).toBe(1000);
  });

  it('모든 등급에 유닛이 최소 1종 있다 — 없으면 소환이 예외를 던진다', () => {
    for (const r of RARITIES) {
      expect(ALLIES.filter((u) => u.rarity === r.id).length, `${r.name} 등급이 비었다`).toBeGreaterThan(0);
    }
  });

  it('스폰 표의 적 id 가 전부 실재한다', () => {
    const ids = new Set(ENEMIES.map((e) => e.id));
    for (let n = 1; n <= 60; n++) {
      for (const s of stageDef(n).spawns) expect(ids.has(s.id), `${n}판의 ${s.id}`).toBe(true);
    }
  });
});

describe('스테이지 공식 대조 (TS ↔ 프로브)', () => {
  it('1~80판의 모든 값이 일치한다', () => {
    for (let n = 1; n <= 80; n++) {
      const a = stageDef(n);
      const b = probe.stageDef(n);
      expect(a.mult, `${n}판 mult`).toBeCloseTo(b.mult, 9);
      expect(a.castleHp, `${n}판 적 성`).toBe(b.castleHp);
      expect(a.playerCastleHp, `${n}판 내 성`).toBe(b.playerCastleHp);
      expect(a.boss, `${n}판 보스`).toBe(b.boss);
      expect(a.endless, `${n}판 무한`).toBe(b.endless);
      expect(a.quizTypes, `${n}판 문항유형`).toEqual(b.quizTypes);
      expect(a.spawns.length, `${n}판 스폰 종류 수`).toBe(b.spawns.length);
      for (let i = 0; i < a.spawns.length; i++) {
        const x = a.spawns[i]!;
        const y = b.spawns[i]!;
        expect(x.id, `${n}판 스폰${i} id`).toBe(y.id);
        expect(x.t0).toBeCloseTo(y.t0, 9);
        expect(x.every).toBeCloseTo(y.every, 9);
        expect(x.cap, `${n}판 ${x.id} 수량`).toBe(y.cap);
        expect(x.hpMul ?? 1).toBeCloseTo(y.hpMul ?? 1, 9);
      }
    }
  });

  it('성장·배율·예산·문항유형 함수가 일치한다', () => {
    for (let n = 1; n <= 80; n++) {
      expect(allyGrowth(n)).toBeCloseTo(probe.allyGrowth(n), 9);
      expect(enemyMult(n)).toBeCloseTo(probe.enemyMult(n), 9);
      expect(enemyBudget(n)).toBeCloseTo(probe.enemyBudget(n), 9);
      expect(quizTypesFor(n)).toEqual(probe.quizTypesFor(n));
    }
  });

  it('덱 추천이 일치한다', () => {
    for (let n = 1; n <= 40; n++) {
      const owned = progressionAllies(Math.min(n, CAMPAIGN_STAGES));
      expect(defaultDeck(owned.map((u) => u.id)), `${n}판 덱`)
        .toEqual(probe.buildDeck(owned).map((u: { id: string }) => u.id));
    }
  });
});

describe('경제 상수 대조', () => {
  it('보상·시작금·바닥선·콤보가 일치한다', () => {
    expect(REWARD).toBe(probe.REWARD);
    expect(START_MONEY).toBe(probe.START_MONEY);
    for (let n = 1; n <= 40; n++) {
      expect(rewardBase(n), `${n}판 보상`).toBeCloseTo(probe.rewardBase(n), 9);
      expect(baseRegen(n), `${n}판 바닥선`).toBeCloseTo(probe.BASE_REGEN(n), 9);
    }
    for (const c of [0, 2, 3, 4, 5, 7, 8, 12]) expect(comboMul(c)).toBe(probe.comboMul(c));
  });

  it('DDA 상수가 일치한다', () => {
    expect(DDA_MAX).toBe(probe.DDA_MAX);
    expect(DDA_REWARD_PENALTY).toBeCloseTo(probe.DDA_REWARD_PENALTY, 9);
    expect(DDA_WRONG_TRIGGER).toBe(2);
  });

  it('맵 길이·제한 시간이 일치한다', () => {
    expect(MAP_LEN).toBe(probe.MAP_LEN);
    expect(MAX_SEC).toBe(probe.MAX_SEC);
  });

  /** 🔴 신바람·그릇은 게이트 결과를 바꾼다. 프로브만 옛 식이면 "통과"가 거짓이 된다. */
  it('셈력 그릇·신바람·판 길이 램프가 일치한다', () => {
    expect(MANA_CAP_BASE).toBe(probe.MANA_CAP_BASE);
    expect(MANA_CAP_MAX_LV).toBe(probe.MANA_CAP_MAX_LV);
    for (let lv = -2; lv <= MANA_CAP_MAX_LV + 2; lv++) expect(manaCap(lv), `${lv}단계`).toBe(probe.manaCap(lv));

    expect(HASTE_MAX).toBeCloseTo(probe.HASTE_MAX, 9);
    expect(HASTE_PER_CORRECT).toBeCloseTo(probe.HASTE_PER_CORRECT, 9);
    expect(HASTE_DECAY).toBeCloseTo(probe.HASTE_DECAY, 9);
    for (const b of [0, 0.22, 1, 1.5, 3]) expect(hasteOf(b), `부스트 ${b}`).toBeCloseTo(probe.hasteOf(b), 9);

    for (let n = 1; n <= 40; n++) expect(lengthRamp(n), `${n}판 램프`).toBeCloseTo(probe.lengthRamp(n), 9);

    expect(CANNON_PER_CORRECT).toBeCloseTo(probe.CANNON_PER_CORRECT, 9);
    expect(CANNON_KNOCKBACK).toBe(probe.CANNON_KNOCKBACK);
    for (const b of [2340, 5000, 9000]) expect(cannonDamage(b)).toBeCloseTo(probe.cannonDamage(b), 9);
  });

  it('콤보 배율 경계가 표와 정확히 일치한다', () => {
    expect([0, 1, 2].map(comboMul)).toEqual([1.0, 1.0, 1.0]);
    expect([3, 4].map(comboMul)).toEqual([1.2, 1.2]);
    expect([5, 6, 7].map(comboMul)).toEqual([1.4, 1.4, 1.4]);
    expect([8, 20].map(comboMul)).toEqual([1.6, 1.6]);
  });
});

describe('덱 규칙', () => {
  it('항상 5기 이하이고 보유한 유닛만 포함한다', () => {
    for (let st = 1; st <= 40; st++) {
      const owned = progressionAllies(Math.min(st, CAMPAIGN_STAGES)).map((u) => u.id);
      const deck = defaultDeck(owned);
      expect(deck.length).toBeLessThanOrEqual(DECK_SIZE);
      expect(new Set(deck).size).toBe(deck.length);
      for (const id of deck) expect(owned).toContain(id);
    }
    expect(defaultDeck(progressionAllies(CAMPAIGN_STAGES).map((u) => u.id))).toHaveLength(DECK_SIZE);
  });

  it('소환 전용 유닛은 진도만으로는 얻을 수 없다', () => {
    const free = new Set(progressionAllies(9999).map((u) => u.id));
    for (const u of ALLIES.filter((x) => x.unlock === 0)) {
      expect(free.has(u.id), `${u.name} 이 진도로 열린다`).toBe(false);
    }
  });
});
