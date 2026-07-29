import { describe, it, expect } from 'vitest';
import {
  validate, applyCaps, weekKeyUTC, tagOf, corsHeaders,
  MAX, MIN_MS_PER_CORRECT, MIN_MS_PER_STAGE, FIRST_GRACE_MS, MAX_FIRST_STAGE,
  NICK_N, UUID_RE, ALLOWED_ORIGINS, type Prev, type Submission,
} from '../shared/board-contract';
import { bumpWeekly, submitBody } from '../src/meta/weekly';
import { defaultSave, nickIndex, normalize, NICK_A, NICK_B } from '../src/save/schema';

/**
 * 익명 주간 순위 — 서버 규칙과 클라이언트 버킷.
 *
 * 🔴 여기가 뚫리면 아이 개인정보가 순위표에 뜨거나(별명 경로), 성실하게 푼 아이가
 *    조작한 아이한테 밀린다(개연성 검사). 둘 다 사후 수습이 안 되는 종류라
 *    회귀 테스트를 남긴다.
 */

/** 🔴 대소문자 검사를 하려면 16진수 **문자**가 들어 있어야 한다(숫자뿐이면 toUpperCase 가 자기 자신) */
const DEV = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const ok: Submission = { d: DEV, na: 0, nb: 1, c: 100, s: 10, p: 600_000 };
const NOW = Date.UTC(2026, 6, 29, 3, 0, 0);

const prevAt = (over: Partial<Prev> = {}): Prev =>
  ({ correct: 0, stage: 0, playMs: 0, updated: NOW, firstSeen: NOW, ...over });

describe('순위 계약 · 진실원 단일화', () => {
  /**
   * 🔴 이 두 줄이 없으면: 별명 목록만 늘리고 NICK_N 을 안 고쳤을 때
   *    8·9번 인덱스를 뽑은 아이의 제출만 'bad name' 으로 조용히 거절된다.
   *    타입체크·린트·나머지 테스트 어느 것도 그 상황을 잡지 못한다.
   */
  it('별명 목록 길이가 서버 계약과 일치한다', () => {
    expect(NICK_A).toHaveLength(NICK_N);
    expect(NICK_B).toHaveLength(NICK_N);
  });

  it('세이브 정규화와 서버가 같은 UUID 검사를 쓴다', () => {
    // schema.ts 는 이 정규식을 공유 계약에서 import 한다 — 복붙본이 없어야 한다
    expect(normalize({ data: { board: { device: DEV } } }).board.device).toBe(DEV);
    expect(UUID_RE.test(DEV)).toBe(true);
  });
});

