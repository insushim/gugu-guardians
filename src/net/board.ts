import * as store from '../save/store';
import { NICK_A, NICK_B } from '../save/schema';
import { submitBodyNow } from '../meta/weekly';

/**
 * 익명 주간 순위 — 클라이언트.
 *
 * 🔴 기본은 **보내지 않음**이다. 아이가 "순위에 올릴래요"를 누르기 전까지
 *    기기 토큰조차 만들지 않고, 어떤 요청도 나가지 않는다.
 *
 * 🔴 순위표를 **보는 것**은 동의 없이도 된다(읽기는 우리 쪽 데이터를 만들지 않는다).
 *    올리는 것만 동의를 받는다.
 *
 * 서버 주소가 비어 있으면(단일 HTML 빌드) 이 기능 전체가 없는 것처럼 동작한다 —
 * 아티팩트는 CSP 로 외부 요청이 전부 막혀 있어서, 시도했다가 콘솔 에러만 남기기 때문이다.
 */

const RAW = (import.meta.env['VITE_BOARD_URL'] as string | undefined) ?? '';
export const BOARD_URL = RAW.replace(/\/+$/, '');
export const boardEnabled = (): boolean => BOARD_URL !== '';

const TIMEOUT_MS = 6000;

export interface BoardEntry { na: number; nb: number; tag: string; v: number }
export interface BoardPayload { week: string; practice: BoardEntry[]; challenge: BoardEntry[] }
export interface SubmitResult { ok: true; week: string; rank: { practice: number; challenge: number }; mine: { correct: number; stage: number } }

/** 서버가 준 인덱스를 사람이 읽는 별명으로. 목록 밖 값은 서버가 막지만 여기서도 방어한다 */
export function entryName(e: BoardEntry): string {
  const a = NICK_A[e.na] ?? NICK_A[0]!;
  const b = NICK_B[e.nb] ?? NICK_B[0]!;
  return `${a} ${b} ${e.tag}`;
}

/**
 * `outer` 는 화면이 언마운트될 때 끊는 신호다.
 * 🔴 이게 없으면 화면을 나간 뒤 응답이 도착해 이미 떨어져 나간 DOM 을 만진다.
 */
async function call<T>(path: string, outer: AbortSignal | undefined, init?: RequestInit): Promise<T | null> {
  if (!boardEnabled()) return null;
  if (outer?.aborted) return null;
  const ac = new AbortController();
  const onAbort = (): void => ac.abort();
  outer?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BOARD_URL}${path}`, { ...init, signal: ac.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // 🔴 순위는 부가 기능이다. 서버가 죽어도 게임은 그대로 돌아가야 한다.
    return null;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

export function fetchBoard(signal?: AbortSignal): Promise<BoardPayload | null> {
  return call<BoardPayload>('/board', signal);
}

/**
 * 기기 토큰을 만든다 — **동의한 순간에만** 부른다.
 * 계정도 기기지문도 아닌 순수 난수다. 설정에서 순위를 끄면 지운다.
 */
function newDeviceId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // 보안 컨텍스트가 아닌 경우(file://)의 폴백 — 서버의 UUID v4 형식 검사를 통과해야 한다
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** "순위에 올릴래요" — 동의하고 기기 토큰을 만든다 */
export function grantConsent(): void {
  store.update((d) => {
    d.board.consent = true;
    if (!d.board.device) d.board.device = newDeviceId();
  });
}

/**
 * "그만 올리기" — 동의를 끄고 기기 토큰을 **지운다**(다시 켜면 새 토큰이 나온다).
 *
 * 🔴 서버에 이미 올라간 기록도 함께 지운다. 안 그러면 "그만 올리기"를 눌러도
 *    그 주가 끝날 때까지 순위표에 계속 떠 있어 문구와 실제 동작이 다르다.
 *    삭제 요청은 화면을 막지 않는다 — 실패해도 로컬 토큰은 어차피 지워지고,
 *    남은 행은 보존 기간이 지나면 사라진다.
 */
export function revokeConsent(): void {
  const device = store.load().board.device;
  store.update((d) => {
    d.board.consent = false;
    d.board.device = '';
  });
  if (device) {
    void call<{ ok: true }>('/forget', undefined, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ d: device }),
    });
  }
}

/**
 * 이번 주 기록을 올린다. 동의가 없으면 아무 일도 하지 않는다(요청 자체가 안 나간다).
 * 실패해도 조용히 넘어간다 — 순위 때문에 게임이 멈추면 안 된다.
 */
export async function submitScore(signal?: AbortSignal): Promise<SubmitResult | null> {
  if (!boardEnabled()) return null;
  const body = submitBodyNow(store.load());
  if (!body) return null;
  return call<SubmitResult>('/submit', signal, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
