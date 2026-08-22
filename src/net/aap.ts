/**
 * 🚪 AAP v1 — 알찬에서 넘어온 학생 신원을 받는다.
 *
 * 규약 정본: `insushim/alchan` 의 `docs/AAP_V1_SPEC.md`. 이 파일은 그 §3 구현이다.
 *
 * ## 이 앱의 정체성을 깨지 않는다
 * 구구성 수호대는 **로그인이 없는 게임**이다. 그 성질을 AAP 가 바꾸지 않는다:
 *  · 알찬을 거치지 않고 그냥 들어와도 **똑같이 다 된다**. 토큰은 있으면 좋은 것이지 관문이 아니다.
 *  · 검증에 실패해도 게임은 그대로 돈다 — 아이가 문제를 못 푸는 일은 없어야 한다.
 *  · 신원은 **메모리에만** 둔다. `sub` 를 localStorage 에 눌러 담으면, 교실 공용 PC 에서
 *    다음 아이가 앞 아이의 신원을 물려받는다.
 *
 * ## 보안 경계가 아니다 (규약 §4)
 * 여기서 하는 검증은 **화면을 그리기 위한 판단**이다. 돈이 나가는 근거가 아니다 —
 * 보상은 알찬 서버가 같은 토큰을 자기가 다시 검증한 뒤에만 준다. 그러니 이 파일이
 * 뚫려도 돈은 안 샌다. 반대로 **여기서 통과했다고 지급이 보장되지도 않는다.**
 *
 * ## 지금 단계 (P1-4a 관찰)
 * 알찬 쪽 정책은 `aapEnabled` 만 켜져 있고 보상·학습기록은 꺼져 있다. 그래서 이 파일은
 * **신원을 받아 두기만** 한다. 보낼 곳이 생기는 건 다음 단계다.
 */

const DISCOVERY = 'https://asia-northeast3-inconomysu-class.cloudfunctions.net/aapDiscovery';
const MY_APP_ID = 'siteGuguGuardians';

/** JWKS 캐시 수명. 키 회전은 중복기간을 두므로 5분이면 충분하다(규약 §3). */
const JWKS_TTL_MS = 300_000;
/** 네트워크가 죽어도 게임 시작을 붙잡지 않는다. */
const FETCH_TIMEOUT_MS = 5000;

export interface AapClaims {
  iss: string; aud: string; sub: string;
  /** 알찬 서버의 1회용 실행권 키(`aapRewardSessions/{jti}`). 앱은 **안 읽는다** —
   *  재생 방어는 서버가 한다. 토큰 형태를 문서화하려고 남겨 둔 필드다. */
  jti: string;
  iat: number; exp: number; ver: number;
  nick?: string; cls?: string;
}

/** 알찬에서 넘어왔는가. 실패 사유는 개발자용이고 아이에게 보여주지 않는다. */
export type AapState =
  | { kind: 'none' }                                   // 그냥 들어왔다(정상)
  | { kind: 'ok'; sub: string; nick?: string; cls?: string; exp: number }
  | { kind: 'failed'; reason: string };

let state: AapState = { kind: 'none' };

/** 지금 신원. **메모리에만** 산다 — 새로고침하면 사라지는 게 맞다(공용 PC). */
export function aapState(): AapState { return state; }

