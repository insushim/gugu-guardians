import { today, type DayStr } from '../edu/date';

/**
 * 오늘의 임무 — 하루치 짧은 목표 3개.
 *
 * 🔴 **왜 넣었나.** 메뉴는 "지금 하면 좋은 것" 한 줄(todayCard)만 있었고, 그건 *한 번*
 *    누르면 끝이라 한 세션의 길이를 정해 주지 못했다. 아이가 "어디까지 하면 오늘 몫을
 *    다 한 건지" 알 수 없으면 세션이 아무 데서나 끊긴다. 임무 3개는 그 끝선을 그려 준다.
 *
 * 🔴 **손실 회피는 쓰지 않는다 — 이 파일의 가장 중요한 제약이다.**
 *    `src/ui/screens.ts` 의 todayCard 주석이 정한 원칙 그대로다: 접속 연속일(스트릭),
 *    "오늘 안 하면 사라져요", 남은 시간 카운트다운 같은 장치는 **넣지 않는다.**
 *    대상이 초등 2~4학년이라 불안을 동력으로 쓰면 안 된다(교차검증 부적절 판정).
 *    그래서 여기 있는 것은 전부 **더 얻는 쪽**이다: 못 해도 잃는 것이 없고,
 *    안 한 임무는 다음 날 새 임무로 바뀔 뿐 벌칙이 없다.
 *    ⚠️ 나중에 "연속 며칠" 표시를 붙이고 싶어지면, 그건 이 원칙을 깨는 것이다.
 *
 * 🔴 임무는 **날짜에서 결정론적으로** 나온다. 저장하지 않으므로 세이브가 커지지 않고,
 *    기기를 바꿔도 같은 날이면 같은 임무다. 저장하는 것은 진행도뿐이다.
 */

/** 임무 한 종류의 정의 */
export interface MissionDef {
  id: string;
  /** 화면에 쓰는 말 — 목표 수를 넣어 완성한다 */
  label: (goal: number) => string;
  /** 목표 후보 — 날짜에 따라 하나가 골라진다 */
  goals: readonly number[];
  /** 다 하면 주는 먹물 */
  reward: number;
}

/**
 * 임무 풀.
 * 🔴 전부 **하다 보면 저절로 되는 것**으로 고른다. 임무 때문에 평소와 다르게 놀아야 하면
 *    그건 목표가 아니라 숙제다. 목표 수는 한 판(문항 11~83개, 실측)으로 한둘은 끝나고
 *    셋 다 하려면 두세 판이 되도록 잡았다.
 */
export const MISSIONS: readonly MissionDef[] = [
  { id: 'correct', label: (n) => `문제 ${n}개 맞히기`, goals: [20, 25, 30], reward: 30 },
  { id: 'clear', label: (n) => `길 ${n}개 깨기`, goals: [1, 2], reward: 30 },
  { id: 'srs', label: (n) => `엉킴 봉인 ${n}개 풀기`, goals: [3, 5], reward: 25 },
  { id: 'combo', label: (n) => `연속 정답 ${n}번 잇기`, goals: [5, 8], reward: 25 },
  { id: 'play', label: (n) => `전투 ${n}판 치르기`, goals: [2, 3], reward: 20 },
  { id: 'fast', label: (n) => `빠르게 맞히기 ${n}번`, goals: [10, 15], reward: 25 },
];

/** 하루에 나오는 임무 수 */
export const DAILY_N = 3;

/** 전부 끝냈을 때 얹어 주는 덤 */
export const DAILY_BONUS = 40;

/**
 * 날짜 문자열 → 정수 해시.
 * 🔴 `Date.parse` 를 쓰지 않는다 — 시간대에 따라 값이 흔들려 "같은 날인데 임무가 다른"
 *    현상이 난다. 글자만 보고 섞는다.
 */
