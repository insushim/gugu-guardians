import rosterRaw from '../../data/roster.json';
import type { UnitDef, EnemyDef, RarityDef, RarityId } from './types';

/**
 * 셈지기(아군)·엉킴괴수(적) 정의.
 * 🔴 종수를 주석에 적지 않는다 — v1 주석은 "24종 · 12종"이라 적어 두고 실제로는 38·21 이었다.
 *    수를 알고 싶으면 `ALLIES.length` 를 읽으면 된다. 주석은 그럴 수 없는 것만 적는다.
 *
 * 🔴 수치는 `data/roster.json` **하나**에서 온다. tools/balance-probe.mjs 도 같은 파일을 읽는다.
 *    v1에서는 TS와 프로브에 값을 따로 적고 테스트로 대조했는데, 종류가 24개로 늘면
 *    그 방식은 드리프트를 못 막는다(대조가 통과해도 "둘 다 틀린" 경우는 못 잡는다).
 */

interface RosterFile {
  version: number;
  rarities: RarityDef[];
  slotsByRarity: Record<RarityId, number>;
  allies: UnitDef[];
  enemies: EnemyDef[];
  levelGain: number;
  deckSize: number;
  allyCap: number;
}

const roster = rosterRaw as unknown as RosterFile;

export const RARITIES: readonly RarityDef[] = roster.rarities;
export const ALLIES: readonly UnitDef[] = roster.allies;
export const ENEMIES: readonly EnemyDef[] = roster.enemies;

export const RARITY_BY_ID = new Map(RARITIES.map((r) => [r.id, r] as const));
export const ALLY_BY_ID = new Map(ALLIES.map((u) => [u.id, u] as const));
export const ENEMY_BY_ID = new Map(ENEMIES.map((e) => [e.id, e] as const));

/** 등급 서열 — 정렬·비교에 쓴다(도감·소환 연출) */
export const RARITY_ORDER: readonly RarityId[] = RARITIES.map((r) => r.id);
export function rarityRank(id: RarityId): number {
  return RARITY_ORDER.indexOf(id);
}

/** 승급 1레벨당 체력·공격력 증가율 */
export const LEVEL_GAIN = roster.levelGain;
/** 출전 덱 크기 */
export const DECK_SIZE = roster.deckSize;
/**
 * 전장 **자리** 상한. 마리 수가 아니라 자리 수다 — 등급이 높을수록 자리를 더 먹는다.
 * 🔴 마리 수로 세면 전설 18기를 쌓는 게 언제나 최적이 되어 덱 구성이 사라진다.
 */
export const ALLY_CAP = roster.allyCap;

export const SLOTS_BY_RARITY: Readonly<Record<RarityId, number>> = roster.slotsByRarity;

/** 이 셈지기가 전장에서 차지하는 자리 수 */
export function slotsOf(u: UnitDef): number {
  return Math.max(1, Math.floor(SLOTS_BY_RARITY[u.rarity] ?? 1));
}

/** 초당 피해량. 전설 특별기술의 평균 기여까지 넣어 센다(덱 추천이 전설을 저평가하지 않게) */
export function dps(u: UnitDef): number {
  const base = u.atk / Math.max(0.1, u.aspd);
  if (!u.skill || u.skill.every < 2) return base;
  // N타 중 1타가 mult 배 → 평균 배율 = (N-1 + mult) / N
  return base * ((u.skill.every - 1 + u.skill.mult) / u.skill.every);
}
/** 화력에 생존력을 약간 섞은 종합 점수 — 덱 추천용 */
export function power(u: UnitDef): number {
  return dps(u) * Math.sqrt(u.hp);
}

export function maxLevel(rarity: RarityId): number {
  return RARITY_BY_ID.get(rarity)?.maxLevel ?? 5;
}

/** 승급 배율 — 레벨 1이 기본값(1.0)이다 */
export function levelMult(level: number): number {
  return 1 + LEVEL_GAIN * (Math.max(1, level) - 1);
}

/**
 * 진도로 **무료 해금**되는 유닛(unlock ≥ 1).
 * unlock === 0 인 유닛은 소환으로만 얻는다 — 그래서 캠페인은 소환 없이도 끝까지 간다.
 */