describe('순위 서버 · 입력 검증', () => {
  it('정상 제출을 통과시킨다', () => {
    expect(validate(ok)).toEqual(ok);
  });

  it('🔴 별명 자리에 문자열이 오면 거절한다 (실명 유입 경로 차단)', () => {
    for (const bad of ['김철수', '서울초 3학년 2반', '', 0.5, null, ['a']]) {
      expect(validate({ ...ok, na: bad })).toBe('bad name');
      expect(validate({ ...ok, nb: bad })).toBe('bad name');
    }
  });

  it('별명 인덱스는 목록 범위 밖이면 거절한다', () => {
    expect(validate({ ...ok, na: -1 })).toBe('bad name');
    expect(validate({ ...ok, na: NICK_N })).toBe('bad name');
    expect(validate({ ...ok, na: NICK_N - 1 })).not.toBe('bad name');
  });

  it('기기 토큰은 UUID v4 형식만 받는다', () => {
    const bads = [
      '', 'admin', '1111',
      DEV.toUpperCase(),                            // 대문자
      'a1b2c3d4-e5f6-9a7b-8c9d-e0f1a2b3c4d5',       // 버전 자리가 4가 아님
      'a1b2c3d4-e5f6-4a7b-fc9d-e0f1a2b3c4d5',       // variant 자리가 8~b가 아님
      `${DEV} or 1=1`, `${DEV}'--`,                 // 덧붙이기
      `a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5\n`,     // 줄바꿈 (앵커 확인)
    ];
    for (const bad of bads) {
      expect(validate({ ...ok, d: bad }), `"${bad}" 가 통과했다`).toBe('bad device');
    }
  });

  it('본문이 객체가 아니면 거절한다', () => {
    for (const bad of [null, 123, 'x', [], [ok]]) expect(validate(bad)).toBe('bad body');
  });

  it('정수가 아니거나 상한을 넘는 값을 거절한다', () => {
    expect(validate({ ...ok, c: 1.5 })).toBe('bad correct');
    expect(validate({ ...ok, c: MAX.correct + 1 })).toBe('bad correct');
    expect(validate({ ...ok, s: -1 })).toBe('bad stage');
    expect(validate({ ...ok, s: MAX.stage + 1 })).toBe('bad stage');
    expect(validate({ ...ok, p: MAX.playMs + 1 })).toBe('bad playMs');
    expect(validate({ ...ok, c: NaN })).toBe('bad correct');
    expect(validate({ ...ok, c: Infinity })).toBe('bad correct');
  });

  /**
   * 🔴 예전 상한(정답 10만·판 9999)은 "말도 안 되는 숫자"를 순위표에 그대로 띄웠다.
   *    상한이 현실과 동떨어지면 조작이 아니어도 순위표가 고장 난 것처럼 보인다.
   */
  it('표시 상한이 실측 범위에 붙어 있다', () => {
    expect(MAX.correct).toBeLessThanOrEqual(5_000);
    expect(MAX.stage).toBeLessThanOrEqual(500);
    expect(MAX.stage).toBeGreaterThan(60);       // 프로브 실측 도달 한계 ST60 보다는 위
  });

  /**
   * 🔴 이걸 안 걸어 두면 여유 시간을 늘리는 순간 시간 상한이 표시 상한을 넘어가
   *    "첫 제출에 최댓값 통과"가 되어 방어가 통째로 무의미해진다. 실제로 그랬다.
   */
  it('첫 제출 여유가 표시 상한보다 확실히 작다 (시간 방어가 죽지 않도록)', () => {
    expect(FIRST_GRACE_MS / MIN_MS_PER_CORRECT).toBeLessThan(MAX.correct);
  });
});

/**
 * 🔴 여기가 이 기능의 심장이다.
 *
 * 처음 설계는 "정답 수 ÷ 플레이 시간"이 말이 되는지만 봤는데, **분자도 분모도
 * 클라이언트가 보내는 값**이라 시간을 크게 위조하면 그냥 통과했다.
 * 배포된 서버에서 실제로 재현했고(정답 10만·9999판이 1위로 등록됨),
 * 교차검증 3개 계열이 전부 같은 지점을 짚었다.
 */
