import type { QType } from '../edu/curriculum';
import { ALL_TYPE_IDS } from '../edu/curriculum';
import { ALLIES, ALLY_BY_ID, maxLevel, progressionAllies } from '../sim/units';
import { PITY_LEGEND } from '../meta/summon';
import type { SrsItem, SrsState } from '../edu/srs';
import type { TypeStat, WeeklySnapshot } from '../edu/stats';
import { emptyStat } from '../edu/stats';
import { today } from '../edu/date';
// 🔴 순위 서버와 **같은 파일**을 본다. 양쪽에 복붙하면 한쪽만 고쳤을 때
//    특정 별명을 뽑은 아이의 제출만 조용히 거절된다(테스트가 길이 일치를 강제한다).
import { UUID_RE, MAX as BOARD_MAX } from '../../shared/board-contract';

export const SAVE_KEY = 'gugu:save';
export const SAVE_VERSION = 2;

/** 스테이지가 무한이라 상한이 없다 — 다만 손상 세이브가 무한 루프를 만들지 않도록 선은 둔다 */
export const MAX_STAGE_KEY = 9999;

/** 시작 보유 셈지기 — data/roster.json 의 unlock:1 과 일치해야 한다 */
export const STARTER_UNITS = ['jipsin', 'kkachi', 'musoe'];



export interface SaveData {
  profile: { nickname: string; gradeMax: number; createdAt: string };
  progress: { cleared: Record<string, number>; maxStage: number };
  deck: string[];
  /** 보유 셈지기 — 소환·진도로 얻는다. 게임 내 전력의 단일 진실원 */
  roster: Record<string, { level: number; shards: number }>;
  summon: { sinceLegend: number; total: number };
  codex: { unlocked: string[] };
  currency: { meokmul: number; recovered: number };
  edu: {
    theta: Partial<Record<QType, number>>;
    thetaWeekly: WeeklySnapshot[];
    stats: Partial<Record<QType, TypeStat>>;
    playMs: number;
    diagnostics: { date: string; score: number; of: number }[];
    srs: Record<string, SrsItem>;
    retentionLog: { key: string; matured: string; recheck: string; ok: boolean }[];
    rounds: number;
  };
  settings: { sound: boolean; fontScale: 1 | 1.2 | 1.5; reduceMotion: boolean };
  /**
   * 익명 주간 순위. 기본값은 **보내지 않음**이다(consent: false).
   * device 는 순위에 올리겠다고 누른 순간에만 만들어진다 — 안 쓰는 아이는 토큰조차 없다.
   */
  board: {
    device: string;
    consent: boolean;
    /** 이 주간 버킷이 어느 주 것인지. 주가 바뀌면 아래 3개가 0으로 리셋된다 */
    week: string;
    correct: number;
    stage: number;
    playMs: number;
  };
}

export interface SaveFile { version: number; data: SaveData }

export const NICK_A = ['씩씩한', '반짝이는', '용감한', '슬기로운', '재빠른', '든든한', '신나는', '멋진'];
export const NICK_B = ['까치', '해태', '도깨비', '장승', '솥이', '붓대감', '똑딱이', '붕붕이'];

/** 🔴 자유 입력 닉네임은 실명 입력 위험이 있다 → 자동 생성 */
export function randomNickname(rand: () => number = Math.random): string {
  const a = NICK_A[Math.floor(rand() * NICK_A.length)]!;
  const b = NICK_B[Math.floor(rand() * NICK_B.length)]!;
  return `${a} ${b}`;
}

/**
 * 별명 → 목록 인덱스 두 개.
 *
 * 🔴 순위 서버에는 별명을 **문자열로 보내지 않고 이 인덱스만** 보낸다.
 *    그래야 순위표에 실명이 올라갈 경로가 물리적으로 없다(server/src/index.ts 머리말).
 *    목록에 없는 값(손으로 고친 세이브)은 0,0 으로 떨어뜨린다.
 */
export function nickIndex(nickname: string): [number, number] {
  const [a, b] = nickname.split(' ');
  return [Math.max(0, NICK_A.indexOf(a ?? '')), Math.max(0, NICK_B.indexOf(b ?? ''))];
}

export function defaultSave(): SaveData {
  return {
    profile: { nickname: randomNickname(), gradeMax: 4, createdAt: today() },
    progress: { cleared: {}, maxStage: 0 },
    deck: [],
    roster: Object.fromEntries(STARTER_UNITS.map((id) => [id, { level: 1, shards: 0 }])),
    summon: { sinceLegend: 0, total: 0 },
    codex: { unlocked: [...STARTER_UNITS] },
    currency: { meokmul: 0, recovered: 0 },
    edu: { theta: {}, thetaWeekly: [], stats: {}, playMs: 0, diagnostics: [], srs: {}, retentionLog: [], rounds: 0 },
    settings: { sound: true, fontScale: 1, reduceMotion: false },
    board: { device: '', consent: false, week: '', correct: 0, stage: 0, playMs: 0 },
  };
}