export function progressionAllies(stage: number): UnitDef[] {
  return ALLIES.filter((u) => u.unlock >= 1 && u.unlock <= stage);
}

/** 소환 풀 — 전 유닛이 대상이다(진도 해금분도 포함, 중복은 조각이 된다) */
export const SUMMON_POOL: readonly UnitDef[] = ALLIES;

/**
 * 기본 덱 추천 — 보유분 중에서 **역할 커버리지**로 고른다: 물량·탱커·원거리·딜러2.
 * 🔴 등급 우선으로 고르면 안 된다. v2 작업 중 실제로 그렇게 짰다가 ST10 덱이
 *    [짚신이(30) + 장승(520)] 처럼 극단으로 갈려 전 구간이 전멸했다 —
 *    등급이 높은 유닛은 비싸서 자주 못 내고, 남은 최저가 유닛은 너무 약하다.
 * 🔴 "비싼 순"만으로 골라도 같은 이유로 무너진다(v1 실측).
 */
export function defaultDeck(ownedIds: readonly string[]): string[] {
  const owned = ALLIES.filter((u) => ownedIds.includes(u.id));
  if (owned.length === 0) return [];
  const pick: UnitDef[] = [];
  const take = (u: UnitDef | undefined): void => { if (u && !pick.includes(u)) pick.push(u); };
  const rest = (): UnitDef[] => owned.filter((u) => !pick.includes(u));

  // 1) 물량 — 가장 싼 것. 전선이 비지 않게 계속 흘려보내는 역할이다.
  take([...owned].sort((a, b) => a.cost - b.cost)[0]);
  // 2) 탱커 — 체력 가성비
  take([...rest()].sort((a, b) => b.hp / b.cost - a.hp / a.cost)[0]);
  // 3) 원거리 — 없으면 뒤에서 때릴 수단이 사라진다
  take([...rest()].filter((u) => u.range >= 150).sort((a, b) => dps(b) / b.cost - dps(a) / a.cost)[0]);
  // 4) 결정타 — **절대 화력**이 가장 센 것. 가성비로 고르면 안 되는 자리다:
  //    싼 유닛은 쿨다운 때문에 초당 쓸 수 있는 셈력(cost/cd)에 상한이 있어서,
  //    후반에는 돈이 남아돌아도 못 쓴다. 비싼 유닛은 그 잉여를 화력으로 바꾸는 역할이다.
  //    🔴 v2 작업 중 이 자리를 가성비로 뒀더니 덱이 7판 이후 영원히 고정됐다 —
  //       해금이 15종으로 늘어도 실제로 쓰이는 건 5종뿐이었다(실측).
  take([...rest()].sort((a, b) => power(b) - power(a))[0]);
  // 5) 나머지 한 자리는 가성비
  for (const u of [...rest()].sort((a, b) => power(b) / b.cost - power(a) / a.cost)) {
    if (pick.length >= DECK_SIZE) break;
    take(u);
  }
  return pick.slice(0, DECK_SIZE).map((u) => u.id);
}

/**
 * 저장된 덱을 지금 보유 상태에 맞춰 손본다 — **지금 없는 유닛을 빼고, 남는 칸을 채운다.**
 *
 * 🔴 저장된 덱을 그대로 쓰면, 1판에서 3기를 고른 아이가 6판·8판까지 그 3기로 싸운다.
 *    그 사이 새로 얻은 셈지기는 칸이 비어 있는데도 안 들어간다(실측: 보유 7명·덱 3/5).
 *    "새 셈지기를 얻었다"는 보상이 전장에 아무 영향도 못 주고, 밸런스 게이트는 이걸 못 본다 —
 *    프로브는 판마다 `defaultDeck(보유 전부)` 로 최선의 5기를 새로 짜기 때문이다.
 * 🔴 고른 것을 빼지는 않는다. 채우는 순서는 `defaultDeck` 과 같다(역할 균형이 유지된다).
 */
export function reconcileDeck(saved: readonly string[], ownedIds: readonly string[]): string[] {
  const owned = new Set(ownedIds);
  const out = saved.filter((id) => owned.has(id)).slice(0, DECK_SIZE);
  if (out.length === 0) return defaultDeck(ownedIds);
  for (const id of defaultDeck(ownedIds)) {
    if (out.length >= DECK_SIZE) break;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
