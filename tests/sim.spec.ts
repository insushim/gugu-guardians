import { describe, it, expect } from 'vitest';
import { Battle } from '../src/sim/core';
import { stageDef, MAP_LEN, MAX_SEC } from '../src/sim/stages';
import { ALLY_CAP, ALLY_BY_ID, defaultDeck, progressionAllies } from '../src/sim/units';
import { START_MONEY, REWARD, comboMul } from '../src/sim/economy';

const DT = 0.1;

/** 정답률 acc 로 문항을 풀며 덱에서 살 수 있는 가장 비싼 것을 소환하는 봇 */
function playBot(stage: number, acc: number, seed = 1, maxT = MAX_SEC) {
  const b = new Battle(stageDef(stage));
  const deck = defaultDeck(progressionAllies(stage).map((u) => u.id));
  const cheapest = Math.min(...deck.map((id) => ALLY_BY_ID.get(id)!.cost));
  let rngState = seed >>> 0;
  const rnd = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  };
  let nextQuiz = 1.5;
  // 프로브와 같은 학습자 모델: 숙련도가 낮으면 느리고 자주 틀린다 + DDA가 내려가면 체감 정답률이 오른다
  const tOk = (a: number) => 2.3 + (1 - a) * 2.4;
  while (b.status === 'playing' && b.t < maxT) {
    if (b.t >= nextQuiz) {
      const effAcc = Math.min(0.99, acc + b.dda.level * 0.10);
      const ok = rnd() < effAcc;
      b.answer(ok, ok ? 2400 : 4000);
      nextQuiz = b.t + (ok ? tOk(acc) : tOk(acc) + 1.6);
    }
    const affordable = deck
      .map((id) => ALLY_BY_ID.get(id)!)
      .filter((u) => b.canSummon(u.id))
      .filter((u) => u.cost === cheapest || b.money - u.cost >= cheapest * 2)
      .sort((x, y) => y.cost - x.cost);
    if (affordable[0]) b.summon(affordable[0].id);
    b.step(DT);
  }
  return b;
}

describe('전투 코어', () => {
  // DoD 1
  it('덱 카드를 소환하면 아군 성에서 유닛이 나온다', () => {
    const b = new Battle(stageDef(1));
    expect(b.summon('kkachi')).toBe(true);
    expect(b.units).toHaveLength(1);
    expect(b.units[0]!.x).toBe(0);
    expect(b.units[0]!.side).toBe(1);
    expect(b.money).toBe(START_MONEY - ALLY_BY_ID.get('kkachi')!.cost);
  });

  // DoD 2
  it('셈력이 부족하거나 쿨다운 중이면 소환되지 않는다', () => {
    const b = new Battle(stageDef(1));
    b.summon('kkachi');
    expect(b.canSummon('kkachi')).toBe(false);          // 쿨다운
    expect(b.cooldownLeft('kkachi')).toBeCloseTo(2.0, 6);
    b.money = 0;
    expect(b.canSummon('musoe')).toBe(false);           // 셈력 부족
  });

  it('소환된 유닛이 오른쪽으로 전진한다', () => {
    const b = new Battle(stageDef(1));
    b.summon('kkachi');
    const x0 = b.units[0]!.x;
    for (let i = 0; i < 10; i++) b.step(DT);
    expect(b.units[0]!.x).toBeGreaterThan(x0);
  });

  // DoD 3
  it('사거리 안에서 서로 공격하고 HP가 0이면 사라진다', () => {
    const b = new Battle(stageDef(1));
    b.summon('kkachi');
    // 적을 바로 앞에 놓는다
    b.units.push({
      uid: 999, side: -1, defId: 'e_mul', x: 20, hp: 30, maxHp: 30,
      atk: 1, aspd: 5, range: 40, spd: 0, atkAt: 99, hurtAt: -99, swingAt: -99,
    });
    for (let i = 0; i < 25; i++) b.step(DT);   // t<3s — 자연 스폰이 끼어들기 전
    expect(b.units.some((u) => u.side === -1)).toBe(false);
  });

  // DoD 5
  it('적 성 HP가 0이면 승리, 아군 성 HP가 0이면 패배', () => {
    const win = new Battle(stageDef(1));
    win.castleHp = 1;
    win.summon('kkachi');
    win.units[0]!.x = MAP_LEN - 20;            // 성 앞에 세워 성 타격 경로만 검증
    for (let i = 0; i < 30 && win.status === 'playing'; i++) win.step(DT);
    expect(win.status).toBe('win');

    const lose = new Battle(stageDef(1));
    lose.playerCastleHp = 1;
    lose.units.push({
      uid: 1, side: -1, defId: 'e_mul', x: 10, hp: 999, maxHp: 999,
      atk: 50, aspd: 0.5, range: 40, spd: 40, atkAt: 0, hurtAt: -99, swingAt: -99,
    });
    for (let i = 0; i < 200 && lose.status === 'playing'; i++) lose.step(DT);
    expect(lose.status).toBe('lose');
  });

  // DoD 6
  it('420초가 지나면 무승부로 끝난다', () => {
    const b = new Battle(stageDef(1));
    b.castleHp = 1e9;
    b.playerCastleHp = 1e9;
    while (b.status === 'playing') b.step(DT);
    expect(b.status).toBe('draw');
    expect(b.t).toBeGreaterThanOrEqual(MAX_SEC);
  });

  // DoD 7
  it('동시 출전 상한을 넘겨 소환되지 않는다', () => {
    const b = new Battle(stageDef(1));
    b.money = 1e6;
    for (let i = 0; i < 400; i++) {
      b.summon('kkachi');
      b.step(DT);
      b.money = 1e6;
      expect(b.aliveAllies).toBeLessThanOrEqual(ALLY_CAP);
    }
  });

  it('적이 아군 전선을 통째로 지나쳐 성을 때리지 못한다', () => {
    const b = new Battle(stageDef(2));
    b.summon('kkachi');
    for (let i = 0; i < 300; i++) b.step(DT);
    const allyFront = Math.max(...b.units.filter((u) => u.side === 1).map((u) => u.x), 0);
    for (const e of b.units.filter((u) => u.side === -1)) {
      expect(e.x).toBeGreaterThanOrEqual(Math.max(0, allyFront - 60) - 1e-6);
    }
  });

  // DoD 8 / 10 / 12
  it('정답이면 셈력이 콤보 배율만큼 오르고 오답이면 성 HP가 줄지 않는다', () => {
    const b = new Battle(stageDef(1));
    const before = b.playerCastleHp;
    b.money = 0;
    for (let i = 0; i < 3; i++) b.answer(true, 2000);
    expect(b.combo).toBe(3);
    const gained = b.answer(true, 2000);
    expect(gained).toBeCloseTo(REWARD * comboMul(3), 6);
    b.answer(false, 3000);
    expect(b.combo).toBe(0);
    expect(b.playerCastleHp).toBe(before);
  });

  it('연속 오답 2회에 DDA가 내려가고 보상이 30% 줄어든다', () => {
    const b = new Battle(stageDef(1));
    b.answer(false, 3000);
    b.answer(false, 3000);
    expect(b.dda.level).toBe(1);
    const gained = b.answer(true, 2000);
    expect(gained).toBeCloseTo(REWARD * 1.0 * 0.7, 6);
  });
});

