import type { QType } from './curriculum';
import { difficultyOf, TYPE_BY_ID } from './curriculum';

/**
 * 숙련도 추정 — Elo 방식.
 * IRT 대비 구현이 단순하고 온라인 갱신이 가능하며, 문항 난이도가 사전에 알려진
 * 초등 연산 도메인에 충분하다.
 *
 * 🔴 **prequential 순서 고정**: 예측(P) → 채점 → 갱신. 같은 응답으로 학습하고 채점하면
 *    어떤 게이트든 항상 통과한다.
 * 🔴 힌트·재도전으로 오염된 응답은 갱신에서 제외한다(`clean=false`).
 */

export type ThetaMap = Partial<Record<QType, number>>;

export const K_EARLY = 32;
export const K_LATE = 16;
export const K_SWITCH_AT = 20;
/** θ를 리포트에 노출하기 위한 최소 누적 응답 수 — 20문항으로는 신뢰구간이 너무 넓다 */
export const THETA_REPORT_MIN = 50;

export function expectedCorrect(theta: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - theta) / 400));
}

export function kFactor(attempts: number): number {
  return attempts < K_SWITCH_AT ? K_EARLY : K_LATE;
}

export interface UpdateInput {
  theta: number;
  b: number;
  attempts: number;
  correct: boolean;
  /** 힌트·재도전 없이 스스로 푼 응답만 true */
  clean: boolean;
}

export interface UpdateResult {
  /** 채점 **전에** 계산된 예측값 (prequential) */
  predicted: number;
  theta: number;
  updated: boolean;
}

export function updateTheta(input: UpdateInput): UpdateResult {
  const predicted = expectedCorrect(input.theta, input.b); // ① 예측 먼저
  if (!input.clean) return { predicted, theta: input.theta, updated: false };
  const k = kFactor(input.attempts);
  const delta = input.correct ? k * (1 - predicted) : -k * predicted; // ② 그 예측으로 갱신
  return { predicted, theta: input.theta + delta, updated: true };
}

/** 초기 θ: 진단 미측정 유형은 선수 유형 θ − 80 */
export function initialTheta(type: QType, known: ThetaMap): number {
  const meta = TYPE_BY_ID.get(type);
  if (!meta) return 1200;
  const known0 = known[type];
  if (known0 !== undefined) return known0;
  const fromPrereq = meta.prereq
    .map((p) => known[p])
    .filter((v): v is number => v !== undefined);
  if (fromPrereq.length) return Math.max(...fromPrereq) - 80;
  return meta.baseB - 60;
}

/**
 * 목표 정답률에 맞는 레벨을 고른다.
 * L1(전투 중) = 0.85(유창성) / L2(관문) = 0.60(도전)
 */
export function pickLevel(type: QType, theta: number, targetP: number, ddaLevel = 0): number {
  const adjusted = theta + ddaLevel * 70; // DDA 단계당 쉬운 쪽으로
  let best = 1;
  let bestGap = Infinity;
  for (let lv = 1; lv <= 5; lv++) {
    const p = expectedCorrect(adjusted, difficultyOf(type, lv));
    const gap = Math.abs(p - targetP);
    if (gap < bestGap) { bestGap = gap; best = lv; }
  }
  return best;
}
