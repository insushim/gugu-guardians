import type { QType } from './curriculum';
import { THETA_REPORT_MIN } from './mastery';

/**
 * 학습 성과 지표 — 부모/교사에게 보여줄 5지표를 **저장된 원시 데이터로부터** 계산한다.
 * 🔴 지표를 선언만 하고 원시 필드를 스키마에 넣지 않으면 계산 자체가 불가능하다(v1.0의 실수).
 */

export interface TypeStat {
  attempts: number;
  correct: number;
  /** 정답 ∧ 응답 ≤ 3초 — 자동화(fluency) 판정 */
  correctFast: number;
  /** 응답에 쓴 누적 시간(ms) */
  answerMs: number;
}

export const FAST_MS = 3000;

export function emptyStat(): TypeStat {
  return { attempts: 0, correct: 0, correctFast: 0, answerMs: 0 };
}

export function recordAnswer(s: TypeStat, correct: boolean, ms: number): TypeStat {
  return {
    attempts: s.attempts + 1,
    correct: s.correct + (correct ? 1 : 0),
    correctFast: s.correctFast + (correct && ms <= FAST_MS ? 1 : 0),
    answerMs: s.answerMs + Math.max(0, ms),
  };
}

export const accuracy = (s: TypeStat) => (s.attempts ? s.correct / s.attempts : 0);
/** 자동화율 = 빠르고 정확하게 답한 비율 */
export const automaticity = (s: TypeStat) => (s.attempts ? s.correctFast / s.attempts : 0);

/** 문항 밀도 = 문항 응답 구간 / 총 플레이 시간. 상품의 핵심 지표(목표 ≥ 0.40) */
export function questionDensity(totalAnswerMs: number, totalPlayMs: number): number {
  if (totalPlayMs <= 0) return 0;
  return Math.min(1, totalAnswerMs / totalPlayMs);
}

export interface RetentionEntry { key: string; ok: boolean }
/** 파지율 = '완성' 도달 후 재검에서 맞힌 비율 */
export function retention(log: readonly RetentionEntry[]): number {
  if (!log.length) return 0;
  return log.filter((e) => e.ok).length / log.length;
}

/** θ는 표본이 충분할 때만 노출한다 — 20문항으로는 신뢰구간이 너무 넓다 */
export function thetaDisplayable(attempts: number): boolean {
  return attempts >= THETA_REPORT_MIN;
}

export interface WeeklySnapshot { week: string; theta: Partial<Record<QType, number>> }

/** 주력 유형의 4주 변화폭 */
export function thetaDelta(snaps: readonly WeeklySnapshot[], type: QType, weeks = 4): number | null {
  if (snaps.length < 2) return null;
  const recent = snaps.slice(-weeks);
  const first = recent[0]?.theta[type];
  const last = recent[recent.length - 1]?.theta[type];
  if (first === undefined || last === undefined) return null;
  return Math.round(last - first);
}

/** 취약 유형 = 시도 10회 이상이면서 정답률이 가장 낮은 순 */
export function weakTypes(stats: Partial<Record<QType, TypeStat>>, n = 3): QType[] {
  return (Object.entries(stats) as [QType, TypeStat][])
    .filter(([, s]) => s.attempts >= 10)
    .sort((a, b) => accuracy(a[1]) - accuracy(b[1]))
    .slice(0, n)
    .map(([t]) => t);
}