// ── 화이트리스트 정규화 ────────────────────────────────────────────────────
// 🔴 손상 세이브 방어를 try/catch에 기대지 말 것.
//    `Object.values(123)`·`Object.entries("")`는 **예외 없이 빈 배열**을 반환해 catch에 안 걸리고,
//    잘못된 타입이 그대로 상태에 남아 나중에 터진다.
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const arr = <T>(v: unknown, map: (x: unknown) => T | null): T[] =>
  Array.isArray(v) ? v.map(map).filter((x): x is T => x !== null) : [];

const SRS_STATES: SrsState[] = ['학습중', '익힘', '다짐', '완성'];

function normStat(v: unknown): TypeStat {
  if (!isObj(v)) return emptyStat();
  const attempts = Math.floor(num(v['attempts'], 0, 0));
  return {
    attempts,
    correct: Math.floor(num(v['correct'], 0, 0, attempts)),
    correctFast: Math.floor(num(v['correctFast'], 0, 0, attempts)),
    answerMs: num(v['answerMs'], 0, 0),
  };
}

function normSrs(v: unknown): Record<string, SrsItem> {
  const out: Record<string, SrsItem> = {};
  if (!isObj(v)) return out;
  for (const [key, raw] of Object.entries(v)) {
    if (!isObj(raw)) continue;
    const state = SRS_STATES.includes(raw['state'] as SrsState) ? (raw['state'] as SrsState) : '학습중';
    out[key] = {
      key,
      state,
      streak: Math.floor(num(raw['streak'], 0, 0, 5)),
      dueAt: str(raw['dueAt'], today()),
      lastServedAt: str(raw['lastServedAt'], today()),
    };
  }
  return out;
}

