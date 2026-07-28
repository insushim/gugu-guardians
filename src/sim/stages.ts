import type { StageDef, SpawnEntry } from './types';
import type { QType } from '../edu/curriculum';

/** 필수 진행 스테이지 수 (11은 선택 도전) */
export const REQUIRED_STAGES = 10;
export const CHALLENGE_STAGE = 11;
export const MAP_LEN = 1000;
/** 한 판 상한(초) — 교착 방지 */
export const MAX_SEC = 420;

const STAGE_NAMES: Record<number, string> = {
  1: '첫걸음 들판',
  2: '셈바람 언덕',
  3: '물음표 숲',
  4: '구구단 어귀',
  5: '해태 고개',
  6: '여섯일곱 골짜기',
  7: '여덟아홉 성벽',
  8: '뒤엉킨 저잣거리',
  9: '나눗셈 동굴',
  10: '구구성 앞뜰',
  11: '뒤죽박죽 왕좌',
};

/** 스테이지별 주력 문항 유형 (선수학습 순서를 따른다 — src/edu/curriculum.ts) */
const STAGE_QUIZ: Record<number, QType[]> = {
  1: ['A1', 'S1'],
  2: ['A1', 'S1', 'A2'],
  3: ['A2', 'S2'],
  4: ['M1'],
  5: ['M1', 'A2', 'S2'],
  6: ['M2'],
  7: ['M1', 'M2'],
  8: ['AS1', 'M2'],
  9: ['D1'],
  10: ['M2', 'D1', 'AS2'],
  11: ['M2', 'D1', 'M3'],
};

/** 배경 키 (챕터 느낌 전환) */
export function stageBackground(index: number): 'bg_field' | 'bg_wall' | 'bg_cave' {
  if (index <= 4) return 'bg_field';
  if (index <= 8) return 'bg_wall';
  return 'bg_cave';
}

/**
 * 🔴 아군 성장('셈나라 기운')은 진도 연동 **자동**이다 — 재화로 구매하지 않는다.
 *    구매식으로 두면 필요 재화가 획득 가능량의 40배가 되어 경제가 성립하지 않는다(실측).
 */
export function allyGrowth(index: number): number {
  return Math.pow(1.13, Math.min(index, REQUIRED_STAGES) - 1);
}

export function stageDef(index: number): StageDef {
  const s = Math.min(index, REQUIRED_STAGES);
  const mult = Math.pow(1.13, s - 1);
  const challenge = index === CHALLENGE_STAGE;

  // 🔴 스폰은 유한하다. 무한 반복으로 두면 느린 플레이어일수록 적이 누적돼
  //    "못하면 더 불리해지는" 죽음의 나선이 생긴다(저성취 하드월의 구조적 원인).
  const spawns: SpawnEntry[] = [
    { id: 'e_mul', t0: 3, every: Math.max(4.5, 9 - s * 0.45), cap: 8 + s },
  ];
  if (s >= 2) spawns.push({ id: 'e_bat',  t0: 14, every: Math.max(6,  13 - s * 0.5), cap: Math.round(3 + s * 0.7) });
  if (s >= 4) spawns.push({ id: 'e_arch', t0: 24, every: Math.max(9,  20 - s * 0.7), cap: Math.round(1 + s * 0.5) });
  if (s >= 6) spawns.push({ id: 'e_rock', t0: 52, every: Math.max(18, 36 - s * 1.2), cap: Math.round(s * 0.4) });
  if (challenge) spawns.push({ id: 'e_boss', t0: 40, every: 9999, cap: 1 });

  return {
    index,
    name: STAGE_NAMES[index] ?? `${index}번째 길`,
    mult,
    castleHp: Math.round(20500 * Math.pow(1.13, s - 1) * (challenge ? 0.65 : 1)),
    playerCastleHp: Math.round(3400 * Math.pow(1.13, s - 1)),
    spawns,
    quizTypes: STAGE_QUIZ[index] ?? ['M2'],
    challenge,
  };
}

export const ALL_STAGES: StageDef[] = Array.from({ length: CHALLENGE_STAGE }, (_, i) => stageDef(i + 1));
