/**
 * 주간 순위 — **클라이언트와 서버가 공유하는 단일 계약**.
 *
 * 🔴 이 파일이 존재하는 이유: 처음엔 별명 목록 길이·UUID 정규식·주 계산이 앱과 워커에
 *    각각 복붙돼 있었다. "둘이 같아야 한다"고 주석만 달려 있고 강제하는 건 없었다.
 *    그 상태에서 한쪽만 고치면 특정 별명을 뽑은 아이의 제출만 조용히 거절되고,
 *    타입체크·린트·테스트 어느 것도 잡지 못한다. 그래서 진실원을 하나로 합쳤다.
 *
 * Cloudflare 전용 타입에 의존하지 않는다 — 브라우저 번들과 워커 양쪽에 그대로 들어간다.
 */

export const TOP_N = 30;
export const KEEP_WEEKS = 8;
export const WEEK_MS = 7 * 24 * 3600 * 1000;

/** 제출 빈도 제한 — 같은 기기가 이보다 자주 보내면 값을 갱신하지 않는다 */
export const MIN_SUBMIT_GAP_MS = 15_000;

/**
 * 정답 1개당 최소 소요 시간.
 * 프로브 실측 최속이 문항당 약 2.6초(63초에 24문항)라 1.5초면 아직 1.7배 여유다.
 * 🔴 예전 값(900ms)은 실측의 3배나 헐거워서, 시간 상한이 표시 상한(MAX.correct)보다
 *    커져 버려 방어가 아예 작동하지 않았다 — 테스트가 그걸 잡았다.
 */
export const MIN_MS_PER_CORRECT = 1_500;

/** 판 하나를 깨는 최소 시간. 프로브 실측 최속이 63초라 35초는 넉넉한 하한이다 */
export const MIN_MS_PER_STAGE = 35_000;

/**
 * 그 주의 **첫 제출**에만 주는 시간 여유.
 *
 * 동의를 켠 뒤에는 매 전투가 끝날 때마다 제출하므로, 그 주 첫 제출 시점의 누적은
 * 보통 한 판 분량(문항 25개 안팎)이다. "한참 하다가 나중에 순위를 켠" 경우를 감안해도
 * 20분이면 800문항까지 인정되어 정직한 아이가 걸릴 일이 없다.
 * 두 번째 제출부터는 **서버 자기 시계**로 잰 경과 시간만 인정한다.
 *
 * 🔴 이 값이 크면 시간 상한이 표시 상한을 넘어가 방어가 통째로 무의미해진다.
 *    `FIRST_GRACE_MS / MIN_MS_PER_CORRECT < MAX.correct` 를 테스트가 강제한다.
 */
export const FIRST_GRACE_MS = 20 * 60 * 1000;

/**
 * 그 주 첫 제출이 주장할 수 있는 최대 도달 판.
 * 프로브 실측 도달 한계가 ST60(전설 확보·승급)이라 100이면 충분한 여유다.
 * 그 이상은 서버가 경과 시간을 재며 지켜본 만큼만 올라간다.
 */
export const MAX_FIRST_STAGE = 100;

/**
 * 한 주에 받아 줄 최대 기기 수. 넘으면 **새 기기만** 거절하고 기존 참가자는 계속 갱신된다.
 * 스크립트로 매번 새 UUID를 만들어 순위표를 도배하는 어뷰징의 상한이다(교실 규모의 60배).
 */
export const MAX_DEVICES_PER_WEEK = 3_000;

/**
 * 표시 상한 — 실측에 맞춰 잡는다.
 * 🔴 예전 값(정답 10만·판 9999)은 "말도 안 되는 숫자"를 순위표에 그대로 띄웠다.
 *    상한이 현실과 동떨어지면 조작이 아니어도 순위표가 고장 난 것처럼 보인다.
 *    실측: 승리 한 판당 9~61문항 · 도달 한계 ST60.
 */