export function normalize(input: unknown): SaveData {
  const base = defaultSave();
  const file = isObj(input) ? input : {};
  const d = isObj(file['data']) ? (file['data'] as Record<string, unknown>) : {};

  const profile = isObj(d['profile']) ? d['profile'] : {};
  const progress = isObj(d['progress']) ? d['progress'] : {};
  const codex = isObj(d['codex']) ? d['codex'] : {};
  const currency = isObj(d['currency']) ? d['currency'] : {};
  const edu = isObj(d['edu']) ? d['edu'] : {};
  const settings = isObj(d['settings']) ? d['settings'] : {};
  const board = isObj(d['board']) ? d['board'] : {};

  const cleared: Record<string, number> = {};
  if (isObj(progress['cleared'])) {
    for (const [k, v] of Object.entries(progress['cleared'])) {
      const n = Number(k);
      if (Number.isInteger(n) && n >= 1 && n <= MAX_STAGE_KEY) cleared[k] = Math.floor(num(v, 0, 0, 3));
    }
  }
  const clearedMax = Object.keys(cleared).reduce((m, k) => Math.max(m, Number(k)), 0);

  // ── 보유 셈지기 ────────────────────────────────────────────────────────
  // v1 세이브에는 roster 가 없다. 그때는 codex.unlocked 가 사실상 보유 목록이었으므로
  // 그대로 승격시킨다. 진도로 이미 열렸어야 할 유닛도 채워 넣는다 — 안 그러면
  // 업데이트 후 기존 플레이어의 셈지기가 사라진 것처럼 보인다.
  const rosterIn = isObj(d['roster']) ? d['roster'] : {};
  const roster: Record<string, { level: number; shards: number }> = {};
  const validIds = new Set(ALLIES.map((u) => u.id));
  for (const [id, raw] of Object.entries(rosterIn)) {
    if (!validIds.has(id) || !isObj(raw)) continue;
    const unit = ALLY_BY_ID.get(id)!;
    roster[id] = {
      level: Math.floor(num(raw['level'], 1, 1, maxLevel(unit.rarity))),
      shards: Math.floor(num(raw['shards'], 0, 0, 99999)),
    };
  }
  const legacyOwned = arr(codex['unlocked'], (x) => (typeof x === 'string' ? x : null));
  for (const id of [...STARTER_UNITS, ...legacyOwned]) {
    if (validIds.has(id) && !roster[id]) roster[id] = { level: 1, shards: 0 };
  }
  for (const u of progressionAllies(clearedMax)) {
    if (!roster[u.id]) roster[u.id] = { level: 1, shards: 0 };
  }

  const summon = isObj(d['summon']) ? d['summon'] : {};

  const theta: Partial<Record<QType, number>> = {};
  if (isObj(edu['theta'])) {
    for (const [k, v] of Object.entries(edu['theta'])) {
      if (ALL_TYPE_IDS.includes(k as QType)) theta[k as QType] = num(v, 1200, 400, 2400);
    }
  }
  const stats: Partial<Record<QType, TypeStat>> = {};
  if (isObj(edu['stats'])) {
    for (const [k, v] of Object.entries(edu['stats'])) {
      if (ALL_TYPE_IDS.includes(k as QType)) stats[k as QType] = normStat(v);
    }
  }

  const fontScaleRaw = num(settings['fontScale'], 1);
  const fontScale: 1 | 1.2 | 1.5 = fontScaleRaw === 1.2 ? 1.2 : fontScaleRaw === 1.5 ? 1.5 : 1;

  return {
    profile: {
      nickname: str(profile['nickname'], base.profile.nickname).slice(0, 20),
      gradeMax: Math.floor(num(profile['gradeMax'], 4, 1, 6)),
      createdAt: str(profile['createdAt'], base.profile.createdAt),
    },
    progress: {
      cleared,
      maxStage: Math.max(clearedMax, Math.floor(num(progress['maxStage'], 0, 0, MAX_STAGE_KEY))),
    },
    // 🔴 덱은 **보유한 유닛만** 남긴다. 없는 id가 남아 있으면 출전 화면이 빈 칸을 그린다.
    deck: arr(d['deck'], (x) => (typeof x === 'string' ? x : null))
      .filter((id) => roster[id])
      .slice(0, 5),
    roster,
    summon: {
      sinceLegend: Math.floor(num(summon['sinceLegend'], 0, 0, PITY_LEGEND)),
      total: Math.floor(num(summon['total'], 0, 0, 999999)),
    },
    codex: {
      unlocked: [...new Set([...STARTER_UNITS, ...legacyOwned.filter((id) => validIds.has(id)), ...Object.keys(roster)])],
    },
    currency: {
      meokmul: Math.floor(num(currency['meokmul'], 0, 0, 999999)),
      recovered: Math.floor(num(currency['recovered'], 0, 0, 999999)),
    },
    edu: {
      theta,
      thetaWeekly: arr(edu['thetaWeekly'], (x) => {
        if (!isObj(x)) return null;
        const t: Partial<Record<QType, number>> = {};
        if (isObj(x['theta'])) {
          for (const [k, v] of Object.entries(x['theta'])) {
            if (ALL_TYPE_IDS.includes(k as QType)) t[k as QType] = num(v, 1200, 400, 2400);
          }
        }
        return { week: str(x['week'], ''), theta: t };
      }).filter((x) => x.week !== '').slice(-52),
      stats,
      playMs: num(edu['playMs'], 0, 0),
      diagnostics: arr(edu['diagnostics'], (x) =>
        isObj(x) ? { date: str(x['date'], today()), score: Math.floor(num(x['score'], 0, 0)), of: Math.floor(num(x['of'], 20, 1)) } : null,
      ).slice(-24),
      srs: normSrs(edu['srs']),
      retentionLog: arr(edu['retentionLog'], (x) =>
        isObj(x) ? { key: str(x['key'], ''), matured: str(x['matured'], ''), recheck: str(x['recheck'], ''), ok: bool(x['ok'], false) } : null,
      ).filter((x) => x.key !== '').slice(-300),
      rounds: Math.floor(num(edu['rounds'], 0, 0)),
    },
    settings: {
      sound: bool(settings['sound'], true),
      fontScale,
      reduceMotion: bool(settings['reduceMotion'], false),
    },
    board: {
      // 🔴 device 는 UUID v4 형식만 남긴다. 형식이 틀리면 서버가 어차피 거절하므로
      //    여기서 지워서 다음에 정상적으로 다시 만들게 한다.
      device: UUID_RE.test(str(board['device'], '')) ? str(board['device'], '') : '',
      consent: bool(board['consent'], false),
      week: str(board['week'], ''),
      correct: Math.floor(num(board['correct'], 0, 0, BOARD_MAX.correct)),
      stage: Math.floor(num(board['stage'], 0, 0, BOARD_MAX.stage)),
      playMs: num(board['playMs'], 0, 0, 7 * 24 * 3600 * 1000),
    },
  };
}

/**
 * 마이그레이션 체인.
 *
 * v0(버전 필드 없음) → v1 → v2 전부 `normalize()` 하나로 흡수된다:
 *  - v1 의 `codex.unlocked` 는 보유 목록이었으므로 `roster` 로 승격된다
 *  - v1 의 `progress.challengeCleared` 는 사라졌다(11번 도전 → 매 구역 수문장으로 대체).
 *    버리는 필드라 별도 처리가 필요 없다 — 화이트리스트가 알아서 떨군다.
 *  - 클리어 기록·먹물·SRS·통계·θ 시계열은 그대로 보존된다.
 *
 * 🔴 단계별 함수로 쪼개지 않는 이유: 정규화가 이미 "어떤 입력에서도 유효한 v2"를 만든다.
 *    단계를 나누면 v1 판정 로직이 하나 더 생기고, 그 판정이 틀리면 기록이 날아간다.
 */
export function migrate(raw: unknown): SaveData {
  return normalize(raw);
}
