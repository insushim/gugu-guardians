import { describe, it, expect } from 'vitest';
import { ARMOR_FLOOR, Battle } from '../src/sim/core';
import { stageDef, MAP_LEN } from '../src/sim/stages';
import { ALLIES, ALLY_BY_ID, ALLY_CAP, ENEMIES, ENEMY_BY_ID, dps, slotsOf } from '../src/sim/units';
import {
  CANNON_MAX_LV, cannonCost, cannonMult, REGEN_MAX_LV, regenCost, regenMult,
} from '../src/sim/economy';
// @ts-expect-error — 프로브 모델은 순수 JS다(Node 로 그대로 돌려야 해서 TS로 두지 않는다)
import * as probe from '../tools/probe-model.mjs';

/**
 * v3 전투 킷 — 광역 · 전설 특별기술 · 출전 자리 · 방어력 · 태생 돌파형 · 분열.
 *
 * 🔴 여기 있는 검사는 전부 **거동**을 본다. 상수만 대조하면 기능을 통째로 지워도 통과한다 —
 *    지난번 예비대 미러가 정확히 그렇게 뚫렸다(프로브의 예비대 블록을 삭제해도 초록불).
 *    각 테스트는 해당 기능을 되돌려 놓고 실제로 빨간불이 되는지 확인한 뒤 남겼다.
 */

describe('출전 자리 — 센 셈지기는 자리를 더 먹는다', () => {
  it('등급이 오를수록 자리를 더 차지한다', () => {
    const slots = (id: string) => slotsOf(ALLY_BY_ID.get(id)!);
    expect(slots('jipsin')).toBe(1);            // 노멀
    expect(slots('bungbung')).toBe(1);          // 레어
    expect(slots('haetae')).toBeGreaterThan(slots('bungbung'));      // 유니크
    expect(slots('jujak')).toBeGreaterThan(slots('haetae'));         // 에픽
    expect(slots('yongwang')).toBeGreaterThan(slots('jujak'));       // 전설
  });

  it('상한은 마리 수가 아니라 자리 수다 — 전설만 쌓을 수 없다', () => {
    const b = new Battle(stageDef(1));
    b.money = 999999;
    const legend = ALLIES.find((u) => u.rarity === 'legend')!;
    // 쿨다운을 무시하고 낼 수 있는 만큼 낸다(쿨다운은 다른 장치라 여기서는 재지 않는다)
    let placed = 0;
    for (let i = 0; i < 40; i++) {
      b.money = 999999;
      if (!b.summon(legend.id)) break;
      placed++;
      b.t += legend.cd + 0.1;
    }
    expect(placed).toBeGreaterThan(0);
    expect(b.usedSlots).toBeLessThanOrEqual(ALLY_CAP);
    // 🔴 자리 개념이 없으면 ALLY_CAP 마리(18기)가 다 들어간다. 전설은 그보다 훨씬 적어야 한다.
    expect(placed).toBeLessThan(ALLY_CAP);
    expect(placed).toBe(Math.floor(ALLY_CAP / slotsOf(legend)));
  });

  it('싼 셈지기는 자리 하나씩만 먹어 상한까지 들어간다', () => {
    const b = new Battle(stageDef(1));
    let placed = 0;
    for (let i = 0; i < 60; i++) {
      b.money = 999999;
      if (!b.summon('jipsin')) break;
      placed++;
      b.t += 2;
    }
    expect(placed).toBe(ALLY_CAP);
    expect(b.usedSlots).toBe(ALLY_CAP);
  });
});