export const MAX = {
  /** 주당 정답 수. 하루 30분×5일이면 약 3,000문항이 현실적 상한이다 */
  correct: 3_000,
  /** 주간 최고 도달 판. ST60이 실측 한계라 5배 여유 */
  stage: 300,
  playMs: WEEK_MS,
} as const;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** 별명 목록 크기 — `src/save/schema.ts` 의 NICK_A/NICK_B 길이와 같아야 하고, 테스트가 강제한다 */
export const NICK_N = 8;

export const ALLOWED_ORIGINS = [
  'https://insushim.github.io',
  'https://gugu-guardians.pages.dev',
  'http://localhost:5183',
  'http://localhost:5184',
  'http://localhost:5185',
  'http://127.0.0.1:5183',
  'http://127.0.0.1:5184',
  'http://127.0.0.1:5185',
] as const;

/**
 * 🔴 요청 Origin 을 그대로 되비추면 허용 목록이 아무 의미가 없다.
 *    목록에 있을 때만 되돌려주고, 아니면 대표 오리진을 준다(= 브라우저가 차단).
 *
 * ⚠️ CORS 는 **브라우저**만 막는다. curl·스크립트로 직접 치는 요청은 못 막는다 —
 *    그쪽 방어는 아래 시간 기반 상한(applyCaps)과 MAX_DEVICES_PER_WEEK 가 담당한다.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  const ok = origin !== null && (ALLOWED_ORIGINS as readonly string[]).includes(origin);
  return {
    'access-control-allow-origin': ok ? origin : ALLOWED_ORIGINS[0],
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

/**
 * ISO 주 라벨 "2026-W31" — **UTC 기준**.
 *
 * 🔴 클라이언트도 이 함수를 쓴다. 로컬 시각으로 주를 나누면 KST 기준 월요일 새벽에
 *    클라이언트는 새 주, 서버는 아직 지난 주가 되어 최대 9시간 동안 화면 라벨과
 *    실제 순위 데이터의 주가 어긋난다. 양쪽이 같은 함수를 쓰면 그 틈이 사라진다.
 *
 * 🔴 주를 클라이언트가 **정해서 보내게** 두면 "2999-W01" 같은 빈 주에 1등으로
 *    눌러앉을 수 있다. 그래서 제출 본문에 주 필드는 없고 서버가 직접 계산한다.
 *
 * (학습 기록의 SRS·복습 예정일은 여전히 로컬 날짜를 쓴다 — 그쪽은 아이의 하루가 기준이다.)
 */
