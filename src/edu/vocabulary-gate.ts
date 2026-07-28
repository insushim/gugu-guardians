import type { QType } from './curriculum';
import { exceedsGrade, TYPE_BY_ID } from './curriculum';

/**
 * 학년 적합성 게이트 — **2단**.
 * 활동 난이도와 용어 학년은 다르다. 2학년이 3+3+3=9를 풀 수 있어도
 * 화면에 "배수"라고 쓰면 교육과정을 넘는다.
 */

/** 학년별 금지 용어 (그 학년 이하 프로필에서 화면에 나오면 안 되는 정식 교과 용어) */
export const BANNED_TERMS: Record<number, string[]> = {
  2: ['배수', '약수', '통분', '자연수', '분모', '분자', '소수점', '최소공배수', '최대공약수',
      '몫', '나머지', '나눗셈', '혼합 계산', '연산 순서', '방정식', '미지수', '비례'],
  3: ['통분', '최소공배수', '최대공약수', '혼합 계산', '연산 순서', '방정식', '미지수', '비례', '소수점'],
  4: ['최소공배수', '최대공약수', '방정식', '미지수', '비례식'],
};

/** UI에서 쓰면 안 되는 영문 약자 → 한글 (저학년 가독성) */
export const BANNED_ABBR: Record<string, string> = {
  HP: '체력', MP: '기력', LV: '단계', EXP: '경험', ATK: '공격', DEF: '방어', SP: '점수',
};

export interface VocabViolation {
  where: string;
  term: string;
  reason: string;
}

/** 문자열 묶음에서 금지 용어를 찾는다 */
export function scanTerms(entries: Record<string, string>, gradeMax: number): VocabViolation[] {
  const out: VocabViolation[] = [];
  const banned = BANNED_TERMS[gradeMax] ?? [];
  for (const [where, text] of Object.entries(entries)) {
    for (const term of banned) {
      if (text.includes(term)) out.push({ where, term, reason: `${gradeMax}학년 프로필에 교육과정 초과 용어` });
    }
    for (const abbr of Object.keys(BANNED_ABBR)) {
      if (new RegExp(`\\b${abbr}\\b`).test(text)) {
        out.push({ where, term: abbr, reason: `영문 약자 금지 → "${BANNED_ABBR[abbr]}"` });
      }
    }
  }
  return out;
}

/** 유형 자체가 학년을 넘는가 (혼합 계산 사례를 막는 게이트) */
export function scanTypes(types: readonly QType[], gradeMax: number): VocabViolation[] {
  return types
    .filter((t) => exceedsGrade(t, gradeMax))
    .map((t) => ({
      where: `type:${t}`,
      term: TYPE_BY_ID.get(t)?.label ?? t,
      reason: `유형의 시작 학년(${TYPE_BY_ID.get(t)?.gradeMin})이 프로필 상한(${gradeMax})을 초과`,
    }));
}