describe('광역 공격 — 겹쳐 선 것을 함께 때린다', () => {
  it('광역 셈지기는 사거리 안에 겹친 적을 모두 깎는다', () => {
    const aoeUnit = ALLIES.find((u) => (u.aoe ?? 0) > 0)!;
    expect(aoeUnit, '광역 셈지기가 로스터에 하나도 없다').toBeDefined();

    const b = new Battle(stageDef(1));
    b.money = 999999;
    b.summon(aoeUnit.id);
    const me = b.units.find((u) => u.side === 1)!;
    me.x = 500;
    me.atkAt = 0;

    // 한 점에 겹쳐 세운 적 3기 — 반경 안이다
    const foe = ENEMY_BY_ID.get('e_mul')!;
    for (let i = 0; i < 3; i++) {
      b.units.push({
        uid: 900 + i, side: -1, defId: foe.id, x: 500 + i * 10,
        hp: 99999, maxHp: 99999, atk: 0, aspd: 99, range: 40, spd: 0,
        atkAt: 999, hurtAt: -99, swingAt: -99,
      });
    }
    const before = b.units.filter((u) => u.side === -1).map((u) => u.hp);
    b.step(1 / 30);
    const after = b.units.filter((u) => u.side === -1).map((u) => u.hp);
    // 🔴 단일 대상이면 한 기만 깎인다. 셋 다 깎여야 광역이다.
    expect(after.filter((hp, i) => hp < before[i]!).length).toBe(3);
  });

  it('광역 반경 밖은 맞지 않는다 — 반경이 무의미하지 않은지', () => {
    const aoeUnit = ALLIES.find((u) => (u.aoe ?? 0) > 0)!;
    const r = aoeUnit.aoe!;
    const b = new Battle(stageDef(1));
    b.money = 999999;
    b.summon(aoeUnit.id);
    const me = b.units.find((u) => u.side === 1)!;
    me.x = 500;
    me.atkAt = 0;
    const foe = ENEMY_BY_ID.get('e_mul')!;
    const mk = (uid: number, x: number) => b.units.push({
      uid, side: -1, defId: foe.id, x,
      hp: 99999, maxHp: 99999, atk: 0, aspd: 99, range: 40, spd: 0,
      atkAt: 999, hurtAt: -99, swingAt: -99,
    });
    mk(901, 500 + 5);           // 대상(가장 가깝다)
    mk(902, 500 + 5 + r + 40);  // 반경 밖
    const far = b.units.find((u) => u.uid === 902)!;
    const hp0 = far.hp;
    b.step(1 / 30);
    expect(far.hp).toBe(hp0);
  });
});

describe('전설 특별기술 — N타마다 한 번', () => {
  const legends = ALLIES.filter((u) => u.rarity === 'legend');

  it('모든 전설이 특별기술을 갖는다', () => {
    expect(legends.length).toBeGreaterThan(0);
    for (const u of legends) {
      expect(u.skill, `${u.id} 에 특별기술이 없다`).toBeDefined();
      expect(u.skill!.every).toBeGreaterThanOrEqual(2);
      expect(u.skill!.mult).toBeGreaterThan(1);
      expect(u.skill!.aoe).toBeGreaterThan(0);
    }
  });

  it('정확히 N번째 타격에서 더 세게, 광역으로 들어간다', () => {
    const u = legends[0]!;
    const sk = u.skill!;
    const b = new Battle(stageDef(1));
    b.money = 999999;
    b.summon(u.id);
    const me = b.units.find((s) => s.side === 1)!;
    me.x = 500;

    const foe = ENEMY_BY_ID.get('e_mul')!;
    b.units.push({
      uid: 900, side: -1, defId: foe.id, x: 500 + 5,
      hp: 1e12, maxHp: 1e12, atk: 0, aspd: 99, range: 40, spd: 0,
      atkAt: 999, hurtAt: -99, swingAt: -99,
    });
    const target = b.units.find((s) => s.uid === 900)!;

    const dmgPerHit: number[] = [];
    for (let n = 0; n < sk.every; n++) {
      me.atkAt = 0;                 // 다음 스텝에서 반드시 때리게
      const hp0 = target.hp;
      b.step(1 / 30);
      dmgPerHit.push(hp0 - target.hp);
    }
    const normal = dmgPerHit[0]!;
    const special = dmgPerHit[sk.every - 1]!;
    expect(normal).toBeGreaterThan(0);
    expect(special).toBeCloseTo(normal * sk.mult, 6);
    // 중간 타격은 평타여야 한다 — "매번 특별기술"이면 주기가 무의미하다
    for (let i = 1; i < sk.every - 1; i++) expect(dmgPerHit[i]).toBeCloseTo(normal, 6);
  });

  /**
   * 🔴 교차검증에서 잡힌 것: 성을 **직접** 두들길 때는 배율만 적용하고 기술 이벤트를
   *    안 내보내고 있었다. 전선이 적 성문에 닿은 뒤로는 전설이 기술을 써도 화면에
   *    아무 일도 안 일어난다 — 코드 자신의 주석이 경고한 "샀는데 안 나오는 기술"이다.
   *    유닛을 때릴 때만 검사하면 이 구멍을 못 본다. 두 경로를 다 본다.
   */
  it('유닛을 때릴 때도, 성을 때릴 때도 기술 이벤트가 나간다', () => {
    const u = legends[0]!;
    const sk = u.skill!;

    const fire = (againstCastle: boolean): string[] => {
      const b = new Battle(stageDef(1));
      b.money = 999999;
      b.summon(u.id);
      const me = b.units.find((s) => s.side === 1)!;
      if (againstCastle) {
        me.x = MAP_LEN - u.range;      // 성 사거리 안, 적은 없다
      } else {
        me.x = 500;
        const foe = ENEMY_BY_ID.get('e_mul')!;
        b.units.push({
          uid: 900, side: -1, defId: foe.id, x: 505,
          hp: 1e9, maxHp: 1e9, atk: 0, aspd: 99, range: 40, spd: 0,
          atkAt: 999, hurtAt: -99, swingAt: -99,
        });
      }
      const names: string[] = [];
      for (let n = 0; n < sk.every; n++) {
        me.atkAt = 0;
        b.events.length = 0;
        b.step(1 / 30);
        for (const e of b.events) if (e.type === 'skill' && e.name) names.push(e.name);
      }
      return names;
    };

    // 두 경로 모두 주기당 정확히 한 번
    expect(fire(false), '유닛 타격 경로').toEqual([sk.name]);
    expect(fire(true), '성 타격 경로').toEqual([sk.name]);
  });

  it('덱 추천 점수(dps)가 특별기술의 평균 기여를 센다', () => {
    const u = legends[0]!;
    const sk = u.skill!;
    const plain = u.atk / Math.max(0.1, u.aspd);
    expect(dps(u)).toBeGreaterThan(plain);
    expect(dps(u)).toBeCloseTo(plain * ((sk.every - 1 + sk.mult) / sk.every), 9);
  });
});