/**
 * 🔒 엄격한 base64url 만 받는다.
 *
 * `atob` 은 관대해서 `=` 패딩·개행·표준 base64(`+/`)까지 다 받아준다. 그걸 거르면 같은
 * 토큰의 **거친** 변형(패딩 유무·인코딩 종류)이 사라진다.
 *
 * ⚠️ **다만 이게 "표기가 하나뿐"을 보장하지는 않는다.** base64 의 마지막 글자는 유효 비트가
 *    6 개보다 적어서, **서로 다른 글자 여럿이 같은 바이트로 디코드된다** — 실측: 5바이트
 *    서명의 마지막 글자 후보가 `U·V·W·X` 4개였고 넷 다 검증을 통과한다(2026-08-22 codex 레인).
 *    처음엔 이 주석이 "여러 형태가 생기는 걸 막는다"고 단언했는데 **틀렸다.**
 *
 *    그래서 **토큰 문자열을 키로 쓰면 안 된다.** 다행히 이 시스템은 안 쓴다 — 알찬 서버의
 *    1회용 실행권이 `aapRewardSessions/{jti}` 로 **페이로드의 `jti`** 를 키로 쓴다. 서명 표기가
 *    달라도 `jti` 는 같으므로 재생은 서버에서 막힌다. 여기서 문자열로 중복을 거르기 시작하면
 *    그 순간 뚫린다.
 */
function b64u(s: string): Uint8Array {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

function jsonPart(s: string): unknown {
  return JSON.parse(new TextDecoder().decode(b64u(s)));
}

async function getJson(url: string): Promise<Record<string, unknown>> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ac.signal });
    if (!r.ok) throw new Error(`http ${r.status}`);
    return (await r.json()) as Record<string, unknown>;
  } finally { clearTimeout(t); }
}

let jwksCache: { at: number; keys: JsonWebKey[] | null } = { at: 0, keys: null };

async function getJwks(uri: string, force = false): Promise<JsonWebKey[]> {
  if (!force && jwksCache.keys && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const body = await getJson(uri);
  const keys = (body['keys'] as JsonWebKey[] | undefined) ?? [];
  jwksCache = { at: Date.now(), keys };
  return keys;
}

/** 테스트용 — 캐시를 비운다. 프로덕션 코드에서 부르지 말 것. */
export function __resetAapCaches(): void {
  jwksCache = { at: 0, keys: null };
  state = { kind: 'none' };
}

/**
 * 토큰을 검증하고 클레임을 돌려준다. 실패는 **던진다**(사유가 개발자용이라 문자열로).
 *
 * @param jwt fragment 에서 꺼낸 토큰
 * @param nowMs 현재 시각(테스트 주입용)
 */
export async function verifyAap(jwt: string, nowMs: number = Date.now()): Promise<AapClaims> {
  const parts = jwt.split('.');
  if (parts.length !== 3 || !parts.every((x) => /^[A-Za-z0-9_-]+$/.test(x))) throw new Error('malformed');
  const [h, p, s] = parts as [string, string, string];

  const header = jsonPart(h) as { alg?: string; kid?: string };
  // 🔒 `alg` 는 헤더를 믿지 않고 **고정**한다. `none`·HS 다운그레이드가 여기서 죽는다
  //    (HS 로 내려가면 공개키가 곧 서명키가 되어 누구나 토큰을 만든다).
  if (header.alg !== 'RS256') throw new Error('alg');
  // ⚠️ 사유 이름을 `kid-missing` 으로 둔다. 예전엔 `kid` 였는데, 아래에서 던지는
  //    `kid-unknown` 과 **부분일치**해서 이 검사를 통째로 지워도 테스트가 통과했다
  //    (2026-08-22 Claude 레인 변이 생존). 사유 이름이 서로의 접두사면 정확매치가 무너진다.
  if (typeof header.kid !== 'string' || !header.kid) throw new Error('kid-missing');

  const disc = await getJson(DISCOVERY);
  const jwksUri = disc['jwks_uri'];
  const issuer = disc['issuer'];
  if (typeof jwksUri !== 'string' || typeof issuer !== 'string') throw new Error('discovery');

  // ⚠️ `kid` 를 못 찾으면 **캐시를 버리고 한 번 다시 받는다.** 이 재조회가 없으면 키 회전
  //    순간에 이 앱만 최대 5분간 전부 실패한다(캐시된 옛 키 ↔ 새 kid 토큰).
  let jwk = (await getJwks(jwksUri)).find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) jwk = (await getJwks(jwksUri, true)).find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) throw new Error('kid-unknown');

  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64u(s) as BufferSource, new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('signature');

  const c = jsonPart(p) as AapClaims;
  const now = Math.floor(nowMs / 1000);
  if (c.iss !== issuer) throw new Error('iss');
  // 🔒 **다른 앱용 토큰 재사용 차단.** 이게 없으면 옆 앱에 발급된 토큰으로 여기 들어온다.
  if (c.aud !== MY_APP_ID) throw new Error('aud');
  if (c.ver !== 1) throw new Error('ver');
  if (typeof c.sub !== 'string' || !/^[a-f0-9]{32}$/.test(c.sub)) throw new Error('sub');
  if (typeof c.exp !== 'number' || typeof c.iat !== 'number') throw new Error('times');
  // 60초 여유 = 기기 시계 오차. 그 이상은 만료로 본다.
  if (now >= c.exp + 60) throw new Error('exp');
  // 발급된 지 6분 넘은 토큰은 안 받는다 — 저장해 뒀다 재사용하는 걸 막는다.
  if (now - c.iat > 360) throw new Error('iat');
  // 선택 클레임은 보안 필드가 아니라 검사에서 빠져 있었는데, 그대로 화면 렌더로 흘러간다.
  // 문자열이 아니면 `[object Object]` 같은 게 배지에 뜬다(XSS 는 아니다 — 전부 textContent).
  // 서명자만 만들 수 있는 값이라 위험은 낮지만, **믿는 것과 안 보는 것은 다르다.**
  if (c.nick !== undefined && typeof c.nick !== 'string') delete c.nick;
  if (c.cls !== undefined && typeof c.cls !== 'string') delete c.cls;
  return c;
}

