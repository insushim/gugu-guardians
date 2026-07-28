import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALLIES, ENEMIES, DECK_SIZE, ALLY_CAP, defaultDeck } from '../src/sim/units';
import { stageDef, allyGrowth, MAX_SEC, MAP_LEN } from '../src/sim/stages';
import { REWARD, START_MONEY, baseRegen, comboMul, DDA_MAX, DDA_REWARD_PENALTY, DDA_WRONG_TRIGGER } from '../src/sim/economy';

/**
 * 🔴 게임 코드와 밸런스 프로브가 어긋나면 GDD의 "실측 검증됨" 표가 통째로 무효가 된다.
 *    (v1.0에서 실제로 일어났다: 프로브가 덱 5기 제한을 구현하지 않은 채 표를 만들었다.)
 *    이 테스트가 두 진실원을 강제로 붙여 놓는다.
 */
const probe = readFileSync(new URL('../tools/balance-probe.mjs', import.meta.url), 'utf8');

function parseUnits(block: 'ALLIES' | 'ENEMIES') {
  const start = probe.indexOf(`const ${block} = [`);
  expect(start, `${block} 블록을 프로브에서 찾지 못함`).toBeGreaterThan(-1);
  const end = probe.indexOf('];', start);
  const body = probe.slice(start, end);
  const rows: Record<string, number | string>[] = [];
  for (const line of body.split('\n')) {
    const m = /\{\s*id:\s*'([^']+)'/.exec(line);
    if (!m) continue;
    const row: Record<string, number | string> = { id: m[1]! };
    for (const [, k, v] of line.matchAll(/(\w+):\s*(-?\d+(?:\.\d+)?)/g)) row[k!] = Number(v);
    rows.push(row);
  }
  return rows;
}

describe('밸런스 프로브 ↔ 게임 코드 데이터 정합', () => {
  it('아군 8종의 모든 수치가 프로브와 동일하다', () => {
    const p = parseUnits('ALLIES');
    expect(p.map((r) => r['id'])).toEqual(ALLIES.map((u) => u.id));
    for (const u of ALLIES) {
      const r = p.find((x) => x['id'] === u.id)!;
      expect({ id: u.id, cost: r['cost'], hp: r['hp'], atk: r['atk'], aspd: r['aspd'], range: r['range'], spd: r['spd'], cd: r['cd'], unlock: r['unlock'] })
        .toEqual({ id: u.id, cost: u.cost, hp: u.hp, atk: u.atk, aspd: u.aspd, range: u.range, spd: u.spd, cd: u.cd, unlock: u.unlock });
    }
  });

  it('적 5종의 모든 수치가 프로브와 동일하다 (순서 포함)', () => {
    const p = parseUnits('ENEMIES');
    expect(p.map((r) => r['id'])).toEqual(ENEMIES.map((e) => e.id));
    for (const e of ENEMIES) {
      const r = p.find((x) => x['id'] === e.id)!;
      expect({ hp: r['hp'], atk: r['atk'], aspd: r['aspd'], range: r['range'], spd: r['spd'] })
        .toEqual({ hp: e.hp, atk: e.atk, aspd: e.aspd, range: e.range, spd: e.spd });
    }
  });

  it('경제 상수가 프로브와 동일하다', () => {
    expect(probe).toContain(`const REWARD = ${REWARD};`);
    expect(probe).toContain(`let money = ${START_MONEY};`);
    expect(probe).toContain('5.8 + Math.min(1.6, (st - 1) * 0.2)');
    expect(baseRegen(1)).toBeCloseTo(5.8, 6);
    expect(baseRegen(9)).toBeCloseTo(7.4, 6);
    expect(baseRegen(20)).toBeCloseTo(7.4, 6);   // 상한 고정
  });

  it('DDA 상수가 프로브와 동일하다', () => {
    expect(probe).toContain(`DDA_MAX = ${DDA_MAX}`);
    expect(probe).toContain(`DDA_REWARD_PENALTY = ${DDA_REWARD_PENALTY}`);
    expect(probe).toContain(`wrongStreak >= ${DDA_WRONG_TRIGGER}`);
  });

  it('스테이지 공식이 프로브와 동일하다', () => {
    expect(probe).toContain('20500 * Math.pow(1.13, Math.min(st, 10) - 1)');
    expect(probe).toContain('3400 * Math.pow(1.13, Math.min(st, 10) - 1)');
    for (const st of [1, 5, 10]) {
      const s = stageDef(st);
      expect(s.castleHp).toBe(Math.round(20500 * Math.pow(1.13, st - 1)));
      expect(s.playerCastleHp).toBe(Math.round(3400 * Math.pow(1.13, st - 1)));
      expect(s.mult).toBeCloseTo(Math.pow(1.13, st - 1), 9);
      expect(allyGrowth(st)).toBeCloseTo(s.mult, 9);   // 🔴 적과 아군이 같은 배수
    }
    // 도전 스테이지는 ST10 기준 × 0.65
    expect(stageDef(11).castleHp).toBe(Math.round(20500 * Math.pow(1.13, 9) * 0.65));
    expect(stageDef(11).spawns.some((s) => s.id === 'e_boss')).toBe(true);
    expect(stageDef(10).spawns.some((s) => s.id === 'e_boss')).toBe(false);
  });

  it('스폰은 유한하다 (무한 스폰은 저성취 하드월의 구조적 원인)', () => {
    for (let st = 1; st <= 11; st++) {
      for (const s of stageDef(st).spawns) {
        expect(s.cap, `ST${st} ${s.id}`).toBeLessThan(99);
        expect(s.cap).toBeGreaterThan(0);
      }
    }
  });

  it('덱·상한 상수가 프로브와 동일하다', () => {
    expect(probe).toContain(`const DECK_SIZE = ${DECK_SIZE};`);
    expect(probe).toContain(`const ALLY_CAP = ${ALLY_CAP};`);
    expect(MAP_LEN).toBe(1000);
    expect(MAX_SEC).toBe(420);
    expect(probe).toContain('const MAP_LEN = 1000;');
    expect(probe).toContain('const MAX_SEC = 420;');
  });

  it('기본 덱은 항상 5기 이하이고 해금된 유닛만 포함한다', () => {
    for (let st = 1; st <= 11; st++) {
      const deck = defaultDeck(st);
      expect(deck.length).toBeLessThanOrEqual(DECK_SIZE);
      expect(new Set(deck).size).toBe(deck.length);
      for (const id of deck) {
        expect(ALLIES.find((u) => u.id === id)!.unlock).toBeLessThanOrEqual(Math.min(st, 10));
      }
    }
    expect(defaultDeck(10)).toHaveLength(5);
  });

  it('콤보 배율 경계가 표와 정확히 일치한다', () => {
    expect([0, 1, 2].map(comboMul)).toEqual([1.0, 1.0, 1.0]);
    expect([3, 4].map(comboMul)).toEqual([1.2, 1.2]);
    expect([5, 6, 7].map(comboMul)).toEqual([1.4, 1.4, 1.4]);
    expect([8, 20].map(comboMul)).toEqual([1.6, 1.6]);
  });
});
