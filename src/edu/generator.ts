import type { QType } from './curriculum';
import { difficultyOf } from './curriculum';

/** 결정론 RNG (Mulberry32) — 테스트 재현성을 위해 시드를 받는다 */
export type Rng = () => number;
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

export interface Question {
  /** SRS 키로도 쓰인다: "M2:8x7" */
  key: string;
  type: QType;
  level: number;
  /** 화면에 보이는 식 (한글 UI 문자열은 여기 들어가지 않는다) */
  prompt: string;
  /** 보조 문구 — 무엇을 묻는지 (예: "나머지는?") */
  ask: string;
  answer: number;
  /** 정답 자릿수 — 자동 제출 판정에 쓴다. null이면 확인 버튼 필요 */
  digits: number | null;
  difficulty: number;
}

/** 유형별 레벨 범위 (1~5) */
export const MAX_LEVEL = 5;

function q(type: QType, level: number, prompt: string, ask: string, answer: number, keyBody: string): Question {
  const digits = String(answer).length;
  return {
    key: `${type}:${keyBody}`,
    type, level, prompt, ask, answer,
    digits,
    difficulty: difficultyOf(type, level),
  };
}

/**
 * 문항을 **절차적으로 생성**한다. 문제은행 파일도, 교재 전사도 없다.
 * → 교재 저작권 리스크를 현저히 낮춘다(0이라고 단정하지는 않는다).
 */
export function generate(type: QType, level: number, rng: Rng): Question {
  const L = Math.max(1, Math.min(MAX_LEVEL, level));
  switch (type) {
    case 'A1': {
      const hi = [4, 5, 6, 7, 8][L - 1]!;
      const a = pick(rng, 1, hi);
      const b = pick(rng, 1, Math.max(1, Math.min(hi, 9 - a)));
      return q(type, L, `${a} + ${b}`, '', a + b, `${a}+${b}`);
    }
    case 'S1': {
      const hi = [5, 6, 7, 8, 9][L - 1]!;
      const a = pick(rng, 2, hi);
      const b = pick(rng, 1, a - 1);
      return q(type, L, `${a} − ${b}`, '', a - b, `${a}-${b}`);
    }
    case 'A2': {
      const lo = [5, 5, 6, 6, 7][L - 1]!;
      const a = pick(rng, lo, 9);
      const b = pick(rng, 10 - a, 9); // 반드시 받아올림
      return q(type, L, `${a} + ${b}`, '', a + b, `${a}+${b}`);
    }
    case 'S2': {
      const a = pick(rng, 11, [14, 15, 16, 17, 18][L - 1]!);
      const ones = a % 10;
      const b = pick(rng, ones + 1, 9); // 반드시 받아내림
      return q(type, L, `${a} − ${b}`, '', a - b, `${a}-${b}`);
    }
    case 'M1': {
      const a = pick(rng, 2, 5);
      const b = pick(rng, [3, 5, 7, 9, 9][L - 1]! === 9 && L >= 4 ? 2 : 1, 9);
      return q(type, L, `${a} × ${b}`, '', a * b, `${a}x${b}`);
    }
    case 'M2': {
      const a = pick(rng, 6, 9);
      const b = pick(rng, L <= 2 ? 2 : 3, 9);
      return q(type, L, `${a} × ${b}`, '', a * b, `${a}x${b}`);
    }
    case 'M3': {
      const a = pick(rng, [12, 14, 16, 18, 24][L - 1]! - 8, [12, 14, 16, 18, 24][L - 1]!);
      const b = pick(rng, 2, L <= 2 ? 5 : 9);
      return q(type, L, `${a} × ${b}`, '', a * b, `${a}x${b}`);
    }
    case 'AS1': {
      const a = pick(rng, [12, 20, 30, 45, 60][L - 1]!, [29, 45, 60, 80, 95][L - 1]!);
      const b = pick(rng, 2, 9);
      if (rng() < 0.5) return q(type, L, `${a} + ${b}`, '', a + b, `${a}+${b}`);
      const bb = Math.min(b, a - 1);
      return q(type, L, `${a} − ${bb}`, '', a - bb, `${a}-${bb}`);
    }
    case 'AS2': {
      const a = pick(rng, [11, 20, 30, 40, 50][L - 1]!, [39, 55, 70, 85, 95][L - 1]!);
      const b = pick(rng, 11, Math.min(a, [29, 40, 55, 70, 85][L - 1]!));
      if (rng() < 0.5) return q(type, L, `${a} + ${b}`, '', a + b, `${a}+${b}`);
      return q(type, L, `${a} − ${b}`, '', a - b, `${a}-${b}`);
    }
    case 'D1': {
      const b = pick(rng, 2, L <= 2 ? 5 : 9);
      const ans = pick(rng, 2, 9);
      return q(type, L, `${b * ans} ÷ ${b}`, '', ans, `${b * ans}/${b}`);
    }
    case 'D2': {
      const b = pick(rng, 3, L <= 2 ? 5 : 9);
      const ans = pick(rng, 2, 9);
      const r = pick(rng, 1, b - 1);
      const total = b * ans + r;
      // 몫과 나머지를 한 번에 묻지 않는다 — 숫자패드 입력을 1개로 유지하기 위해 둘 중 하나만 묻는다
      if (rng() < 0.5) return q(type, L, `${total} ÷ ${b}`, '나머지는?', r, `${total}/${b}r`);
      return q(type, L, `${total} ÷ ${b}`, '몫은?', ans, `${total}/${b}q`);
    }
  }
}

/**
 * SRS 키("M2:8x7")로부터 **똑같은 문항을 복원**한다.
 * 복습은 "같은 문제를 다시" 풀려야 의미가 있으므로 키가 곧 문항이어야 한다.
 */
export function fromKey(key: string, level = 1): Question | null {
  const [typeRaw, body] = key.split(':');
  if (!typeRaw || !body) return null;
  const type = typeRaw as QType;
  let m: RegExpExecArray | null;
  if ((m = /^(\d+)\+(\d+)$/.exec(body))) {
    const a = +m[1]!, b = +m[2]!;
    return q(type, level, `${a} + ${b}`, '', a + b, body);
  }
  if ((m = /^(\d+)-(\d+)$/.exec(body))) {
    const a = +m[1]!, b = +m[2]!;
    return q(type, level, `${a} − ${b}`, '', a - b, body);
  }
  if ((m = /^(\d+)x(\d+)$/.exec(body))) {
    const a = +m[1]!, b = +m[2]!;
    return q(type, level, `${a} × ${b}`, '', a * b, body);
  }
  if ((m = /^(\d+)\/(\d+)([rq])?$/.exec(body))) {
    const a = +m[1]!, b = +m[2]!, mode = m[3];
    if (mode === 'r') return q(type, level, `${a} ÷ ${b}`, '나머지는?', a % b, body);
    if (mode === 'q') return q(type, level, `${a} ÷ ${b}`, '몫은?', Math.floor(a / b), body);
    return q(type, level, `${a} ÷ ${b}`, '', a / b, body);
  }
  return null;
}

/**
 * 최근 출제 이력을 피해 생성한다.
 * 레벨별 조합 수가 적은 유형(예: M2 level1 = 4×8)에서 같은 문제가 연속으로 나오는 것을 막는다.
 */
export function generateFresh(
  type: QType, level: number, rng: Rng, recentKeys: readonly string[], tries = 12,
): Question {
  let last = generate(type, level, rng);
  for (let i = 0; i < tries; i++) {
    if (!recentKeys.includes(last.key)) return last;
    last = generate(type, level, rng);
  }
  return last;
}
