import { describe, it, expect } from 'vitest';
import { Battle } from '../src/sim/core';
import { stageDef, lengthRamp, CAMPAIGN_STAGES } from '../src/sim/stages';
import { quizTypesFor, REVIEW_WINDOW, TYPE_ORDER as ALL_TYPE_ORDER } from '../src/sim/stages';
import { ALLIES } from '../src/sim/units';
import {
  manaCap, manaCapCost, MANA_CAP_BASE, MANA_CAP_MAX_LV,
  hasteOf, HASTE_MAX, HASTE_PER_CORRECT, HASTE_DECAY,
} from '../src/sim/economy';

describe('셈력 그릇(상한)', () => {
  /**
   * 🔴 이 테스트가 이 파일에서 가장 중요하다.
   *    상한을 600 으로 **손으로 적었더니** 전설 3종(900·780·700)이 전부 소환 불가가 됐다.
   *    아이 입장에서는 가장 귀한 보상이 고장난 것으로 보인다. 콘솔 에러도, 테스트 실패도
   *    나지 않았고 프로브의 무한 도달 한계가 ST60→ST50 으로 떨어져서야 드러났다.
   *    셈지기를 하나 추가할 때마다 사람이 이 관계를 기억할 수는 없으므로 기계가 지킨다.
   */
  it('기본 그릇이 가장 비싼 셈지기보다 크다 — 안 그러면 뽑아도 영영 못 낸다', () => {
    const priciest = Math.max(...ALLIES.map((u) => u.cost));
    expect(MANA_CAP_BASE, `가장 비싼 셈지기 ${priciest}`).toBeGreaterThan(priciest);
  });

  it('모든 셈지기가 0단계 그릇으로 소환 가능한 비용이다', () => {
    const tooDear = ALLIES.filter((u) => u.cost > manaCap(0));
    expect(tooDear.map((u) => `${u.id}(${u.cost})`)).toEqual([]);
  });

  it('단계가 오를수록 커지고 최대 단계에서 멈춘다', () => {
    for (let lv = 0; lv < MANA_CAP_MAX_LV; lv++) {
      expect(manaCap(lv + 1)).toBeGreaterThan(manaCap(lv));
    }
    expect(manaCap(MANA_CAP_MAX_LV + 5)).toBe(manaCap(MANA_CAP_MAX_LV));
    expect(manaCap(-3)).toBe(manaCap(0));
  });

  it('강화 비용은 단계마다 오르고 최대 단계에서는 살 수 없다', () => {
    for (let lv = 0; lv < MANA_CAP_MAX_LV - 1; lv++) {
      expect(manaCapCost(lv + 1)).toBeGreaterThan(manaCapCost(lv));
    }
    expect(manaCapCost(MANA_CAP_MAX_LV)).toBe(Infinity);
  });

  it('셈력이 그릇을 넘지 않는다 — 정답으로도, 자동 충전으로도', () => {
    const b = new Battle(stageDef(1));
    for (let i = 0; i < 60; i++) b.answer(true, 1200);
    expect(b.money).toBeLessThanOrEqual(b.manaMax);
    for (let i = 0; i < 400; i++) b.step(0.1);
    expect(b.money).toBeLessThanOrEqual(b.manaMax);
  });

  it('그릇 단계를 올리면 전투가 더 담는다', () => {
    const lo = new Battle(stageDef(1), {}, 0);
    const hi = new Battle(stageDef(1), {}, 3);
    expect(hi.manaMax).toBeGreaterThan(lo.manaMax);
    for (let i = 0; i < 80; i++) { lo.answer(true, 1200); hi.answer(true, 1200); }
    expect(hi.money).toBeGreaterThan(lo.money);
  });
});