describe('방어력 — 약한 공격은 튕겨 내되 완전 무효는 아니다', () => {
  const armored = ENEMIES.find((e) => (e.armor ?? 0) > 0)!;

  it('방어력 있는 적이 로스터에 있다', () => {
    expect(armored).toBeDefined();
  });

  /**
   * 🔴 이 테스트를 처음엔 "센 공격이 약한 공격보다 10배 넘게 들어간다"로 썼다.
   *    그건 **방어력을 통째로 지워도 통과한다**(50 vs 5000 은 그냥 100배다).
   *    무엇이 깎였는지를 재야 한다 — 공식 그대로 대조한다.
   */
  it('방어력만큼 깎아서 들어간다 — 그리고 완전 무효는 아니다', () => {
    const ARMOR = armored.armor!;
    const hit = (atk: number) => {
      const b = new Battle(stageDef(20));
      b.money = 999999;
      b.summon('jipsin');
      const me = b.units.find((u) => u.side === 1)!;
      me.x = 500;
      me.atk = atk;
      me.atkAt = 0;
      // 🔴 체력을 1e12 로 잡았더니 (hp - dealt) 뺄셈에서 배정밀도가 깎여
      //    상대오차 7e-6 이 났다. 재려는 값(수천)보다 5자리쯤 크면 충분하다.
      const hp = 1e8;
      const armor = ARMOR * b.stage.mult;
      b.units.push({
        uid: 900, side: -1, defId: armored.id, x: 505,
        hp, maxHp: hp, atk: 0, aspd: 99, range: 40, spd: 0,
        atkAt: 999, hurtAt: -99, swingAt: -99, armor,
      });
      const t = b.units.find((u) => u.uid === 900)!;
      b.step(1 / 30);
      return { dealt: hp - t.hp, armor };
    };

    const strongAtk = 5000;
    const strong = hit(strongAtk);
    expect(strong.armor).toBeGreaterThan(0);
    // 방어력만큼 정확히 깎였는가 (지우면 dealt === strongAtk 가 되어 실패한다)
    // 🔴 체력을 크게 잡아 두면 배정밀도 오차가 절대비교를 흔든다 — 비율로 본다
    expect(strong.dealt / (strongAtk - strong.armor)).toBeCloseTo(1, 6);
    expect(strong.dealt).toBeLessThan(strongAtk);

    // 방어력보다 약한 공격도 바닥선만큼은 들어간다 — 0 이면 "고장난 공격"으로 읽힌다
    const weakAtk = strong.armor / 4;
    const weak = hit(weakAtk);
    expect(weak.dealt / (weakAtk * ARMOR_FLOOR)).toBeCloseTo(1, 6);
    expect(weak.dealt).toBeGreaterThan(0);
  });

  it('먹 대포에도 방어력이 걸린다 — 가장 센 한 방만 예외면 규칙이 아니다', () => {
    const b = new Battle(stageDef(20));
    for (let i = 0; i < 40; i++) b.answer(true, 1200);
    const hp = 1e8;
    const mk = (uid: number, armor: number) => b.units.push({
      uid, side: -1, defId: armored.id, x: 505,
      hp, maxHp: hp, atk: 0, aspd: 99, range: 40, spd: 0,
      atkAt: 999, hurtAt: -99, swingAt: -99,
      ...(armor ? { armor } : {}),
    });
    mk(901, 1e7);    // 대포 피해보다 훨씬 큰 방어력
    mk(902, 0);      // 대조군 — 같은 판에서 대포 원 피해를 잰다
    const armoredUnit = b.units.find((u) => u.uid === 901)!;
    const plain = b.units.find((u) => u.uid === 902)!;
    expect(b.fireCannon()).toBe(true);
    const raw = hp - plain.hp;
    const dealt = hp - armoredUnit.hp;
    expect(raw).toBeGreaterThan(0);
    // 방어력을 안 걸면 dealt === raw 가 된다. 바닥선(15%)만 들어가야 한다.
    expect(dealt / (raw * ARMOR_FLOOR)).toBeCloseTo(1, 6);
  });
});

