/**
 * 문항 유형 체계 — 2022 개정 교육과정 '수와 연산' 영역 기반, MVP = 초등 2~4학년.
 * DOM 의존 0.
 *
 * 🔎 성취기준 코드([2수01-XX] 등)는 여기에 **추정으로 박지 않는다.**
 *    교육과정 원문 대조 후 `standardCode` 를 채운다. 비어 있는 것은 "미확정"이라는 뜻이다.
 *
 * 🔴 혼합 계산(3+4×2)은 **5~6학년군** 내용이므로 MVP에서 제외했다(교차검증 지적).
 *    활동이 쉬워 보여도 교육과정 진도를 앞당기면 위반이다.
 */

export type QType =
  | 'A1' | 'S1' | 'A2' | 'S2'
  | 'M1' | 'M2' | 'M3'
  | 'AS1' | 'AS2'
  | 'D1' | 'D2';

export interface TypeMeta {
  id: QType;
  label: string;
  /** 아이에게 보여줄 한 줄 설명 (학년 초과 용어 금지) */
  hint: string;
  /** 선수 유형 — 이걸 못 하면 출제하지 않는다 */
  prereq: QType[];
  /** 대상 학년(최소~최대). MVP 프로필이 2~4이므로 5 이상은 넣지 않는다 */
  gradeMin: number;
  gradeMax: number;
  /** Elo 난이도 기준점 (level 1). level 1단계당 +60 */
  baseB: number;
  /** 교육과정 성취기준 코드 — 원문 대조 후 채움. 빈 문자열 = 미확정 */
  standardCode: string;
}

export const TYPES: readonly TypeMeta[] = [
  { id: 'A1',  label: '한 자리 덧셈',     hint: '10보다 작은 덧셈',        prereq: [],            gradeMin: 1, gradeMax: 2, baseB: 1000, standardCode: '' },
  { id: 'S1',  label: '한 자리 뺄셈',     hint: '10보다 작은 뺄셈',        prereq: [],            gradeMin: 1, gradeMax: 2, baseB: 1020, standardCode: '' },
  { id: 'A2',  label: '받아올림 덧셈',    hint: '10을 넘는 덧셈',          prereq: ['A1'],        gradeMin: 2, gradeMax: 2, baseB: 1120, standardCode: '' },
  { id: 'S2',  label: '받아내림 뺄셈',    hint: '10을 넘는 수의 뺄셈',     prereq: ['S1', 'A2'],  gradeMin: 2, gradeMax: 2, baseB: 1180, standardCode: '' },
  { id: 'M1',  label: '곱셈구구 2~5단',   hint: '2단부터 5단까지',         prereq: ['A1'],        gradeMin: 2, gradeMax: 3, baseB: 1160, standardCode: '' },
  { id: 'AS1', label: '두 자리 ± 한 자리', hint: '두 자리 수에 더하고 빼기', prereq: ['A2', 'S2'],  gradeMin: 2, gradeMax: 3, baseB: 1260, standardCode: '' },
  { id: 'M2',  label: '곱셈구구 6~9단',   hint: '6단부터 9단까지',         prereq: ['M1'],        gradeMin: 2, gradeMax: 3, baseB: 1280, standardCode: '' },
  { id: 'D1',  label: '나눗셈',           hint: '곱셈구구를 거꾸로',       prereq: ['M2'],        gradeMin: 3, gradeMax: 4, baseB: 1360, standardCode: '' },
  { id: 'AS2', label: '두 자리 ± 두 자리', hint: '두 자리끼리 더하고 빼기',  prereq: ['AS1'],       gradeMin: 2, gradeMax: 3, baseB: 1380, standardCode: '' },
  { id: 'M3',  label: '두 자리 × 한 자리', hint: '두 자리 수의 곱셈',       prereq: ['M2'],        gradeMin: 3, gradeMax: 4, baseB: 1440, standardCode: '' },
  { id: 'D2',  label: '나머지가 있는 나눗셈', hint: '남는 수 구하기',       prereq: ['D1'],        gradeMin: 3, gradeMax: 4, baseB: 1500, standardCode: '' },
] as const;

export const TYPE_BY_ID = new Map(TYPES.map((t) => [t.id, t] as const));
export const ALL_TYPE_IDS: QType[] = TYPES.map((t) => t.id);

/** 유형×레벨의 Elo 난이도 */
export function difficultyOf(type: QType, level: number): number {
  const meta = TYPE_BY_ID.get(type);
  if (!meta) return 1200;
  return meta.baseB + (level - 1) * 60;
}

/** 프로필 학년 범위를 넘는 유형인가 (학년 초과 게이트) */
export function exceedsGrade(type: QType, gradeMax: number): boolean {
  const meta = TYPE_BY_ID.get(type);
  if (!meta) return true;
  return meta.gradeMin > gradeMax;
}

/** 선수 유형이 모두 열렸는가 */
export function prereqSatisfied(type: QType, opened: Set<QType>): boolean {
  const meta = TYPE_BY_ID.get(type);
  if (!meta) return false;
  return meta.prereq.every((p) => opened.has(p));
}