export function weekKeyUTC(now: number): string {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7;      // 월=0
  d.setUTCDate(d.getUTCDate() - day + 3);   // 그 주의 목요일
  const year = d.getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Day = (new Date(jan4).getUTCDay() + 6) % 7;
  const week = 1 + Math.round((d.getTime() - jan4) / 86400000 / 7 + (jan4Day - 3) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export interface Submission {
  /** 난수 UUID v4 — 계정도 기기지문도 아니다 */
  d: string;
  /** 별명 앞말/뒷말 인덱스. 🔴 문자열이 아닌 이유는 server/src/index.ts 머리말 참조 */
  na: number;
  nb: number;
  /** 이번 주 정답 수 */
  c: number;
  /** 이번 주 최고 도달 판 */
  s: number;
  /** 이번 주 플레이 시간(ms) — **참고값**이다. 서버가 자기 시계로 다시 상한을 씌운다 */
  p: number;
}

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/**
 * 형식·정적 상한 검사. 반환값이 문자열이면 거절 사유다.
 * 🔴 시간 기반 검사는 여기 없다 — 서버만 아는 값(최초 관측 시각)이 필요하므로 `applyCaps` 담당.
 */
export function validate(body: unknown): Submission | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'bad body';
  const b = body as Record<string, unknown>;

  if (typeof b['d'] !== 'string' || !UUID_RE.test(b['d'])) return 'bad device';
  if (!isInt(b['na'], 0, NICK_N - 1) || !isInt(b['nb'], 0, NICK_N - 1)) return 'bad name';
  if (!isInt(b['c'], 0, MAX.correct)) return 'bad correct';
  if (!isInt(b['s'], 0, MAX.stage)) return 'bad stage';
  if (!isInt(b['p'], 0, MAX.playMs)) return 'bad playMs';

  return { d: b['d'], na: b['na'], nb: b['nb'], c: b['c'], s: b['s'], p: b['p'] };
}

/** 서버가 그 기기에 대해 이미 알고 있는 것 */
export interface Prev {
  correct: number;
  stage: number;
  playMs: number;
  /** 마지막 갱신 시각(epoch ms) */
  updated: number;
  /** 그 주에 **서버가 처음 본** 시각(epoch ms) — 클라이언트가 못 건드리는 유일한 시간 기준 */
  firstSeen: number;
}

/**
 * 🔴 치트 방어의 핵심.
 *
 * 처음 설계는 "정답 수 ÷ 플레이 시간"이 말이 되는지만 봤다. 그런데 **분자도 분모도
 * 클라이언트가 보내는 값**이라, 플레이 시간을 일주일로 위조하면 정답 10만 개가 그대로
 * 통과했다(배포된 서버에서 실제로 재현했다). 비율 검사는 한쪽만 조작 가능할 때만 뜻이 있다.
 *
 * 그래서 분모를 **서버 자기 시계**로 바꿨다: 그 주에 서버가 이 기기를 처음 본 뒤로
 * 실제로 흐른 시간까지만 인정한다. 클라이언트가 뭐라고 보내든 시간은 못 앞당긴다.
 *
 * 거절하지 않고 **깎는다**. 거절하면 늦게 동의한 아이가 에러만 보게 되는데,
 * 값은 누적이라 다음 제출 때 시간이 흐른 만큼 자연히 따라잡는다.
 */
export function applyCaps(v: Submission, prev: Prev | null, now: number): { correct: number; stage: number; playMs: number } {
  // 인정 가능한 플레이 시간 = 서버가 지켜본 시간 + 첫 제출 여유
  const budget = prev ? Math.max(0, now - prev.firstSeen) + FIRST_GRACE_MS : FIRST_GRACE_MS;
  const playMs = Math.min(v.p, budget);

  const correctCap = Math.floor(playMs / MIN_MS_PER_CORRECT);
  const stageCap = prev
    ? prev.stage + Math.floor(Math.max(0, now - prev.firstSeen) / MIN_MS_PER_STAGE) + 1
    : MAX_FIRST_STAGE;

  return {
    // 주간 버킷이라 값이 줄어들 이유가 없다 → 이전 값 아래로는 내려가지 않는다
    correct: Math.max(prev?.correct ?? 0, Math.min(v.c, correctCap)),
    stage: Math.max(prev?.stage ?? 0, Math.min(v.s, stageCap, MAX.stage)),
    playMs: Math.max(prev?.playMs ?? 0, playMs),
  };
}

const TAG_CHARS = '가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허';

/**
 * 순위표에 띄우는 2글자 꼬리표 — 같은 별명이 겹칠 때 구분한다.
 *
 * 🔴 **주(week)를 같이 섞는다.** 기기마다 고정된 꼬리표를 쓰면, 서버 운영자가 아니라
 *    누구라도 공개 순위표를 매주 긁어 특정 아이의 성적 추이를 따라갈 수 있다.
 *    주마다 꼬리표가 바뀌면 같은 주 안에서 구분하는 목적은 그대로면서 그 추적이 끊긴다.
 * 🔴 해시라 되돌릴 수 없고, 2글자만 남기므로 기기 토큰을 복원할 수도 없다.
 */
export async function tagOf(device: string, week: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${week}:${device}`));
  const b = new Uint8Array(buf);
  return TAG_CHARS[b[0]! % TAG_CHARS.length]! + TAG_CHARS[b[1]! % TAG_CHARS.length]!;
}
