/**
 * 구구성 수호대 · 익명 주간 순위 Worker
 *
 * 설계 원칙 (아동 대상 서비스라 여기서 타협하지 않는다):
 *
 *  1. 🔴 **API에 자유 문자열 필드가 없다.** 별명은 문자열이 아니라 자동생성 목록의
 *     인덱스 두 개(na, nb: 0~7)로만 들어온다. 그래서 아이가 실명·학교·연락처를
 *     순위표에 올릴 경로가 **물리적으로 존재하지 않는다.** 문자열을 받아 놓고
 *     걸러내는 방식은 언제나 뚫린다 — 애초에 받지 않는 게 유일하게 확실한 방법이다.
 *  2. 로그인이 없다. device 는 클라이언트가 만든 난수 UUID이고 계정도 기기지문도 아니다.
 *  3. IP·User-Agent 를 저장하지 않는다.
 *  4. 저장하는 유일한 지속 식별자가 device UUID다. 최장 8주 보관되며,
 *     아이가 "그만 올리기"를 누르면 `/forget` 으로 **그 자리에서 지운다**.
 *
 * 저장소로 D1 이 아니라 **SQLite 기반 Durable Object** 를 쓴다:
 *  - 순위 갱신은 read-modify-write 라 강한 일관성이 필요하다. DO 는 단일 객체로
 *    요청이 직렬화되므로 동시 제출이 서로를 덮어쓰지 않는다.
 *  - 무료 플랜에서 DO(SQLite)는 개수 제한이 없다. D1 은 계정당 10개 상한이라
 *    쓰려면 다른 프로젝트의 DB를 지워야 했다.
 *
 * 규칙·검증·상한은 전부 `shared/board-contract.ts` 에 있다 —
 * 클라이언트와 **같은 파일**을 쓴다(양쪽 복붙이 어긋나는 사고를 구조적으로 없앤다).
 */
import { DurableObject } from 'cloudflare:workers';
import {
  TOP_N, KEEP_WEEKS, WEEK_MS, MIN_SUBMIT_GAP_MS, MAX_DEVICES_PER_WEEK,
  corsHeaders, weekKeyUTC, validate, applyCaps, tagOf, UUID_RE, type Prev,
} from '../../shared/board-contract';

export interface Env {
  BOARD: DurableObjectNamespace<BoardDO>;
}

/** SqlStorage 의 행 타입은 인덱스 시그니처를 요구한다 */
interface Row { na: number; nb: number; device: string; correct: number; stage: number; [k: string]: SqlStorageValue }
interface Entry { na: number; nb: number; tag: string; v: number }
interface Rank { practice: number; challenge: number }
export interface BoardPayload { week: string; practice: Entry[]; challenge: Entry[] }

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(origin),
    },
  });
}

function toEntries(rows: Row[], week: string, pick: (r: Row) => number): Promise<Entry[]> {
  return Promise.all(rows.map(async (r) => ({ na: r.na, nb: r.nb, tag: await tagOf(r.device, week), v: pick(r) })));
}