describe('순위 서버 · 시간 상한 (치트 방어의 본체)', () => {
  it('첫 제출은 여유 시간만큼만 인정한다', () => {
    const r = applyCaps({ ...ok, c: MAX.correct, p: MAX.playMs }, null, NOW);
    expect(r.correct).toBe(Math.floor(FIRST_GRACE_MS / MIN_MS_PER_CORRECT));
    expect(r.correct).toBeLessThan(MAX.correct);
  });

  it('🔴 플레이 시간을 일주일로 위조해도 정답 수가 따라 오르지 않는다', () => {
    // 예전에는 이 입력이 그대로 통과해 순위표 1위가 되었다
    const forged = applyCaps({ ...ok, c: MAX.correct, s: MAX.stage, p: MAX.playMs }, null, NOW);
    expect(forged.correct).toBeLessThan(MAX.correct);
    expect(forged.stage).toBe(MAX_FIRST_STAGE);
    expect(forged.playMs).toBe(FIRST_GRACE_MS);
  });

  it('서버가 지켜본 시간이 흐른 만큼만 상한이 올라간다', () => {
    const watched = 600_000; // 서버가 10분 지켜봤다
    const prev = prevAt({ correct: 500, playMs: FIRST_GRACE_MS, firstSeen: NOW - watched });
    const r = applyCaps({ ...ok, c: MAX.correct, p: MAX.playMs }, prev, NOW);
    expect(r.correct).toBe(Math.floor((watched + FIRST_GRACE_MS) / MIN_MS_PER_CORRECT));
    expect(r.correct).toBeLessThan(MAX.correct);
  });

  it('정직한 아이는 상한에 걸리지 않는다 (실측: 한 판 63초에 22~27문항)', () => {
    // 그 주 첫 제출은 한 판 직후다 — 문항 27개
    expect(applyCaps({ ...ok, c: 27, s: 1, p: 70_000 }, null, NOW).correct).toBe(27);
    // 30분을 이어서 한 뒤(서버가 그만큼 지켜봤다) 문항 650개
    const prev = prevAt({ correct: 27, playMs: 70_000, firstSeen: NOW });
    const r = applyCaps({ ...ok, c: 650, s: 12, p: 30 * 60_000 }, prev, NOW + 30 * 60_000);
    expect(r.correct).toBe(650);
    expect(r.stage).toBe(12);
  });

  it('거절이 아니라 깎는다 — 값이 사라지지 않고 다음 제출에서 따라잡는다', () => {
    // 1) 늦게 동의해 여유를 넘는 값을 들고 왔다 → 인정분만 반영
    const first = applyCaps({ ...ok, c: MAX.correct, p: MAX.playMs }, null, NOW);
    expect(first.correct).toBeGreaterThan(0);
    expect(first.correct).toBeLessThan(MAX.correct);
    // 2) 두 시간 뒤 같은 값을 다시 보내면 그동안 흐른 시간만큼 더 인정된다
    const later = applyCaps(
      { ...ok, c: MAX.correct, p: MAX.playMs },
      prevAt({ correct: first.correct, playMs: first.playMs, firstSeen: NOW }),
      NOW + 2 * 3600_000,
    );
    expect(later.correct).toBeGreaterThan(first.correct);
  });

  it('값은 줄어들지 않는다 (되돌리기 시도 방어)', () => {
    const prev = prevAt({ correct: 800, stage: 30, playMs: 900_000, firstSeen: NOW - 7200_000 });
    const r = applyCaps({ ...ok, c: 5, s: 1, p: 1_000 }, prev, NOW);
    expect(r).toMatchObject({ correct: 800, stage: 30, playMs: 900_000 });
  });

  it('첫 제출의 도달 판은 실측 한계보다 조금 위에서 잘린다', () => {
    expect(applyCaps({ ...ok, s: MAX.stage }, null, NOW).stage).toBe(MAX_FIRST_STAGE);
    // 프로브 실측 도달 한계 ST60 은 그대로 통과해야 한다
    expect(applyCaps({ ...ok, s: 60 }, null, NOW).stage).toBe(60);
  });

  it('복귀 플레이어(이번 주 첫 제출, 지난주까지 45판)를 깎지 않는다', () => {
    expect(applyCaps({ ...ok, c: 25, s: 45, p: 70_000 }, null, NOW).stage).toBe(45);
  });

  it('도달 판은 서버가 지켜본 시간만큼만 더 오른다', () => {
    const prev = prevAt({ stage: 20, firstSeen: NOW - 70_000 });
    const r = applyCaps({ ...ok, s: MAX.stage }, prev, NOW);
    expect(r.stage).toBe(20 + Math.floor(70_000 / MIN_MS_PER_STAGE) + 1);
  });
});