function hashDay(day: DayStr): number {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Mission {
  id: string;
  text: string;
  goal: number;
  reward: number;
}

/**
 * 그날의 임무 3개. 같은 날이면 언제 불러도 같은 결과다.
 * 🔴 서로 다른 종류가 나오도록 **뽑은 것은 후보에서 뺀다.** 안 그러면 같은 임무가
 *    두 줄 나오는 날이 생긴다(모듈러 인덱스가 겹칠 때).
 */
export function missionsFor(day: DayStr = today()): Mission[] {
  const h = hashDay(day);
  const pool = [...MISSIONS];
  const out: Mission[] = [];
  for (let i = 0; i < DAILY_N && pool.length; i++) {
    const idx = (h >>> (i * 5)) % pool.length;
    const def = pool.splice(idx, 1)[0]!;
    const goal = def.goals[(h >>> (i * 3 + 17)) % def.goals.length]!;
    out.push({ id: def.id, text: def.label(goal), goal, reward: def.reward });
  }
  return out;
}

/** 세이브에 남는 것 — 진행도와 수령 여부뿐이다(임무 자체는 날짜에서 다시 만든다) */
export interface DailyState {
  date: DayStr;
  progress: number[];
  claimed: boolean[];
  /** 덤(전부 완료)까지 받았는가 */
  bonus: boolean;
}

export function emptyDaily(day: DayStr = today()): DailyState {
  return { date: day, progress: [0, 0, 0], claimed: [false, false, false], bonus: false };
}

/**
 * 날이 바뀌었으면 새 하루로 갈아 끼운다.
 * 🔴 **어제 못 받은 보상은 그냥 사라진다 — 그리고 그걸 알리지 않는다.**
 *    "어제 임무 놓쳤어요" 같은 말은 손실 회피 그 자체다. 새 임무만 조용히 놓는다.
 */
export function rollDaily(s: DailyState, day: DayStr = today()): DailyState {
  return s.date === day ? s : emptyDaily(day);
}

/**
 * 한 임무의 진행도를 올린다(상한은 목표치).
 *
 * 🔴 **누적(sum)과 최고기록(best)을 구분한다.** 연속 정답처럼 "한 번에 몇 번 이었나"를
 *    묻는 임무를 누적으로 세면, 3콤보짜리 판을 세 번 해서 "연속 정답 8번"이 달성된다.
 *    그건 임무가 물어본 것을 안 한 것이다. 그런 임무는 `best` 로 갱신한다.
 */
/** 최고기록으로 세는 임무 — 나머지는 전부 누적이다 */
const BEST_IDS = new Set(['combo']);

export function bump(s: DailyState, id: string, amount: number, day: DayStr = today()): DailyState {
  const rolled = rollDaily(s, day);
  const ms = missionsFor(day);
  const i = ms.findIndex((m) => m.id === id);
  if (i < 0 || amount <= 0) return rolled;
  const progress = [...rolled.progress];
  const cur = progress[i] ?? 0;
  progress[i] = Math.min(ms[i]!.goal, BEST_IDS.has(id) ? Math.max(cur, amount) : cur + amount);
  return { ...rolled, progress };
}

export const isDone = (s: DailyState, i: number, day: DayStr = today()): boolean =>
  (s.progress[i] ?? 0) >= (missionsFor(day)[i]?.goal ?? Infinity);

export const allDone = (s: DailyState, day: DayStr = today()): boolean =>
  missionsFor(day).every((_, i) => isDone(s, i, day));

/** 아직 안 받은 보상의 합 — 0이면 받을 게 없다 */
export function claimable(s: DailyState, day: DayStr = today()): number {
  const ms = missionsFor(day);
  let sum = 0;
  ms.forEach((m, i) => { if (isDone(s, i, day) && !s.claimed[i]) sum += m.reward; });
  if (allDone(s, day) && !s.bonus) sum += DAILY_BONUS;
  return sum;
}

/** 받을 수 있는 것을 전부 받는다. 돌려주는 값은 받은 먹물의 양. */
export function claim(s: DailyState, day: DayStr = today()): { state: DailyState; ink: number } {
  const ink = claimable(s, day);
  if (ink <= 0) return { state: s, ink: 0 };
  const claimed = missionsFor(day).map((_, i) => s.claimed[i] === true || isDone(s, i, day));
  return { state: { ...s, claimed, bonus: s.bonus || allDone(s, day) }, ink };
}