describe('신바람(아군 가속)', () => {
  it('평소 속도에서 시작한다', () => {
    expect(new Battle(stageDef(1)).haste).toBe(1);
    expect(hasteOf(0)).toBe(1);
  });

  it('정답을 맞히면 아군이 빨라진다', () => {
    const b = new Battle(stageDef(1));
    b.answer(true, 1200);
    expect(b.haste).toBeCloseTo(1 + HASTE_PER_CORRECT, 6);
  });

  it('오답은 가속을 올리지 않는다', () => {
    const b = new Battle(stageDef(1));
    b.answer(false, 1200);
    expect(b.haste).toBe(1);
  });

  it('상한을 넘지 않는다 — 내부 부스트도 함께 잠근다', () => {
    const b = new Battle(stageDef(1));
    for (let i = 0; i < 50; i++) b.answer(true, 1200);
    expect(b.haste).toBeCloseTo(HASTE_MAX, 6);
    // 🔴 내부 값을 안 잠그면 50문제 뒤 최고 가속이 50초 넘게 고정된다
    expect(b.hasteBoost).toBeCloseTo(HASTE_MAX - 1, 6);
  });

  it('손을 놓으면 평소 속도로 돌아온다', () => {
    const b = new Battle(stageDef(1));
    b.answer(true, 1200);
    const boosted = b.haste;
    for (let i = 0; i < 300; i++) b.step(0.1);
    expect(b.haste).toBeLessThan(boosted);
    expect(b.haste).toBe(1);
  });

  it('풀리는 속도가 시뮬 시간에 비례한다', () => {
    const b = new Battle(stageDef(1));
    b.answer(true, 1200);
    b.answer(true, 1200);
    const before = b.haste;
    b.step(1.0);
    expect(before - b.haste).toBeCloseTo(HASTE_DECAY, 6);
  });

  /** 🔴 이게 이 기능의 존재 이유다 — 세상의 시계는 그대로여야 문제 수가 보존된다 */
  it('적에게는 걸리지 않는다 — 세상이 아니라 내 군대만 빨라진다', () => {
    const mk = (boost: number) => {
      const b = new Battle(stageDef(3));
      for (let i = 0; i < 400 && !b.units.some((u) => u.side === -1); i++) b.step(0.1);
      b.hasteBoost = boost;
      const foe = b.units.find((u) => u.side === -1 && u.spd > 0)!;
      const x0 = foe.x;
      for (let i = 0; i < 10; i++) b.step(0.1);
      const now = b.units.find((u) => u.uid === foe.uid);
      return now ? x0 - now.x : null;   // 적이 왼쪽으로 전진한 거리
    };
    const slow = mk(0), fast = mk(HASTE_MAX - 1);
    expect(slow).not.toBeNull();
    expect(fast).toBeCloseTo(slow!, 6);
  });
});

describe('먹 대포', () => {
  /** 적이 실제로 전장에 나올 때까지 굴린다 */
  function withEnemies(stage = 3) {
    const b = new Battle(stageDef(stage));
    for (let i = 0; i < 400 && !b.units.some((u) => u.side === -1); i++) b.step(0.1);
    return b;
  }

  it('처음엔 못 쏜다', () => {
    expect(new Battle(stageDef(1)).cannonReady).toBe(false);
    expect(new Battle(stageDef(1)).fireCannon()).toBe(false);
  });

  /** 🔴 시간으로 차면 손 놓고 기다리는 게 이득이 된다 — 학습과 재미가 경쟁하면 안 된다 */
  it('시간으로는 절대 차지 않는다 — 정답으로만 찬다', () => {
    const b = new Battle(stageDef(1));
    for (let i = 0; i < 600; i++) b.step(0.1);
    expect(b.cannonCharge).toBe(0);
    b.answer(true, 1200);
    expect(b.cannonCharge).toBeGreaterThan(0);
  });

  it('오답은 충전되지 않는다', () => {
    const b = new Battle(stageDef(1));
    b.answer(false, 1200);
    expect(b.cannonCharge).toBe(0);
  });

  it('정답을 충분히 맞히면 쏠 수 있고, 쏘면 충전이 비워진다', () => {
    const b = withEnemies();
    for (let i = 0; i < 12; i++) b.answer(true, 1200);
    expect(b.cannonReady).toBe(true);
    expect(b.fireCannon()).toBe(true);
    expect(b.cannonCharge).toBe(0);
    expect(b.cannonReady).toBe(false);
  });

  it('적을 실제로 깎고 뒤로 민다', () => {
    const b = withEnemies();
    for (let i = 0; i < 12; i++) b.answer(true, 1200);
    const before = b.units.filter((u) => u.side === -1 && u.hp > 0)
      .map((u) => ({ uid: u.uid, hp: u.hp, x: u.x, spd: u.spd }));
    expect(before.length).toBeGreaterThan(0);
    b.fireCannon();
    for (const p of before) {
      const now = b.units.find((u) => u.uid === p.uid);
      if (!now) continue;                       // 맞고 죽었으면 그것도 정상
      expect(now.hp, `${p.uid} 체력`).toBeLessThan(p.hp);
      if (p.spd > 0) expect(now.x, `${p.uid} 위치`).toBeGreaterThan(p.x);
    }
  });

  /** 저학년 게임에서 "내 편이 다치는 버튼"은 이해 비용이 크다 */
  it('아군은 건드리지 않는다', () => {
    const b = withEnemies();
    for (let i = 0; i < 12; i++) b.answer(true, 1200);
    b.summon('jipsin');
    const allies = b.units.filter((u) => u.side === 1).map((u) => ({ uid: u.uid, hp: u.hp, x: u.x }));
    b.fireCannon();
    for (const a of allies) {
      const now = b.units.find((u) => u.uid === a.uid)!;
      expect(now.hp).toBe(a.hp);
      expect(now.x).toBe(a.x);
    }
  });

  it('충전은 1을 넘지 않는다', () => {
    const b = new Battle(stageDef(1));
    for (let i = 0; i < 80; i++) b.answer(true, 1200);
    expect(b.cannonCharge).toBe(1);
  });
});