describe('순위 서버 · 주 라벨', () => {
  it('같은 주의 월요일과 일요일이 같은 라벨이다', () => {
    const mon = Date.UTC(2026, 6, 27);
    const sun = Date.UTC(2026, 7, 2);
    expect(weekKeyUTC(mon)).toBe(weekKeyUTC(sun));
    expect(weekKeyUTC(sun + 86400000)).not.toBe(weekKeyUTC(sun));
  });

  it('연말연시 경계에서도 ISO 주 규칙을 지킨다', () => {
    // 2027-01-01은 금요일 → ISO 상 2026-W53
    expect(weekKeyUTC(Date.UTC(2026, 11, 27, 23, 59, 59))).toBe('2026-W52');
    expect(weekKeyUTC(Date.UTC(2026, 11, 28))).toBe('2026-W53');
    expect(weekKeyUTC(Date.UTC(2027, 0, 1))).toBe('2026-W53');
    expect(weekKeyUTC(Date.UTC(2027, 0, 4))).toBe('2027-W01');
  });

  /**
   * 🔴 클라이언트가 로컬 날짜로 주를 나누면 KST 월요일 새벽에 클라는 새 주,
   *    서버는 아직 지난 주가 되어 화면 라벨과 실제 순위 데이터가 어긋난다.
   *    양쪽이 이 함수 하나를 쓰기 때문에 그 틈이 없다.
   */
  it('클라이언트와 서버가 같은 함수로 주를 정한다', () => {
    const kstMondayDawn = Date.UTC(2026, 6, 26, 15, 30); // = KST 월 00:30
    expect(weekKeyUTC(kstMondayDawn)).toBe(weekKeyUTC(kstMondayDawn));
    const d = defaultSave();
    bumpWeekly(d, { correct: 5, playMs: 60_000, stage: 1 }, weekKeyUTC(kstMondayDawn));
    expect(submitBodyOf(d, weekKeyUTC(kstMondayDawn))).not.toBeNull();
  });

  const submitBodyOf = (d: ReturnType<typeof defaultSave>, wk: string) => {
    d.board.consent = true;
    d.board.device = DEV;
    return submitBody(d, wk);
  };
});

describe('순위 서버 · CORS', () => {
  it('허용 목록에 없는 오리진을 되비추지 않는다', () => {
    const h = corsHeaders('https://evil.example');
    expect(h['access-control-allow-origin']).not.toBe('https://evil.example');
    expect(h['access-control-allow-origin']).toBe(ALLOWED_ORIGINS[0]);
  });

  it('허용된 오리진은 그대로 돌려준다', () => {
    expect(corsHeaders('https://insushim.github.io')['access-control-allow-origin']).toBe('https://insushim.github.io');
  });
});

describe('표시용 꼬리표', () => {
  it('같은 주 안에서는 고정, 다른 기기와는 구분된다', async () => {
    const a = await tagOf(DEV, '2026-W31');
    expect(await tagOf(DEV, '2026-W31')).toBe(a);
    expect(await tagOf('11112222-3333-4444-8555-666677778888', '2026-W31')).not.toBe(a);
    expect(a).toHaveLength(2);
  });

  /**
   * 🔴 기기마다 꼬리표가 고정이면, 서버 운영자가 아니어도 누구나 공개 순위표를
   *    매주 긁어 특정 아이의 성적 추이를 따라갈 수 있다. 주를 섞어 그 연결을 끊는다.
   */
  it('주가 바뀌면 꼬리표도 바뀐다 (주 간 추적 차단)', async () => {
    const w31 = await tagOf(DEV, '2026-W31');
    const w32 = await tagOf(DEV, '2026-W32');
    const w33 = await tagOf(DEV, '2026-W33');
    expect(new Set([w31, w32, w33]).size).toBeGreaterThan(1);
  });

  it('꼬리표에 기기 토큰 조각이 남지 않는다 (되돌릴 수 없어야 한다)', async () => {
    const t = await tagOf(DEV, '2026-W31');
    expect(DEV).not.toContain(t);
    expect(/^[가-힣]{2}$/.test(t)).toBe(true);
  });
});

