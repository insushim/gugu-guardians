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
}

export type BattleStatus = 'playing' | 'win' | 'lose' | 'draw';