describe('태생 돌파형·분열 — 0단계에서도 있는 특기', () => {
  it('태생 돌파형은 난이도 0단계에서도 전선을 지나친다', () => {
    const e = ENEMIES.find((x) => x.breaker === true)!;
    expect(e, '태생 돌파형이 로스터에 없다').toBeDefined();
    const b = new Battle(stageDef(20), {}, {}, 0);   // 0단계 = 단계발 돌파 0
    const made = b.units;
    // 실제 스폰을 기다리는 대신, 0단계에서 그 종이 나올 때 breaker 가 켜지는지 본다
    for (let i = 0; i < 4000 && !made.some((u) => u.defId === e.id); i++) b.step(0.1);
    const one = made.find((u) => u.defId === e.id);
    expect(one, `${e.id} 가 ST20 에서 끝내 안 나왔다`).toBeDefined();
    expect(one!.breaker).toBe(true);
  });

  it('0단계에서 돌파형은 태생 종뿐이다 — 단계발 돌파가 새어 들어오지 않는다', () => {
    const b = new Battle(stageDef(20), {}, {}, 0);
    for (let i = 0; i < 3000; i++) {
      b.step(0.1);
      for (const u of b.units) {
        if (u.side !== -1 || !u.breaker) continue;
        expect(ENEMY_BY_ID.get(u.defId)?.breaker, `${u.defId} 가 0단계에서 돌파형이 됐다`).toBe(true);
      }
      if (b.status !== 'playing') break;
    }
  });

  it('분열형이 쓰러지면 새끼가 그 자리에서 나온다', () => {
    const parent = ENEMIES.find((e) => e.split)!;
    expect(parent).toBeDefined();
    const b = new Battle(stageDef(5));
    b.units.push({
      uid: 900, side: -1, defId: parent.id, x: 480,
      hp: 1, maxHp: 1, atk: 0, aspd: 99, range: 40, spd: 0,
      atkAt: 999, hurtAt: -99, swingAt: -99,
      split: parent.split!,
    });
    const before = b.units.filter((u) => u.defId === parent.split!.id).length;
    b.units.find((u) => u.uid === 900)!.hp = 0;
    b.step(1 / 30);
    const kids = b.units.filter((u) => u.defId === parent.split!.id);
    expect(kids.length - before).toBe(parent.split!.n);
    for (const k of kids) {
      expect(Math.abs(k.x - 480)).toBeLessThanOrEqual(60);
      expect(k.x).toBeGreaterThanOrEqual(0);
      expect(k.x).toBeLessThanOrEqual(MAP_LEN);
    }
  });
});

