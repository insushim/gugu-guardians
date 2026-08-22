import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { verifyAap, initAap, aapState, __resetAapCaches } from '../src/net/aap';
import { buildAapBadge, showAapBadge, BADGE_MS } from '../src/ui/aapBadge';
import { aapStatusLine } from '../src/ui/aapStatus';

/**
 * 🚪 AAP 토큰 검증 — 알찬에서 넘어온 학생 신원.
 *
 * 🔴 여기서 지켜야 할 것
 *   ① 남이 만든 토큰이 통과하면 안 된다(서명·alg·iss·aud).
 *   ② **다른 앱용 토큰**이 통과하면 안 된다 — 위성앱이 여럿이라 실수하기 제일 쉬운 자리다.
 *   ③ 저장해 뒀다 나중에 쓰는 토큰이 통과하면 안 된다(exp·iat).
 *   ④ 무슨 일이 있어도 **게임은 돈다.** 검증 실패가 아이의 학습을 막으면 안 된다.
 *   ⑤ fragment 는 **검증보다 먼저** 지워진다 — 검증이 도는 몇 초 동안에도 토큰은 노출된다.
 *
 * ⚠️ 이 검증은 **보안 경계가 아니다**(규약 §4). 돈은 알찬 서버가 같은 토큰을 자기가 다시
 *    검증한 뒤에만 나간다. 그래도 여기가 뚫리면 남의 이름이 화면에 뜬다.
 */

const APP = 'siteGuguGuardians';
const ISS = 'https://inconomysu-class.web.app';
const JWKS_URI = 'https://jwks.test/keys';
const DISCOVERY = 'https://asia-northeast3-inconomysu-class.cloudfunctions.net/aapDiscovery';

const b64u = (buf: ArrayBuffer | Uint8Array): string => {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64uStr = (s: string): string => b64u(new TextEncoder().encode(s));

let pair: CryptoKeyPair;
let otherPair: CryptoKeyPair;
type Jwk = JsonWebKey & { kid?: string };
let jwk: Jwk;
const KID = 'kid-1';
const NOW_S = 1_787_000_000;
const NOW_MS = NOW_S * 1000;

const claims = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  iss: ISS, aud: APP, sub: 'a'.repeat(32), jti: 'j1',
  iat: NOW_S - 5, exp: NOW_S + 295, ver: 1, ...over,
});

