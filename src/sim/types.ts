import type { QType } from '../edu/curriculum';

/**
 * 시뮬레이션 코어 타입 — DOM/렌더러 의존 0.
 * 이 폴더(src/sim)와 src/edu는 브라우저 API를 import하지 않는다(headless 검증 전제).
 */

export type Side = 1 | -1; // 1 = 아군(셈지기), -1 = 적(엉킴괴수)

export type RarityId = 'normal' | 'rare' | 'unique' | 'epic' | 'legend';

export interface RarityDef {
  id: RarityId;
  name: string;
  /** 카드 테두리·글로우 색 */
  color: string;
  /** 승급 상한 레벨 */
  maxLevel: number;
  /** 소환 가중치 (합 1000 = 천분율) */
  weight: number;
  /** 중복으로 나왔을 때 주는 조각 수 */
  shardOnDup: number;
}

/**
 * 전설 셈지기의 특별기술 — **N번째 공격마다** 터진다.
 * 🔴 확률로 두지 않는다. 시뮬은 결정론이어야 프로브·parity 테스트가 성립하고,
 *    아이 입장에서도 "몇 대 때리면 나온다"가 눈에 보이는 편이 낫다(운이 아니라 리듬).
 */
export interface UnitSkill {
  name: string;
  /** 몇 번째 공격마다 터지는가(≥2) */
  every: number;
  /** 그때 공격력 배율 */
  mult: number;
  /** 그때 광역 반경 */
  aoe: number;
}

export interface UnitDef {
  id: string;
  name: string;
  rarity: RarityId;
  cost: number;
  hp: number;
  atk: number;
  /** 공격 주기(초) */
  aspd: number;
  /** 사거리(px) */
  range: number;
  /** 이동 속도(px/s) */
  spd: number;
  /** 재소환 쿨다운(초) */
  cd: number;
  /** 진도 해금 스테이지. **0 이면 소환 전용**(캠페인 진행만으로는 얻지 못한다) */
  unlock: number;
  /** 한 줄 설명(도감·덱 UI) */
  role: string;
  /** 평타 광역 반경(월드 단위). 없으면 단일 대상 */
  aoe?: number;
  /** 전설 전용 특별기술 */
  skill?: UnitSkill;
}

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  atk: number;
  aspd: number;
  range: number;
  /** 0 이면 고정형(수문장) */
  spd: number;
  role: string;
  /** 평타 광역 반경 — 뭉쳐 선 아군을 통째로 때린다 */
  aoe?: number;
  /** 피해 감산(고정값). 약한 물량이 통하지 않게 하는 장치 */
  armor?: number;
  /** 태생 돌파형 — 단계와 무관하게 전선을 지나쳐 성으로 간다 */
  breaker?: boolean;
  /** 쓰러질 때 갈라져 나오는 새끼 */
  split?: { id: string; n: number };
}

export interface SpawnEntry {
  id: string;
  /** 최초 등장 시각(초) */
  t0: number;
  /** 재등장 주기(초) */
  every: number;
  /** 한 판 총 등장 수 — 🔴 유한해야 한다(무한 스폰은 느린 플레이어에게 죽음의 나선) */
  cap: number;
  /** 체력 보정 — 수문장이 구역마다 같은 체력을 갖게 맞춘다(기본 1) */
  hpMul?: number;
}

export interface StageDef {
  /** 1부터 무한 */
  index: number;
  /** 구역 번호(10판 묶음) */
  chapter: number;
  /** 구역 안에서의 위치 1~10 */
  pos: number;
  name: string;
  /** 구역 이름 */
  chapterName: string;
  /** 배경 키 */
  bg: string;
  /** 적 스탯 배율 */
  mult: number;
  /** 적 성 HP */
  castleHp: number;
  /** 아군 성 HP */
  playerCastleHp: number;
  spawns: SpawnEntry[];
  /** 이 판에서 출제할 문항 유형 */
  quizTypes: QType[];
  /** 구역의 마지막 판(보스) */
  boss: boolean;
  /** 캠페인 구간(1~CAMPAIGN_STAGES) 밖 = 무한 도전 */
  endless: boolean;
}

export interface LiveUnit {
  uid: number;
  side: Side;
  defId: string;
  x: number;
  hp: number;
  maxHp: number;
  atk: number;
  aspd: number;
  range: number;
  spd: number;
  /** 다음 공격 가능 시각(초) */
  atkAt: number;
  /** 렌더 전용: 마지막 피격 시각(틴트) */
  hurtAt: number;
  /** 렌더 전용: 마지막 공격 시각(스윙) */
  swingAt: number;
  /**
   * 돌파형 — 아군 전선과 교전하지 않고 **지나쳐 성으로 직행**한다.
   * 맞기는 맞으므로 살아서 도달할지는 우리 전선의 화력에 달렸다(맷집이 아니라).
   */
  breaker?: boolean;
  /** 광역 공격 반경(월드 단위). 0/undefined 면 단일 대상 */
  aoe?: number;
  /** 피해 감산(적 전용). 최소 피해는 strike() 가 보장한다 */
  armor?: number;
  /** 지금까지 때린 횟수 — 전설 특별기술의 주기를 세는 데 쓴다 */
  hits?: number;
  /** 전설 특별기술(해석된 사본) */
  skill?: UnitSkill;
  /** 렌더 전용: 마지막 특별기술 시각 */
  skillAt?: number;
  /** 쓰러질 때 갈라져 나오는 새끼(적 전용) */
  split?: { id: string; n: number };
  /** 전장에서 차지하는 자리 수(아군 전용, 기본 1) */
  slots?: number;
}

export type BattleStatus = 'playing' | 'win' | 'lose' | 'draw';