describe('먹 대포·셈력 샘 강화', () => {
  it('대포는 기본이 약하고 키우면 세진다 — 단계마다 단조 증가', () => {
    // 🔴 사용자 보고 "먹 대포 너무 쎔". 기본을 낮추고 되사는 구조라, 0단계는 종전보다 약하고
    //    최대 단계는 종전보다 조금 세야 한다. 둘 다 깨지면 "그냥 너프"이거나 "그냥 버프"다.
    expect(cannonMult(0)).toBeLessThan(1);
    expect(cannonMult(CANNON_MAX_LV)).toBeGreaterThan(1);
    for (let lv = 0; lv < CANNON_MAX_LV; lv++) {
      expect(cannonMult(lv + 1)).toBeGreaterThan(cannonMult(lv));
      expect(cannonCost(lv + 1)).toBeGreaterThan(cannonCost(lv));
    }
    expect(cannonMult(CANNON_MAX_LV + 9)).toBe(cannonMult(CANNON_MAX_LV));
    expect(cannonCost(CANNON_MAX_LV)).toBe(Infinity);
  });

  it('셈력 샘은 회복 속도를 올리되 상한이 있다', () => {
    expect(regenMult(0)).toBe(1);
    for (let lv = 0; lv < REGEN_MAX_LV; lv++) {
      expect(regenMult(lv + 1)).toBeGreaterThan(regenMult(lv));
      expect(regenCost(lv + 1)).toBeGreaterThan(regenCost(lv));
    }
    expect(regenMult(REGEN_MAX_LV + 9)).toBe(regenMult(REGEN_MAX_LV));
    expect(regenCost(REGEN_MAX_LV)).toBe(Infinity);
    // 🔴 회복 바닥선이 너무 세지면 문제를 안 풀어도 굴러간다 — 학습 유인이 사라진다
    expect(regenMult(REGEN_MAX_LV)).toBeLessThanOrEqual(1.5);
  });

  it('강화 단계가 전투에 실제로 반영된다', () => {
    const bare = new Battle(stageDef(1), {}, {});
    const grown = new Battle(stageDef(1), {}, { regen: REGEN_MAX_LV, cannon: CANNON_MAX_LV });
    expect(grown.regenMul).toBeGreaterThan(bare.regenMul);
    expect(grown.cannonMul).toBeGreaterThan(bare.cannonMul);
    for (let i = 0; i < 100; i++) { bare.step(0.1); grown.step(0.1); }
    expect(grown.money).toBeGreaterThan(bare.money);
  });

  it('대포 위력이 강화 단계에 실제로 비례한다', () => {
    const shoot = (cannon: number) => {
      const b = new Battle(stageDef(3), {}, { cannon });
      for (let i = 0; i < 600 && !b.units.some((u) => u.side === -1); i++) b.step(0.1);
      for (let i = 0; i < 40; i++) b.answer(true, 1200);
      const foe = b.units.find((u) => u.side === -1)!;
      const hp0 = foe.hp;
      b.fireCannon();
      return hp0 - foe.hp;
    };
    const lo = shoot(0), hi = shoot(CANNON_MAX_LV);
    expect(lo).toBeGreaterThan(0);
    expect(hi / lo).toBeCloseTo(cannonMult(CANNON_MAX_LV) / cannonMult(0), 4);
  });
});

