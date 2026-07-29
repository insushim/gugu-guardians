import rosterRaw from '../../data/roster.json';
import type { UnitDef, EnemyDef, RarityDef, RarityId } from './types';

/**
 * 셈지기(아군) 24종 · 엉킴괴수(적) 12종.
 *
 * 🔴 수치는 `data/roster.json` **하나**에서 온다. tools/balance-probe.mjs 도 같은 파일을 읽는다.
 *    v1에서는 TS와 프로브에 값을 따로 적고 테스트로 대조했는데, 종류가 24개로 늘면
 *    그 방식은 드리프트를 못 막는다(대조가 통과해도 "둘 다 틀린" 경우는 못 잡는다).
 */

interface RosterFile {
  version: number;
  rarities: RarityDef[];
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
/** 동시 출전 상한 — 없으면 유닛이 무한 누적된다 */
export const ALLY_CAP = roster.allyCap;

/** 초당 피해량 */
export function dps(u: UnitDef): number {
  return u.atk / Math.max(0.1, u.aspd);
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
