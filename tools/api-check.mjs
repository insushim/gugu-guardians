#!/usr/bin/env node
/**
 * 순위 서버 API 실측 — **브라우저를 거치지 않고 직접** 친다.
 *
 * 이게 따로 있는 이유: 실제 공격자는 브라우저를 쓰지 않는다. curl 로 바로 치면
 * CORS 는 아무것도 막지 못하므로, 방어가 정말 서버 안에 있는지는 이 경로로 확인해야 한다.
 * (E2E 는 "동의 전에 요청이 안 나가는가" 같은 클라이언트 약속을 검증하고,
 *  이 파일은 "서버가 조작을 실제로 막는가"를 검증한다.)
 *
 * 실행: BOARD_URL=https://... node tools/api-check.mjs
 */
const BASE = (process.env.BOARD_URL ?? 'http://127.0.0.1:8788').replace(/\/+$/, '');

const problems = [];
const must = (c, m) => { if (!c) problems.push(m); return c; };
const uuid = () => crypto.randomUUID();

const post = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

console.log(`# 순위 서버 API 실측 — ${BASE}`);

// ── 1. 살아 있는가
const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
must(health?.ok === true, '/health 응답 없음');

// ── 2. 🔴 시간 위조로 최댓값을 주장한다 (예전엔 이게 그대로 통과했다)
const cheater = uuid();
const forged = await post('/submit', {
  d: cheater, na: 7, nb: 7, c: 3000, s: 300, p: 604_800_000,
});
must(forged.status === 200, `위조 제출이 200이 아님: ${forged.status}`);
must(
  (forged.json?.mine?.correct ?? 1e9) < 3000,
  `🔴 플레이 시간 위조가 통했다 — 정답 ${forged.json?.mine?.correct}이 그대로 등록됨`,
);
must(
  (forged.json?.mine?.stage ?? 1e9) <= 100,
  `🔴 도달 판 위조가 통했다 — ${forged.json?.mine?.stage}판이 그대로 등록됨`,
);
console.log(`- 위조 시도 결과: 정답 ${forged.json?.mine?.correct} · 판 ${forged.json?.mine?.stage} (주장은 3000 / 300)`);

// ── 3. 정직한 첫 제출은 그대로 통과한다 (한 판 = 70초에 27문항)
const honest = uuid();
const fair = await post('/submit', { d: honest, na: 1, nb: 2, c: 27, s: 3, p: 70_000 });
must(fair.json?.mine?.correct === 27, `정직한 제출이 깎였다: ${fair.json?.mine?.correct}`);
must(fair.json?.mine?.stage === 3, `정직한 도달 판이 깎였다: ${fair.json?.mine?.stage}`);

// ── 4. 값 되돌리기는 반영되지 않는다
const rollback = await post('/submit', { d: honest, na: 1, nb: 2, c: 1, s: 1, p: 1_000 });
must(rollback.json?.mine?.correct === 27, `되돌리기가 통했다: ${rollback.json?.mine?.correct}`);

// ── 5. 형식 위반은 거절된다
for (const [body, why] of [
  [{ d: 'admin', na: 0, nb: 0, c: 1, s: 1, p: 1000 }, 'bad device'],
  [{ d: uuid(), na: '김철수', nb: 0, c: 1, s: 1, p: 1000 }, 'bad name'],
  [{ d: uuid(), na: 0, nb: 0, c: 999999, s: 1, p: 1000 }, 'bad correct'],
  [{ d: uuid(), na: 0, nb: 0, c: 1, s: 99999, p: 1000 }, 'bad stage'],
]) {
  const r = await post('/submit', body);
  must(r.status === 400 && r.json?.error === why, `"${why}" 가 거절되지 않았다: ${JSON.stringify(r.json)}`);
}

// ── 6. 🔴 "그만 올리기"가 실제로 서버 기록을 지우는가
const board1 = await fetch(`${BASE}/board`).then((r) => r.json());
const before = [...board1.practice, ...board1.challenge].length;
must(before > 0, '순위표가 비어 있어 삭제를 확인할 수 없다');

await post('/forget', { d: honest });
await post('/forget', { d: cheater });
const board2 = await fetch(`${BASE}/board`).then((r) => r.json());
const after = [...board2.practice, ...board2.challenge].length;
must(after < before, `🔴 /forget 이 아무것도 지우지 않았다 (${before} → ${after})`);

// 되살아나지 않는지도 본다
const revived = await fetch(`${BASE}/board`).then((r) => r.json());
must(
  ![...revived.practice, ...revived.challenge].some((e) => e.v === 27),
  '🔴 지운 기록이 순위표에 남아 있다',
);

// ── 7. 없는 경로·잘못된 본문
must((await post('/forget', { d: 'nope' })).status === 400, '/forget 이 잘못된 기기 토큰을 받았다');
must((await fetch(`${BASE}/nope`)).status === 404, '없는 경로가 404가 아니다');

console.log(`- 순위표 줄 수: ${before} → ${after} (삭제 확인)`);
console.log(`- 실패: ${problems.length}`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(problems.length ? 1 : 0);