describe('전투 불변식 (헤드리스 장기 실행)', () => {
  const scenarios: [string, number, number][] = [
    ['표준 플레이', 1, 0.85],
    ['풀 테크', 10, 0.95],
    ['일부러 지기', 6, 0.0],
  ];
  for (const [name, stage, acc] of scenarios) {
    it(`${name}: 불변식이 깨지지 않는다`, () => {
      const b = new Battle(stageDef(stage));
      const deck = defaultDeck(progressionAllies(stage).map((u) => u.id));
      let t = 0;
      while (b.status === 'playing' && t < MAX_SEC) {
        if (acc > 0 && Math.floor(t * 10) % 30 === 0) b.answer(Math.random() < acc, 2500);
        if (acc > 0) for (const id of deck) if (b.canSummon(id)) { b.summon(id); break; }
        b.step(DT);
        t = b.t;
        expect(b.money).toBeGreaterThanOrEqual(0);
        expect(b.castleHp).toBeLessThanOrEqual(b.stage.castleHp);
        expect(b.playerCastleHp).toBeLessThanOrEqual(b.stage.playerCastleHp);
        expect(b.units.every((u) => u.hp > 0)).toBe(true);
        expect(b.aliveAllies).toBeLessThanOrEqual(ALLY_CAP);
        expect(b.dda.level).toBeGreaterThanOrEqual(0);
        expect(b.dda.level).toBeLessThanOrEqual(3);
        expect(b.units.every((u) => u.x >= 0 && u.x <= MAP_LEN)).toBe(true);
      }
      expect(['win', 'lose', 'draw']).toContain(b.status);
    });
  }

  it('아무것도 하지 않으면 진다 (패배 경로가 실제로 동작)', () => {
    const b = new Battle(stageDef(6));
    while (b.status === 'playing') b.step(DT);
    expect(b.status).toBe('lose');
  });
});

describe('밸런스 게이트 (게임 코드 기준 재확인)', () => {
  it('정답 95% 봇은 필수 10판을 전부 클리어한다', () => {
    for (let st = 1; st <= 10; st++) {
      const b = playBot(st, 0.95, st * 17);
      expect(b.status, `ST${st}`).toBe('win');
      expect(b.t, `ST${st} 시간`).toBeLessThan(240);
    }
  });

  it('정답 60% 봇도 하드월 없이 필수 10판을 통과한다 (교육 게임 최우선 조건)', () => {
    for (let st = 1; st <= 10; st++) {
      let wins = 0;
      for (const seed of [1, 2, 3, 4, 5]) if (playBot(st, 0.6, seed * 31 + st).status === 'win') wins++;
      expect(wins, `ST${st} 승률 ${wins}/5`).toBeGreaterThanOrEqual(4);
    }
  });

  it('한 판에서 실제로 푸는 문항 수가 20개 이상이다', () => {
    const b = playBot(5, 0.95, 3);
    expect(b.solved).toBeGreaterThanOrEqual(20);
  });
});