// ── 순위표 Durable Object ─────────────────────────────────────────────────
export class BoardDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // 🔴 스키마 생성은 blockConcurrencyWhile 안에서. 밖에서 하면 첫 요청이
    //    테이블 생성보다 먼저 도착해 "no such table" 로 터진다.
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS score (
          week       TEXT    NOT NULL,
          device     TEXT    NOT NULL,
          na         INTEGER NOT NULL,
          nb         INTEGER NOT NULL,
          correct    INTEGER NOT NULL DEFAULT 0,
          stage      INTEGER NOT NULL DEFAULT 0,
          play_ms    INTEGER NOT NULL DEFAULT 0,
          updated    INTEGER NOT NULL,
          -- 🔴 서버가 이 기기를 그 주에 처음 본 시각. 클라이언트가 못 건드리는 유일한 시간 기준이라
          --    치트 방어(applyCaps)의 분모가 된다.
          first_seen INTEGER NOT NULL,
          PRIMARY KEY (week, device)
        );
      `);
      this.sql.exec('CREATE INDEX IF NOT EXISTS idx_week_correct ON score (week, correct DESC);');
      this.sql.exec('CREATE INDEX IF NOT EXISTS idx_week_stage   ON score (week, stage   DESC);');
    });
  }

  async boards(week: string): Promise<BoardPayload> {
    const p = this.sql.exec<Row>(
      'SELECT na, nb, device, correct, stage FROM score WHERE week = ? AND correct > 0 ORDER BY correct DESC, updated ASC LIMIT ?',
      week, TOP_N,
    ).toArray();
    const c = this.sql.exec<Row>(
      'SELECT na, nb, device, correct, stage FROM score WHERE week = ? AND stage > 0 ORDER BY stage DESC, updated ASC LIMIT ?',
      week, TOP_N,
    ).toArray();
    return {
      week,
      practice: await toEntries(p, week, (r) => r.correct),
      challenge: await toEntries(c, week, (r) => r.stage),
    };
  }

  private rankOf(week: string, correct: number, stage: number): Rank {
    const p = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM score WHERE week = ? AND correct > ?', week, correct).one();
    const c = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM score WHERE week = ? AND stage > ?', week, stage).one();
    return { practice: p.n + 1, challenge: c.n + 1 };
  }

  private prevOf(week: string, device: string): Prev | null {
    const r = this.sql.exec<{ correct: number; stage: number; play_ms: number; updated: number; first_seen: number }>(
      'SELECT correct, stage, play_ms, updated, first_seen FROM score WHERE week = ? AND device = ?', week, device,
    ).toArray()[0];
    return r ? { correct: r.correct, stage: r.stage, playMs: r.play_ms, updated: r.updated, firstSeen: r.first_seen } : null;
  }

  async submit(body: unknown, now: number): Promise<{ status: number; payload: Record<string, unknown> }> {
    const v = validate(body);
    if (typeof v === 'string') return { status: 400, payload: { error: v } };

    const week = weekKeyUTC(now);
    const prev = this.prevOf(week, v.d);

    // 너무 잦은 제출은 값만 무시한다 — 아이 화면에 실패를 띄울 이유가 없다.
    // 값은 누적이라 다음 제출(다음 전투 뒤)에 자연히 따라잡는다.
    if (prev && now - prev.updated < MIN_SUBMIT_GAP_MS) {
      return {
        status: 200,
        payload: {
          ok: true, throttled: true, week,
          rank: this.rankOf(week, prev.correct, prev.stage),
          mine: { correct: prev.correct, stage: prev.stage },
        },
      };
    }

    // 🔴 새 기기 폭주 방어: 스크립트로 매번 새 UUID 를 만들어 순위표를 도배하는 걸 막는다.
    //    기존 참가자는 상한과 무관하게 계속 갱신된다.
    if (!prev) {
      const n = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM score WHERE week = ?', week).one().n;
      if (n >= MAX_DEVICES_PER_WEEK) return { status: 429, payload: { error: 'week full' } };
    }

    const capped = applyCaps(v, prev, now);
    const firstSeen = prev?.firstSeen ?? now;

    this.sql.exec(
      `INSERT INTO score (week, device, na, nb, correct, stage, play_ms, updated, first_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(week, device) DO UPDATE SET
         na = excluded.na, nb = excluded.nb, correct = excluded.correct,
         stage = excluded.stage, play_ms = excluded.play_ms, updated = excluded.updated`,
      week, v.d, v.na, v.nb, capped.correct, capped.stage, capped.playMs, now, firstSeen,
    );

    this.sweep(week);
    return {
      status: 200,
      payload: { ok: true, week, rank: this.rankOf(week, capped.correct, capped.stage), mine: { correct: capped.correct, stage: capped.stage } },
    };
  }

  /**
   * "그만 올리기" — 그 기기의 기록을 **모든 주에서** 지운다.
   * 🔴 동의를 껐는데 이미 올라간 기록이 그대로 남아 있으면 문구와 실제 동작이 다르다.
   */
  async forget(device: unknown): Promise<{ status: number; payload: Record<string, unknown> }> {
    if (typeof device !== 'string' || !UUID_RE.test(device)) return { status: 400, payload: { error: 'bad device' } };
    this.sql.exec('DELETE FROM score WHERE device = ?', device);
    return { status: 200, payload: { ok: true } };
  }

  /** 보존 기간이 지난 주를 지운다. 쓰기 경로에서 곁다리로 돈다(크론 없이 유지보수) */
  private sweep(week: string): void {
    const cutoff = weekKeyUTC(Date.now() - KEEP_WEEKS * WEEK_MS);
    if (cutoff >= week) return;
    this.sql.exec('DELETE FROM score WHERE week < ?', cutoff);
  }
}

// ── 워커 진입점 ───────────────────────────────────────────────────────────
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('origin');
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });

    // 순위표는 하나뿐이라 고정 이름으로 단일 객체를 쓴다
    const stub = env.BOARD.get(env.BOARD.idFromName('board-v2'));

    try {
      if (req.method === 'GET' && url.pathname === '/board') {
        return json(await stub.boards(weekKeyUTC(Date.now())), 200, origin);
      }
      if (req.method === 'POST' && (url.pathname === '/submit' || url.pathname === '/forget')) {
        let body: unknown = null;
        try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400, origin); }
        const { status, payload } = url.pathname === '/submit'
          ? await stub.submit(body, Date.now())
          : await stub.forget((body as { d?: unknown } | null)?.d);
        return json(payload, status, origin);
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        return json({ ok: true, week: weekKeyUTC(Date.now()) }, 200, origin);
      }
    } catch (e) {
      console.error('board worker', e);
      return json({ error: 'server' }, 500, origin);
    }
    return json({ error: 'not found' }, 404, origin);
  },
};