/**
 * 🚪 부팅 시 1회. fragment 에서 토큰을 꺼내 검증하고 신원을 세운다.
 *
 * 🔴 **fragment 를 먼저 지운다.** 검증보다 먼저다 — 검증이 몇 초 걸리는 동안에도 토큰은
 *    주소창에 떠 있고, 그 사이 아이가 주소를 복사하거나 뒤로가기 기록에 남으면 5분짜리
 *    토큰이 밖으로 나간다. 알찬 쪽에서는 크로스 오리진이라 손댈 수 없는 자리다(규약 §3).
 *
 * @return 최종 상태
 */
export async function initAap(): Promise<AapState> {
  let raw: string | null = null;
  try {
    const m = location.hash.match(/[#&]aap=([^&]+)/);
    if (m && m[1]) {
      raw = m[1];
      // 지우는 것이 먼저. 여기서 실패해도 검증은 계속한다(사파리 프라이빗 등).
      // ⚠️ **조용히 넘어가지 않는다.** 이 줄의 목적 자체가 "토큰을 주소창에서 지운다"는
      //    프라이버시 속성이라, 실패했는데 아무 흔적이 없으면 아무도 못 알아챈다 —
      //    이 파일의 다른 실패는 전부 warn 을 남기는데 여기만 예외였다(2026-08-22 Claude 레인).
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch (e) {
        console.warn('[AAP] 주소창에서 토큰을 지우지 못했다 —', e instanceof Error ? e.message : e);
      }
    }
  } catch { /* location 이 없는 환경 */ }

  if (!raw) { state = { kind: 'none' }; return state; }

  try {
    const c = await verifyAap(raw);
    state = { kind: 'ok', sub: c.sub, exp: c.exp, ...(c.nick ? { nick: c.nick } : {}), ...(c.cls ? { cls: c.cls } : {}) };
  } catch (e) {
    // 🔴 실패해도 **게임은 그대로 돈다.** 아이가 문제를 못 푸는 일은 없어야 한다.
    state = { kind: 'failed', reason: e instanceof Error ? e.message : 'unknown' };
    console.warn('[AAP] 알찬 연결 확인 실패 —', state.reason, '(게임은 정상 동작)');
  }
  return state;
}
