import { RARITIES, SUMMON_POOL, RARITY_BY_ID, rarityRank, maxLevel } from '../sim/units';
import type { RarityId, UnitDef } from '../sim/types';

/**
 * 소환(뽑기)과 승급 — DOM 의존 0.
 *
 * 🔴 **현금 결제는 없다.** 소환 재화(먹물)는 문항 정답에서만 나온다.
 *    즉 이 게임의 전력 성장은 전부 "더 많이 맞히기"에서 온다. 어린이 대상이므로
 *    유료 확률형 아이템은 설계에서 배제한다 — 확률은 그래도 전부 공시한다.
 * 🔴 천장이 없으면 운이 나쁜 아이가 영원히 못 뽑는다. 학습 보상으로 쓰는 이상
 *    "노력이 반드시 결과가 되는" 상한선이 필요하다.
 */

export const SUMMON_COST = 120;
export const SUMMON_COST_TEN = 1080; // 10연 = 10% 할인
/** 이 횟수 안에 전설이 반드시 나온다 */
export const PITY_LEGEND = 60;
/** 10연에는 유니크 이상이 최소 1개 들어간다 */
const TEN_FLOOR: RarityId = 'unique';

export interface SummonResult {
  unit: UnitDef;
  rarity: RarityId;
  /** 처음 얻었는가 */
  isNew: boolean;
  /** 중복이라 조각으로 바뀐 수 (isNew면 0) */
  shards: number;
  /** 천장으로 확정된 결과인가 (연출·안내에 쓴다) */
  guaranteed: boolean;
}

export interface RosterEntry {
  level: number;
  shards: number;
}
export type Roster = Record<string, RosterEntry>;

export interface SummonState {
  /** 마지막 전설 이후 뽑은 횟수 */
  sinceLegend: number;
  /** 누적 소환 횟수 */
  total: number;
}

export type Rng = () => number;

const TOTAL_WEIGHT = RARITIES.reduce((s, r) => s + r.weight, 0);

/** 확률 공시용 표 — UI가 그대로 그린다 */
export function probabilityTable(): { id: RarityId; name: string; percent: number }[] {
  return RARITIES.map((r) => ({
    id: r.id,
    name: r.name,
    percent: Math.round((r.weight / TOTAL_WEIGHT) * 10000) / 100,
  }));
}

function rollRarity(rng: Rng, floor?: RarityId): RarityId {
  const pool = floor ? RARITIES.filter((r) => rarityRank(r.id) >= rarityRank(floor)) : RARITIES;
  const total = pool.reduce((s, r) => s + r.weight, 0);
  let t = rng() * total;
  for (const r of pool) {
    t -= r.weight;
    if (t <= 0) return r.id;
  }
  return pool[pool.length - 1]!.id;
}

function pickOfRarity(rng: Rng, rarity: RarityId): UnitDef {
  const list = SUMMON_POOL.filter((u) => u.rarity === rarity);
  // 등급에 유닛이 하나도 없으면 데이터가 깨진 것이다 — 조용히 넘어가면 원인 추적이 불가능해진다
  if (list.length === 0) throw new Error(`소환 풀에 등급 ${rarity} 유닛이 없다`);
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
}

/** 한 번 뽑는다. roster·state 를 제자리에서 갱신한다. */
export function summonOnce(
  roster: Roster,
  state: SummonState,
  rng: Rng,
  floor?: RarityId,
): SummonResult {
  const forced = state.sinceLegend + 1 >= PITY_LEGEND;
  const rarity = forced ? 'legend' : rollRarity(rng, floor);
  const unit = pickOfRarity(rng, rarity);

  state.total += 1;
  state.sinceLegend = rarity === 'legend' ? 0 : state.sinceLegend + 1;

  const held = roster[unit.id];
  if (!held) {
    roster[unit.id] = { level: 1, shards: 0 };
    return { unit, rarity, isNew: true, shards: 0, guaranteed: forced };
  }
  const gain = RARITY_BY_ID.get(rarity)?.shardOnDup ?? 5;
  held.shards += gain;
  return { unit, rarity, isNew: false, shards: gain, guaranteed: forced };
}

/** 10연 — 유니크 이상 1개를 보장한다 */
export function summonTen(roster: Roster, state: SummonState, rng: Rng): SummonResult[] {
  const out: SummonResult[] = [];
  for (let i = 0; i < 10; i++) {
    const last = i === 9;
    const needFloor = last && out.every((r) => rarityRank(r.rarity) < rarityRank(TEN_FLOOR));
    out.push(summonOnce(roster, state, rng, needFloor ? TEN_FLOOR : undefined));
  }
  return out;
}

/** 다음 레벨로 올리는 데 드는 조각 수 */
export function upgradeCost(nextLevel: number): number {
  return 3 + (Math.max(2, nextLevel) - 2) * 2;
}

export function canUpgrade(unit: UnitDef, entry: RosterEntry | undefined): boolean {
  if (!entry) return false;
  if (entry.level >= maxLevel(unit.rarity)) return false;
  return entry.shards >= upgradeCost(entry.level + 1);
}

/** 승급한다. 성공하면 true. */
export function upgrade(unit: UnitDef, entry: RosterEntry | undefined): boolean {
  if (!entry || !canUpgrade(unit, entry)) return false;
  entry.shards -= upgradeCost(entry.level + 1);
  entry.level += 1;
  return true;
}
