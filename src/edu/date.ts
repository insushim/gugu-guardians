/**
 * 날짜 유틸 — 🔴 `toISOString().slice(0,10)` 금지.
 * UTC 변환이라 KST(+9)에서는 "로컬 자정으로 만든 Date"가 **항상 전날**로 밀린다.
 * 그러면 복습 예정일·학습 기록·주간 리포트가 통째로 하루 어긋나고,
 * "오늘 통계가 안 보인다"로만 드러나 발견이 늦다.
 */

export type DayStr = string; // "YYYY-MM-DD" (로컬 기준)

export function toDayStr(d: Date): DayStr {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromDayStr(s: DayStr): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function today(now: Date = new Date()): DayStr {
  return toDayStr(now);
}

/** 로컬 기준 n일 더하기. `addDays(x, 0) === x` 가 성립해야 한다(회귀 테스트 대상) */
export function addDays(s: DayStr, n: number): DayStr {
  const d = fromDayStr(s);
  d.setDate(d.getDate() + n);
  return toDayStr(d);
}

export function daysBetween(a: DayStr, b: DayStr): number {
  const ms = fromDayStr(b).getTime() - fromDayStr(a).getTime();
  return Math.round(ms / 86400000);
}

/** ISO 주 라벨 "2026-W30" — 주간 스냅샷 키 */
export function weekKey(s: DayStr): string {
  const d = fromDayStr(s);
  const day = (d.getDay() + 6) % 7; // 월=0
  d.setDate(d.getDate() - day + 3); // 목요일
  const year = d.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
