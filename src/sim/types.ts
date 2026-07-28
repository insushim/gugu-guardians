import type { QType } from '../edu/curriculum';

/**
 * 시뮬레이션 코어 타입 — DOM/렌더러 의존 0.
 * 이 폴더(src/sim)와 src/edu는 브라우저 API를 import하지 않는다(headless 검증 전제).
 */

export type Side = 1 | -1; // 1 = 아군(셈지기), -1 = 적(엉킴괴수)

export interface UnitDef {
  id: string;
  name: string;
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
  /** 해금 스테이지 */
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
}

export interface StageDef {
  /** 1~10 = 필수, 11 = 선택 도전(보스) */
  index: number;
  name: string;
  /** 적 스탯 배율 */
  mult: number;
  /** 적 성 HP */
  castleHp: number;
  /** 아군 성 HP */
  playerCastleHp: number;
  spawns: SpawnEntry[];
  /** 이 판에서 출제할 문항 유형 */
  quizTypes: QType[];
  challenge: boolean;
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

export interface BattleSnapshot {
  t: number;
  money: number;
  combo: number;
  comboMul: number;
  ddaLevel: number;
  units: LiveUnit[];
  castleHp: number;
  castleMaxHp: number;
  playerCastleHp: number;
  playerCastleMaxHp: number;
  status: BattleStatus;
  solved: number;
  correct: number;
  /** 문항 응답에 쓴 누적 시간(ms) — 문항 밀도 지표용 */
  answerMs: number;
}