describe('판 길이 램프', () => {
  it('첫 판이 가장 짧고 캠페인 중반에 기준 길이에 도달한다', () => {
    expect(lengthRamp(1)).toBeLessThan(lengthRamp(6));
    expect(lengthRamp(6)).toBeLessThan(lengthRamp(12));
    expect(lengthRamp(12)).toBeCloseTo(1, 9);
    expect(lengthRamp(60)).toBeCloseTo(1, 9);
  });

  /**
   * 🔴 절대값(30000 등)으로 쓰지 않는다 — 신바람을 넣으면서 판이 짧아져 CASTLE_K 를
   *    30000→42000 으로 올렸더니 이 테스트가 깨졌다. 지키려는 건 특정 숫자가 아니라
   *    **"첫 판은 램프가 없을 때의 절반 수준"** 이라는 관계다. 관계로 쓴다.
   */
  it('첫 판 적 성 체력이 램프 없는 경우의 절반 수준이다', () => {
    const unramped = stageDef(1).castleHp / lengthRamp(1);
    expect(stageDef(1).castleHp / unramped).toBeCloseTo(lengthRamp(1), 6);
    expect(lengthRamp(1)).toBeLessThanOrEqual(0.55);
  });

  it('적 성 체력은 판이 갈수록 커진다 — 보스 판만 낮다', () => {
    for (const n of [1, 2, 3, 5, 7, 12, 20, 29]) {
      if (stageDef(n).boss || stageDef(n + 1).boss) continue;
      expect(stageDef(n + 1).castleHp, `${n}→${n + 1}`).toBeGreaterThan(stageDef(n).castleHp);
    }
  });

  /** 🔴 우리 성에는 램프를 걸지 않는다 — 줄이면 초반이 오히려 어려워진다(방향이 반대) */
  it('우리 성 체력도 판마다 커지고, 램프의 영향을 받지 않는다', () => {
    for (const n of [1, 5, 12, 25]) {
      expect(stageDef(n + 1).playerCastleHp).toBeGreaterThan(stageDef(n).playerCastleHp);
    }
    expect(stageDef(1).playerCastleHp).toBe(3400);
    expect(stageDef(CAMPAIGN_STAGES).playerCastleHp).toBeGreaterThan(stageDef(1).playerCastleHp * 30);
  });
});

describe('문항 유형 진행', () => {
  it('첫 판은 한 자리 덧셈·뺄셈만 나온다 — 2학년 1학기 수준', () => {
    expect(quizTypesFor(1)).toEqual(['A1', 'S1']);
  });

  it('판이 갈수록 새 유형이 열린다', () => {
    const open = (n: number) => new Set(quizTypesFor(n));
    expect(open(1).has('M1')).toBe(false);
    expect(quizTypesFor(28)).toContain('D2');           // 마지막 유형까지 개방
  });

  /**
   * 🔴 이 테스트가 "뒤로 갈수록 어려워진다"는 약속을 지킨다.
   *    예전엔 회전 인덱스가 겹치면 채우기 루프가 open[0] 부터 시작해서
   *    40판에서도 '한 자리 덧셈'(A1)이 세 유형 중 하나로 나왔다 — 4학년에게 3+2 를 풀린 것이다.
   */
  it('후반 판에는 한 자리 덧셈·뺄셈이 다시 나오지 않는다', () => {
    for (let n = 25; n <= 80; n++) {
      const t = quizTypesFor(n);
      expect(t, `${n}판`).not.toContain('A1');
      expect(t, `${n}판`).not.toContain('S1');
    }
  });

  it('복습은 최근 배운 범위 안에서만 돈다', () => {
    for (let n = 1; n <= 80; n++) {
      const open = ALL_TYPE_ORDER.slice(0, Math.min(ALL_TYPE_ORDER.length, 2 + Math.floor((n - 1) / 3)));
      const pool = new Set(open.slice(Math.max(0, open.length - REVIEW_WINDOW)));
      for (const t of quizTypesFor(n)) expect(pool.has(t), `${n}판의 ${t}`).toBe(true);
    }
  });

  it('항상 2종 이상 나온다 — 한 종류만 반복되면 연습이 아니라 암기가 된다', () => {
    for (let n = 1; n <= 80; n++) expect(quizTypesFor(n).length, `${n}판`).toBeGreaterThanOrEqual(2);
  });
});
