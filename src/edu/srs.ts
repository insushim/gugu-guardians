import { addDays, today, type DayStr } from './date';

/**
 * SRS (간격 반복) — **벽시계(일) 기준**.
 * 🔴 간격을 "판 수"로 정의하면 한 세션에 다 소진할 수 있어 장기 파지를 전혀 측정하지 못한다.
 */

export type SrsState = '학습중' | '익힘' | '다짐' | '완성';

export interface SrsItem {
  key: string;
  state: SrsState;
  /** 🔴 현재까지 연속 정답 수. 이 필드가 없으면 1회 맞히고 앱을 끄는 순간 진행이 조용히 리셋된다. */
  streak: number;
  /** 이 날짜 이후에 다시 출제한다 */
  dueAt: DayStr;
  /** 라운드로빈 티켓 — tail starvation 방지 */
  lastServedAt: DayStr;
}

const INTERVAL: Record<SrsState, number> = { 학습중: 1, 익힘: 3, 다짐: 7, 완성: 21 };
const NEXT: Record<SrsState, SrsState> = { 학습중: '익힘', 익힘: '다짐', 다짐: '완성', 완성: '완성' };
export const PROMOTE_STREAK = 2;

export function newItem(key: string, now: DayStr = today()): SrsItem {
  return { key, state: '학습중', streak: 0, dueAt: now, lastServedAt: now };
}

/**
 * 정오답 1건 반영. 🔴 큐에서 항목을 제거하지 않는다(상태 필드만 갱신).
 * `splice`로 빼면 채점 때 못 찾아 승급 로직이 조용히 죽는다(과거 실측: 문서엔 3→7→15인데 실제는 3→3→3).
 */
export function review(item: SrsItem, correct: boolean, now: DayStr = today()): SrsItem {
  if (!correct) {
    return { ...item, state: '학습중', streak: 0, dueAt: addDays(now, INTERVAL['학습중']), lastServedAt: now };
  }
  const streak = item.streak + 1;
  if (streak >= PROMOTE_STREAK && item.state !== '완성') {
    const state = NEXT[item.state];
    return { ...item, state, streak: 0, dueAt: addDays(now, INTERVAL[state]), lastServedAt: now };
  }
  return { ...item, streak, dueAt: addDays(now, INTERVAL[item.state]), lastServedAt: now };
}

export function isDue(item: SrsItem, now: DayStr = today()): boolean {
  return item.dueAt <= now;
}

/**
 * 오늘 복습할 항목을 고른다.
 * 🔴 `slice(0, N)` 고정으로 자르면 새 오답이 앞에 쌓여 오래된 항목이 영구 미출제된다.
 *    가장 오래 안 나온 순(lastServedAt)으로 정렬해 라운드로빈을 보장한다.
 */
export function dueQueue(items: Iterable<SrsItem>, limit: number, now: DayStr = today()): SrsItem[] {
  return [...items]
    .filter((it) => isDue(it, now))
    .sort((a, b) => (a.lastServedAt < b.lastServedAt ? -1 : a.lastServedAt > b.lastServedAt ? 1 : a.key < b.key ? -1 : 1))
    .slice(0, limit);
}