async function sign(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT', kid: KID },
  key: CryptoKey = pair.privateKey,
): Promise<string> {
  const h = b64uStr(JSON.stringify(header));
  const p = b64uStr(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64u(sig)}`;
}

beforeEach(async () => {
  if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  }
  if (!pair) {
    const algo = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
    pair = await crypto.subtle.generateKey(algo, true, ['sign', 'verify']) as CryptoKeyPair;
    otherPair = await crypto.subtle.generateKey(algo, true, ['sign', 'verify']) as CryptoKeyPair;
    jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: KID } as Jwk;
    delete (jwk as Record<string, unknown>)['key_ops'];
    delete (jwk as Record<string, unknown>)['ext'];
  }
  __resetAapCaches();
  let jwksHits = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url) === DISCOVERY) {
      return { ok: true, json: async () => ({ jwks_uri: JWKS_URI, issuer: ISS }) };
    }
    if (String(url) === JWKS_URI) {
      jwksHits += 1;
      return { ok: true, json: async () => ({ keys: [jwk] }), __hits: jwksHits };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
});

afterEach(() => { vi.unstubAllGlobals(); });

// ═══════════════════════════════════════════════════════════════
describe('verifyAap — 통과해야 하는 것', () => {
  it('정상 토큰이면 클레임을 준다', async () => {
    const c = await verifyAap(await sign(claims()), NOW_MS);
    expect(c.sub).toBe('a'.repeat(32));
    expect(c.aud).toBe(APP);
  });

  it('선택 클레임(nick·cls)이 실려 오면 그대로 넘긴다', async () => {
    const c = await verifyAap(await sign(claims({ nick: '별똥별', cls: 'c'.repeat(32) })), NOW_MS);
    expect(c.nick).toBe('별똥별');
    expect(c.cls).toBe('c'.repeat(32));
  });
});

describe('🔴 verifyAap — 막아야 하는 것', () => {
  // 🔴 **정확매치로 던진다.** `toThrow('kid')` 는 부분일치라 `'kid-unknown'` 까지 통과시켰고,
  //    그래서 `kid` 타입검사를 통째로 지워도 전 테스트가 초록이었다(2026-08-22 Claude 레인 변이 생존).
  //    "결국 뭔가로 실패한다"와 "이 검사가 잡는다"는 다른 주장이다.
  const rejects = async (jwt: string, reason: string, now = NOW_MS): Promise<void> => {
    await expect(verifyAap(jwt, now)).rejects.toThrow(new RegExp(`^${reason}$`));
  };

  it('서명이 다른 키면 거부', async () => {
    await rejects(await sign(claims(), { alg: 'RS256', typ: 'JWT', kid: KID }, otherPair.privateKey), 'signature');
  });

  it('🔴 alg 를 헤더가 정하지 못한다 — none/HS 다운그레이드', async () => {
    // HS 로 내려가면 **공개키가 곧 서명키**가 되어 누구나 토큰을 만든다.
    await rejects(await sign(claims(), { alg: 'none', kid: KID }), 'alg');
    await rejects(await sign(claims(), { alg: 'HS256', kid: KID }), 'alg');
  });

  it('🔴 다른 앱용 토큰은 거부 — 위성앱이 여럿이라 제일 실수하기 쉬운 자리', async () => {
    await rejects(await sign(claims({ aud: 'siteChromaFall' })), 'aud');
  });

  it('발급자가 다르면 거부', async () => {
    await rejects(await sign(claims({ iss: 'https://evil.test' })), 'iss');
  });

  it('만료된 토큰은 거부(60초 여유까지만)', async () => {
    const jwt = await sign(claims());
    await verifyAap(jwt, (NOW_S + 350) * 1000);                 // exp+55 → 통과
    await rejects(jwt, 'exp', (NOW_S + 400) * 1000);            // exp+105 → 거부
  });

  it('🔴 오래된 토큰은 거부 — 저장해 뒀다 재사용하는 걸 막는다', async () => {
    await rejects(await sign(claims({ iat: NOW_S - 400, exp: NOW_S + 3600 })), 'iat');
  });

  it('ver 가 1 이 아니면 거부', async () => {
    await rejects(await sign(claims({ ver: 2 })), 'ver');
  });

  it('sub 모양이 다르면 거부(32자 hex)', async () => {
    await rejects(await sign(claims({ sub: 'not-a-pairwise-id' })), 'sub');
  });

  it('🔴 서명 표기는 **하나가 아니다** — 토큰 문자열을 키로 쓰면 안 되는 이유', async () => {
    // base64 의 마지막 글자는 유효 비트가 6개보다 적어서 여러 글자가 같은 바이트로 디코드된다.
    // 즉 **같은 서명의 문자열 표기가 여럿**이고, 넷 다 정당하게 검증을 통과한다.
    // 이걸 결함으로 고치려 들면 안 된다 — 바이트가 같으니 통과가 맞다.
    // 고쳐야 할 것은 **토큰 문자열을 키로 쓰려는 코드**다(재생 방어는 서버가 `jti` 로 한다).
    const jwt = await sign(claims());
    const [h, p, sig] = jwt.split('.') as [string, string, string];
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const sameBytes = chars.split('').filter((ch) => {
      const cand = sig.slice(0, -1) + ch;
      return Buffer.from(cand, 'base64url').equals(Buffer.from(sig, 'base64url'));
    });
    expect(sameBytes.length).toBeGreaterThan(1);          // 표기가 여럿이다(실측 4개)
    for (const ch of sameBytes) {
      await expect(verifyAap(`${h}.${p}.${sig.slice(0, -1)}${ch}`, NOW_MS)).resolves.toBeTruthy();
    }
  });

  it('🔴 느슨한 base64 는 거부 — 패딩·표준 base64·잘린 토큰', async () => {
    const jwt = await sign(claims());
    await rejects(`${jwt}=`, 'malformed');
    await rejects(jwt.replace('-', '+'), 'malformed');
    await rejects('a.b', 'malformed');
  });

  it('kid 없는 헤더는 거부', async () => {
    await rejects(await sign(claims(), { alg: 'RS256' }), 'kid-missing');
  });

  it('빈 문자열 kid 도 거부 — typeof 는 string 이라 통과할 뻔했다', async () => {
    await rejects(await sign(claims(), { alg: 'RS256', kid: '' }), 'kid-missing');
  });

  it('선택 클레임이 문자열이 아니면 버린다 — 화면에 [object Object] 가 뜨지 않게', async () => {
    const c = await verifyAap(await sign(claims({ nick: { evil: 1 }, cls: 42 })), NOW_MS);
    expect(c.nick).toBeUndefined();
    expect(c.cls).toBeUndefined();
  });
});

describe('🔴 verifyAap — 경계값과 인프라 오류', () => {
  it('exp 경계: +60 초는 통과, +61 초는 거부', async () => {
    const jwt = await sign(claims());
    // `now >= exp + 60` 이므로 exp+59 는 통과, exp+60 은 거부다. off-by-one 을 못 박는다.
    await expect(verifyAap(jwt, (NOW_S + 295 + 59) * 1000)).resolves.toBeTruthy();
    await expect(verifyAap(jwt, (NOW_S + 295 + 60) * 1000)).rejects.toThrow(/^exp$/);
  });

  it('iat 경계: 360 초는 통과, 361 초는 거부', async () => {
    const jwt = await sign(claims({ iat: NOW_S - 360, exp: NOW_S + 3600 }));
    await expect(verifyAap(jwt, NOW_MS)).resolves.toBeTruthy();
    const old = await sign(claims({ iat: NOW_S - 361, exp: NOW_S + 3600 }));
    await expect(verifyAap(old, NOW_MS)).rejects.toThrow(/^iat$/);
  });

  it('discovery 응답 모양이 다르면 거부한다 — 엉뚱한 곳의 키로 검증하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ hello: 'world' }) })));
    __resetAapCaches();
    await expect(verifyAap(await sign(claims()), NOW_MS)).rejects.toThrow(/^discovery$/);
  });

  it('discovery·JWKS 가 HTTP 오류면 거부한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    __resetAapCaches();
    await expect(verifyAap(await sign(claims()), NOW_MS)).rejects.toThrow(/http 503/);
  });
});

describe('🔑 키 회전 — kid 를 못 찾으면 캐시를 버리고 한 번 더 받는다', () => {
  it('옛 캐시에 없는 kid 여도 재조회로 찾아낸다', async () => {
    // 회전 순간: 앱은 옛 키만 캐시했는데 토큰은 새 kid 를 달고 온다.
    // 재조회가 없으면 **이 앱만 최대 5분 전부 실패**한다.
    const newJwk: Jwk = { ...jwk, kid: 'kid-2' };
    let jwksCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url) === DISCOVERY) return { ok: true, json: async () => ({ jwks_uri: JWKS_URI, issuer: ISS }) };
      jwksCalls += 1;
      // 🔴 **지금 이 호출이 줄 값을 여기서 확정한다.** 처음엔 `served` 변수를 닫아 잡고
      //    `json()` 안에서 읽게 썼는데, 그 사이 변수가 이미 갱신돼 **첫 조회가 새 키까지
      //    돌려줬다** — 재조회 경로를 한 번도 안 밟은 채 테스트가 통과했다(변이 생존으로 발각).
      //    지연 평가하는 목은 "언제 읽히는지"까지 봐야 한다.
      const keys = jwksCalls === 1 ? [jwk] : [jwk, newJwk];
      return { ok: true, json: async () => ({ keys }) };
    }));
    __resetAapCaches();
    const jwt = await sign(claims(), { alg: 'RS256', typ: 'JWT', kid: 'kid-2' });
    const c = await verifyAap(jwt, NOW_MS);
    expect(c.sub).toBe('a'.repeat(32));
    expect(jwksCalls).toBe(2);       // 재조회를 실제로 했다
  });

  it('두 번 받아도 없는 kid 면 거부한다(무한 재조회 금지)', async () => {
    const jwt = await sign(claims(), { alg: 'RS256', typ: 'JWT', kid: 'kid-없음' });
    await expect(verifyAap(jwt, NOW_MS)).rejects.toThrow('kid-unknown');
  });
});

describe('🚪 initAap — 부팅', () => {
  const setHash = (h: string): ReturnType<typeof vi.fn> => {
    const replaceState = vi.fn();
    vi.stubGlobal('location', { hash: h, pathname: '/', search: '' });
    vi.stubGlobal('history', { replaceState });
    return replaceState;
  };

  it('fragment 가 없으면 아무 일도 안 한다(그냥 들어온 경우 = 정상)', async () => {
    setHash('');
    expect((await initAap()).kind).toBe('none');
  });

  it('🔴 fragment 를 **검증보다 먼저** 지운다', async () => {
    // 검증은 네트워크 왕복이라 몇 초 걸린다. 그동안 토큰이 주소창에 떠 있으면
    // 아이가 주소를 복사하거나 뒤로가기 기록에 남는다.
    //
    // ⚠️ **지금 시각으로 서명한다.** 처음엔 고정 NOW_S 로 만들었는데 그 토큰은 이미 만료라
    //    검증이 실패한 채로 통과했다 — 순서는 맞았지만 **성공 경로를 한 번도 안 밟는**
    //    테스트였다. 실패 경로에서만 참인 단언은 언젠가 거짓말을 한다.
    const nowS = Math.floor(Date.now() / 1000);
    const jwt = await sign(claims({ iat: nowS - 5, exp: nowS + 295 }));
    const order: string[] = [];
    const replaceState = vi.fn(() => { order.push('cleared'); });
    vi.stubGlobal('location', { hash: `#aap=${jwt}`, pathname: '/', search: '' });
    vi.stubGlobal('history', { replaceState });
    const realFetch = globalThis.fetch as unknown as (x: string) => Promise<unknown>;
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { order.push('fetch'); return realFetch(u); }));

    const st = await initAap();
    expect(st.kind).toBe('ok');                     // 성공 경로를 실제로 밟았다
    expect(order[0]).toBe('cleared');               // 그런데도 지우기가 먼저였다
    expect(order).toContain('fetch');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('🔴 주소창에서 토큰을 못 지우면 **경고를 남긴다** — 이 파일에서 유일하게 무음이었다', async () => {
    // 이 줄의 목적 자체가 프라이버시 속성("토큰을 주소창에서 지운다")이라,
    // 실패했는데 흔적이 없으면 아무도 못 알아챈다. 사파리 프라이빗 등에서 실제로 던진다.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('location', { hash: `#aap=${await sign(claims())}`, pathname: '/', search: '' });
    vi.stubGlobal('history', { replaceState: () => { throw new Error('SecurityError'); } });
    await initAap();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('주소창에서 토큰을 지우지 못했다'))).toBe(true);
    warn.mockRestore();
  });

  it('🔴 검증이 실패해도 던지지 않는다 — 게임이 죽으면 안 된다', async () => {
    vi.stubGlobal('location', { hash: '#aap=쓰레기', pathname: '/', search: '' });
    vi.stubGlobal('history', { replaceState: vi.fn() });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const st = await initAap();
    expect(st.kind).toBe('failed');
    expect(aapState().kind).toBe('failed');
  });

  it('🔴 네트워크가 죽어도 던지지 않는다', async () => {
    vi.stubGlobal('location', { hash: `#aap=${await sign(claims())}`, pathname: '/', search: '' });
    vi.stubGlobal('history', { replaceState: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await initAap()).kind).toBe('failed');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('🚪 배지 — 관찰 단계의 유일한 산출물', () => {
  // vitest 환경이 node 라 DOM 이 없다. `buildAapBadge` 가 `doc` 을 주입받게 만든 이유다 —
  // jsdom 을 끌어오지 않고도 문구·조건을 고정할 수 있다.
  interface FakeEl { tagName: string; className: string; textContent: string; attrs: Record<string, string>;
    setAttribute(k: string, v: string): void; remove: ReturnType<typeof vi.fn>; }
  const fakeDoc = (): { doc: Document; appended: FakeEl[] } => {
    const appended: FakeEl[] = [];
    const doc = {
      // 🔴 `remove` 를 **만들 때부터** 스파이로 둔다. 예전엔 만들어진 뒤에 프로퍼티를 바꿔
      //    끼웠는데, 그 사이 타이머가 먼저 돌면 옛 함수가 불려 단언이 어긋난다
      //    (2026-08-22 Claude 레인이 35회 중 1회 실패를 관측했다 — 사후 교체 패턴이 원인이다).
      createElement: (tagName: string): FakeEl => ({
        tagName, className: '', textContent: '', attrs: {},
        setAttribute(k: string, v: string) { this.attrs[k] = v; },
        remove: vi.fn(),
      }),
      body: { append: (el: FakeEl) => { appended.push(el); } },
    } as unknown as Document;
    return { doc, appended };
  };

  const OK = { kind: 'ok' as const, sub: 'a'.repeat(32), exp: NOW_S + 295 };

  it('알찬으로 들어오면 배지를 만든다', () => {
    const { doc } = fakeDoc();
    const el = buildAapBadge(OK, doc) as unknown as FakeEl | null;
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe('알찬으로 연결됨');
    expect(el!.className).toBe('aap-badge');
    expect(el!.attrs['role']).toBe('status');
  });

  it('별명이 오면 별명을 보여준다', () => {
    const { doc } = fakeDoc();
    const el = buildAapBadge({ ...OK, nick: '별똥별' }, doc) as unknown as FakeEl;
    expect(el.textContent).toBe('알찬 · 별똥별');
  });

  it('🔴 `sub` 를 화면에 찍지 않는다 — 교실 TV·스크린샷에 남을 이유가 없다', () => {
    const { doc } = fakeDoc();
    const el = buildAapBadge({ ...OK, nick: '별똥별' }, doc) as unknown as FakeEl;
    expect(el.textContent).not.toContain(OK.sub);
    expect(JSON.stringify(el)).not.toContain(OK.sub);
  });

  it('그냥 들어온 경우엔 **아무것도 안 뜬다** — 이 게임은 로그인이 없다', () => {
    const { doc, appended } = fakeDoc();
    expect(buildAapBadge({ kind: 'none' }, doc)).toBeNull();
    expect(showAapBadge({ kind: 'none' }, doc)).toBeNull();
    expect(appended).toHaveLength(0);
  });

  it('🔴 검증 실패도 배지를 띄우지 않는다 — 아이에게 보여줄 말이 아니다', () => {
    const { doc, appended } = fakeDoc();
    expect(showAapBadge({ kind: 'failed', reason: 'signature' }, doc)).toBeNull();
    expect(appended).toHaveLength(0);
  });

  it('띄우면 body 에 붙고, 스스로 사라진다', () => {
    vi.useFakeTimers();
    const { doc, appended } = fakeDoc();
    const el = showAapBadge(OK, doc) as unknown as FakeEl;
    expect(appended).toHaveLength(1);
    expect(el.remove).not.toHaveBeenCalled();      // 아직은 붙어 있다
    vi.advanceTimersByTime(BADGE_MS + 1);
    expect(el.remove).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('🚪 설정 화면 상태 — 배지를 놓쳐도 확인할 수 있어야 한다', () => {
  it('연결됨 · 별명이 있으면 별명까지', () => {
    expect(aapStatusLine({ kind: 'ok', sub: 'a'.repeat(32), exp: 0 }).title).toBe('연결됨');
    expect(aapStatusLine({ kind: 'ok', sub: 'a'.repeat(32), exp: 0, nick: '별똥별' }).title).toBe('연결됨 · 별똥별');
  });

  it('🔴 세 상태가 화면에서 **서로 구별된다** — 배지만으로는 성공·미경유·실패가 같아 보였다', () => {
    const titles = (['ok', 'none', 'failed'] as const).map((k) => aapStatusLine(
      k === 'ok' ? { kind: 'ok', sub: 'a'.repeat(32), exp: 0 }
        : k === 'none' ? { kind: 'none' } : { kind: 'failed', reason: 'signature' },
    ).title);
    expect(new Set(titles).size).toBe(3);
  });

  it('🔴 실패 사유를 화면에 쓰지 않는다 — 아이가 읽을 말이 아니다', () => {
    const line = aapStatusLine({ kind: 'failed', reason: 'signature' });
    expect(`${line.title} ${line.detail}`).not.toContain('signature');
  });

  it('🔴 어떤 상태에서도 `sub` 를 찍지 않는다 — 설정 화면은 교실 TV 에 띄우는 자리다', () => {
    const sub = 'b'.repeat(32);
    for (const st of [{ kind: 'ok' as const, sub, exp: 0 }, { kind: 'ok' as const, sub, exp: 0, nick: '별' }]) {
      const l = aapStatusLine(st);
      expect(`${l.title} ${l.detail}`).not.toContain(sub);
    }
  });

  it('미경유는 "게임은 전부 그대로"라고 말한다 — 겁주지 않는다', () => {
    expect(aapStatusLine({ kind: 'none' }).detail).toContain('그대로');
  });
});