describe('클라이언트 · 주간 버킷', () => {
  it('한 판이 끝나면 정답 수·시간이 쌓이고 도달 판은 최댓값만 남는다', () => {
    const d = defaultSave();
    bumpWeekly(d, { correct: 20, playMs: 70_000, stage: 5 }, '2026-W31');
    bumpWeekly(d, { correct: 15, playMs: 60_000, stage: 3 }, '2026-W31');
    expect(d.board).toMatchObject({ week: '2026-W31', correct: 35, playMs: 130_000, stage: 5 });
  });

  it('진 판(stage 0)은 도달 판을 깎지 않는다', () => {
    const d = defaultSave();
    bumpWeekly(d, { correct: 10, playMs: 60_000, stage: 7 }, '2026-W31');
    bumpWeekly(d, { correct: 5, playMs: 40_000, stage: 0 }, '2026-W31');
    expect(d.board.stage).toBe(7);
    expect(d.board.correct).toBe(15);
  });

  it('주가 바뀌면 0에서 다시 시작한다', () => {
    const d = defaultSave();
    bumpWeekly(d, { correct: 99, playMs: 600_000, stage: 30 }, '2026-W31');
    bumpWeekly(d, { correct: 1, playMs: 60_000, stage: 2 }, '2026-W32');
    expect(d.board).toMatchObject({ week: '2026-W32', correct: 1, stage: 2, playMs: 60_000 });
  });

  it('동의하지 않았으면 제출 본문을 만들지 않는다 (요청 자체가 안 나간다)', () => {
    const d = defaultSave();
    bumpWeekly(d, { correct: 20, playMs: 70_000, stage: 5 }, '2026-W31');
    expect(submitBody(d, '2026-W31')).toBeNull();
    d.board.consent = true;                       // 기기 토큰이 없으면 여전히 안 보낸다
    expect(submitBody(d, '2026-W31')).toBeNull();
  });

  it('제출 본문에는 문자열이 기기 토큰 하나뿐이다', () => {
    const d = defaultSave();
    d.board.consent = true;
    d.board.device = DEV;
    bumpWeekly(d, { correct: 20, playMs: 70_000, stage: 5 }, '2026-W31');
    const body = submitBody(d, '2026-W31')!;
    const strings = Object.entries(body).filter(([, v]) => typeof v === 'string');
    expect(strings).toEqual([['d', DEV]]);
    expect(Object.keys(body).sort().join(',')).toBe('c,d,na,nb,p,s');
    expect(validate(body)).toEqual(body);
  });

  it('🔴 지난 주 버킷은 이번 주 순위표에 올라가지 않는다', () => {
    const d = defaultSave();
    d.board.consent = true;
    d.board.device = DEV;
    bumpWeekly(d, { correct: 500, playMs: 600_000, stage: 40 }, '2026-W30');
    expect(submitBody(d, '2026-W31')).toMatchObject({ c: 0, s: 0, p: 0 });
  });

  it('별명은 목록 인덱스로 변환되고, 목록 밖이면 0,0 으로 떨어진다', () => {
    expect(nickIndex(`${NICK_A[3]!} ${NICK_B[5]!}`)).toEqual([3, 5]);
    expect(nickIndex('내 진짜 이름')).toEqual([0, 0]);
    expect(nickIndex('')).toEqual([0, 0]);
  });
});

describe('세이브 · board 필드', () => {
  it('기본값은 보내지 않음이고 기기 토큰도 없다', () => {
    expect(defaultSave().board).toEqual({ device: '', consent: false, week: '', correct: 0, stage: 0, playMs: 0 });
  });

  it('v1·v2 옛 세이브(board 없음)도 기본값으로 채워진다', () => {
    expect(normalize({ version: 1, data: { currency: { meokmul: 10 } } }).board.consent).toBe(false);
  });

  it('형식이 틀린 기기 토큰은 지운다 (서버가 어차피 거절한다)', () => {
    expect(normalize({ data: { board: { device: 'admin', consent: true } } }).board.device).toBe('');
    expect(normalize({ data: { board: { device: DEV, consent: true } } }).board.device).toBe(DEV);
  });

  it('조작된 주간 수치를 계약 상한으로 클램프한다', () => {
    const d = normalize({ data: { board: { correct: 1e9, stage: -5, playMs: 1e15 } } });
    expect(d.board.correct).toBe(MAX.correct);
    expect(d.board.stage).toBe(0);
    expect(d.board.playMs).toBe(MAX.playMs);
  });
});
