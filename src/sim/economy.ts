/**
 * 셈력(자원) · 콤보 · DDA — 순수 로직. DOM 의존 0.
 * 수치는 tools/balance-probe.mjs 와 1:1 (tests/data-parity.spec.ts 가 대조).
 */

/** 정답 1회 기본 보상 */
export const REWARD = 46;
/** 시작 소지금 — 초반 연속 오답이 회복 불가 나선이 되지 않게 하는 완충 */
export const START_MONEY = 200;
/** 콤보로 인정하지 않는 최소 응답 시간(ms) — **연타 방지용**.
 *  🔴 유창성(빠르고 정확하게)을 기르는 게임에서 "빨리 답했다"를 벌하면 목표와 정면으로 어긋난다.
 *  문제를 읽고 누르는 최소 시간보다도 짧은 구간(진짜 연타)만 걸러낸다. */
export const MIN_ANSWER_MS = 250;

/** 자동 충전 바닥선: ST1 5.8/s → ST9+ 7.4/s
 *  🔴 바닥선을 스테이지와 함께 크게 키우면 후반에도 '찍기'가 통한다(실측). 성장은 학습 보상 쪽에만. */
export function baseRegen(stage: number): number {
  return 5.8 + Math.min(1.6, (stage - 1) * 0.2);
}

/** 직전 연속 정답 수 기준 배율 */
export function comboMul(combo: number): number {
  if (combo >= 8) return 1.6;
  if (combo >= 5) return 1.4;
  if (combo >= 3) return 1.2;
  return 1.0;
}

// ── DDA (적응형 난이도) ────────────────────────────────────────────────────
/** 연속 오답 2회마다 1단계 하향, 최대 3단계 */
export const DDA_WRONG_TRIGGER = 2;
export const DDA_RIGHT_RECOVER = 3;
export const DDA_MAX = 3;
/** 1단계당 출제 난이도 하향폭(Elo 점) */
export const DDA_STEP_ELO = 70;
/** 1단계당 보상 감소 — 쉬운 문제로 자원을 파밍하는 경로를 막는다 */
export const DDA_REWARD_PENALTY = 0.3;

export interface DdaState {
  level: number;
  wrongStreak: number;
  rightStreak: number;
}

export function newDda(): DdaState {
  return { level: 0, wrongStreak: 0, rightStreak: 0 };
}

/** 정오답 1건을 반영해 새 DDA 상태를 돌려준다(순수 함수) */
export function stepDda(s: DdaState, correct: boolean): DdaState {
  if (correct) {
    const rightStreak = s.rightStreak + 1;
    if (rightStreak >= DDA_RIGHT_RECOVER && s.level > 0) {
      return { level: s.level - 1, wrongStreak: 0, rightStreak: 0 };
    }
    return { level: s.level, wrongStreak: 0, rightStreak };
  }
  const wrongStreak = s.wrongStreak + 1;
  if (wrongStreak >= DDA_WRONG_TRIGGER && s.level < DDA_MAX) {
    return { level: s.level + 1, wrongStreak: 0, rightStreak: 0 };
  }
  return { level: s.level, wrongStreak, rightStreak: 0 };
}

/** 정답 보상 = 기본 × 콤보배율 × (1 − DDA 단계 × 0.3) */
export function rewardFor(combo: number, ddaLevel: number): number {
  const mul = Math.max(0, 1 - ddaLevel * DDA_REWARD_PENALTY);
  return REWARD * comboMul(combo) * mul;
}