describe('프로브 미러 — 상수가 아니라 거동을 대조한다', () => {
  it('자리 계산이 같다', () => {
    for (const u of ALLIES) expect(probe.slotsOf(u)).toBe(slotsOf(u));
  });

  it('덱 추천 점수(dps)가 같다 — 전설 기술 가중까지', () => {
    for (const u of ALLIES) expect(probe.dps(u)).toBeCloseTo(dps(u), 9);
  });

  /**
   * 🔴 여기가 핵심이다. 프로브가 자리 상한을 **마리 수**로 세면 전설을 18기 세워
   *    게이트가 실제보다 후하게 나온다 — 그 격차는 상수 대조로는 절대 안 잡힌다.
   *    그래서 같은 판을 양쪽에서 굴려 **전설 로스터의 성적**을 비교한다.
   */
  it('프로브의 소환 판정이 자리 상한을 지킨다 — 마리 수로 세면 여기서 걸린다', () => {
    // 🔴 `maxSlots` 는 소환 판정과 **따로** 세어 둔 값이다. 판정이 마리 수로 갈라지면
    //    실제 사용 자리 수가 상한을 넘어 여기서 즉시 드러난다.
    //    (예전 미러 테스트는 emergent 결과만 봐서 판정을 마리 수로 바꿔도 초록불이었다.)
    let sawFull = false;
    for (const [st, acc, seed] of [[12, 0.85, 3], [20, 0.95, 7], [30, 0.95, 11]] as const) {
      const r = probe.simulate(st, acc, seed, null, 0);
      expect(r.maxAllyX, `ST${st} 하네스가 안 돌았다`).toBeGreaterThan(0);
      expect(r.maxSlots, `ST${st} 자리 사용 ${r.maxSlots} > 상한 ${probe.ALLY_CAP}`)
        .toBeLessThanOrEqual(probe.ALLY_CAP);
      if (r.maxSlots >= probe.ALLY_CAP) sawFull = true;
    }
    // 상한에 실제로 닿는 판이 하나는 있어야 이 검사가 무언가를 재고 있다
    expect(sawFull, '어느 판도 자리 상한에 닿지 않았다 — 이 검사는 헛돌고 있다').toBe(true);
  });

  /**
   * 🔴 **프로브가 신규 메카닉을 실제로 돌리는지**를 센다.
   *    상수(ARMOR_FLOOR·TIER_AOE 등)를 대조하는 것만으로는 부족하다 — 프로브 쪽 구현을
   *    통째로 지워도 상수는 그대로 남아 전부 통과한다(지난번 예비대 미러가 정확히 그랬다).
   *    밸런스 게이트(G8·G9)가 이 `simulate()` 로 돌기 때문에, 여기서 한 메카닉이 빠지면
   *    "검증했다"는 결론 자체의 근거가 사라진다.
   */
  it('프로브에서 방어력·특별기술·분열·광역이 모두 실제로 발동한다', () => {
    const full = Object.fromEntries(ALLIES.map((u) => [u.id, 6]));   // 전설 포함 보유
    const total = { armorBlocked: 0, skillHits: 0, splitBorn: 0, aoeHits: 0 };
    // 방어력(ST18+)·분열(ST5+)·광역(단계 2+ 또는 태생)이 모두 등장하는 구간을 고른다
    for (const [st, tier] of [[24, 4], [30, 0], [20, 6]] as const) {
      const r = probe.simulate(st, 0.85, 5, full, tier);
      expect(r.maxAllyX, `ST${st} 하네스가 안 돌았다`).toBeGreaterThan(0);
      for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += r.fired[k];
    }
    expect(total.armorBlocked, '프로브에서 방어력이 한 번도 안 걸렸다').toBeGreaterThan(0);
    expect(total.skillHits, '프로브에서 전설 특별기술이 한 번도 안 터졌다').toBeGreaterThan(0);
    expect(total.splitBorn, '프로브에서 분열이 한 번도 안 일어났다').toBeGreaterThan(0);
    expect(total.aoeHits, '프로브에서 광역이 둘 이상을 때린 적이 없다').toBeGreaterThan(0);
  });

  it('은퇴표가 같다 — 한 판에 동시에 나오는 종류가 코어와 일치', () => {
    for (const st of [1, 5, 10, 13, 16, 20, 24, 30, 45]) {
      const mine = stageDef(st).spawns.map((s) => s.id).sort();
      const theirs = probe.stageDef(st).spawns.map((s: { id: string }) => s.id).sort();
      expect(theirs, `ST${st}`).toEqual(mine);
    }
  });
});
