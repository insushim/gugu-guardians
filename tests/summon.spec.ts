import { describe, it, expect } from 'vitest';
import {
  summonOnce, summonTen, upgradeCost, canUpgrade, upgrade,
  probabilityTable, PITY_LEGEND, type Roster, type SummonState,
} from '../src/meta/summon';
import { ALLIES, ALLY_BY_ID, RARITIES, maxLevel, levelMult, rarityRank } from '../src/sim/units';

/** 결정론 RNG — 뽑기 테스트는 재현 가능해야 한다 */
function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const fresh = (): { roster: Roster; state: SummonState } => ({ roster: {}, state: { sinceLegend: 0, total: 0 } });

describe('소환 확률', () => {
  it('공시 확률의 합이 100%다', () => {
    const sum = probabilityTable().reduce((s, r) => s + r.percent, 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it('20,000회 실측 분포가 공시와 5%p 이내로 맞는다', () => {
    const { roster, state } = fresh();
    const rng = rngOf(4242);
    const N = 20000;
    const count: Record<string, number> = {};
    for (let i = 0; i < N; i++) {
      // 천장이 분포를 왜곡하지 않도록 매번 초기화한다(천장은 아래에서 따로 본다)
      state.sinceLegend = 0;
      const r = summonOnce(roster, state, rng);
      count[r.rarity] = (count[r.rarity] ?? 0) + 1;
    }
    for (const row of probabilityTable()) {
      const actual = ((count[row.id] ?? 0) / N) * 100;
      expect(Math.abs(actual - row.percent), `${row.name} 실측 ${actual.toFixed(2)}% vs 공시 ${row.percent}%`)
        .toBeLessThan(5);
    }
  });
});

describe('천장', () => {
  it(`전설 없이 ${PITY_LEGEND}번을 넘길 수 없다`, () => {
    for (const seed of [1, 7, 99, 12345]) {
      const { roster, state } = fresh();
      const rng = rngOf(seed);
      let gapMax = 0, gap = 0;
      for (let i = 0; i < 500; i++) {
        const r = summonOnce(roster, state, rng);
        if (r.rarity === 'legend') { gapMax = Math.max(gapMax, gap); gap = 0; }
        else gap++;
      }
      expect(gapMax, `시드 ${seed}`).toBeLessThan(PITY_LEGEND);
    }
  });

  it('10연에는 유니크 이상이 반드시 하나 들어간다', () => {
    const floor = rarityRank('unique');
    for (const seed of [2, 8, 55, 777, 31337]) {
      const { roster, state } = fresh();
      const out = summonTen(roster, state, rngOf(seed));
      expect(out).toHaveLength(10);
      expect(out.some((r) => rarityRank(r.rarity) >= floor), `시드 ${seed}`).toBe(true);
    }
  });
});

describe('보유와 조각', () => {
  it('처음 얻으면 보유, 중복이면 조각이 된다', () => {
    const { roster, state } = fresh();
    const rng = rngOf(11);
    let news = 0, dups = 0;
    for (let i = 0; i < 300; i++) {
      const r = summonOnce(roster, state, rng);
      if (r.isNew) { news++; expect(roster[r.unit.id]).toEqual({ level: 1, shards: 0 }); }
      else { dups++; expect(r.shards).toBeGreaterThan(0); }
    }
    expect(news).toBeGreaterThan(0);
    expect(dups).toBeGreaterThan(0);
    expect(Object.keys(roster).length).toBe(news);
    expect(Object.keys(roster).length).toBeLessThanOrEqual(ALLIES.length);
  });

  it('중복 조각 수는 등급 표와 일치한다', () => {
    const { roster, state } = fresh();
    const rng = rngOf(21);
    for (let i = 0; i < 400; i++) {
      const r = summonOnce(roster, state, rng);
      if (!r.isNew) {
        const expected = RARITIES.find((x) => x.id === r.rarity)!.shardOnDup;
        expect(r.shards).toBe(expected);
      }
    }
  });
});

describe('승급', () => {
  it('조각이 모자라면 올라가지 않는다', () => {
    const u = ALLY_BY_ID.get('kkachi')!;
    const e = { level: 1, shards: upgradeCost(2) - 1 };
    expect(canUpgrade(u, e)).toBe(false);
    expect(upgrade(u, e)).toBe(false);
    expect(e.level).toBe(1);
  });

  it('조각을 채우면 올라가고 그만큼 차감된다', () => {
    const u = ALLY_BY_ID.get('kkachi')!;
    const cost = upgradeCost(2);
    const e = { level: 1, shards: cost + 4 };
    expect(upgrade(u, e)).toBe(true);
    expect(e.level).toBe(2);
    expect(e.shards).toBe(4);
  });

  it('등급별 상한을 넘지 않는다', () => {
    for (const u of ALLIES) {
      const e = { level: 1, shards: 99999 };
      for (let i = 0; i < 40; i++) upgrade(u, e);
      expect(e.level, u.name).toBe(maxLevel(u.rarity));
      expect(canUpgrade(u, e)).toBe(false);
    }
  });

  it('레벨 1은 배율 1.0이고 레벨이 오를수록 커진다', () => {
    expect(levelMult(1)).toBe(1);
    expect(levelMult(0)).toBe(1);           // 손상값 방어
    expect(levelMult(2)).toBeGreaterThan(levelMult(1));
    expect(levelMult(15)).toBeGreaterThan(levelMult(10));
  });

  it('승급 비용은 단조 증가한다 — 뒤로 갈수록 싸지면 안 된다', () => {
    for (let lv = 3; lv <= 15; lv++) {
      expect(upgradeCost(lv)).toBeGreaterThan(upgradeCost(lv - 1));
    }
  });
});
