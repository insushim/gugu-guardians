import type { QType } from '../edu/curriculum';
import { ALL_TYPE_IDS } from '../edu/curriculum';
import type { SrsItem, SrsState } from '../edu/srs';
import type { TypeStat, WeeklySnapshot } from '../edu/stats';
import { emptyStat } from '../edu/stats';
import { today } from '../edu/date';

export const SAVE_KEY = 'gugu:save';
export const SAVE_VERSION = 1;

export interface SaveData {
  profile: { nickname: string; gradeMax: number; createdAt: string };
  progress: { cleared: Record<string, number>; challengeCleared: boolean };
  deck: string[];
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
}

export interface SaveFile { version: number; data: SaveData }

const NICK_A = ['씩씩한', '반짝이는', '용감한', '슬기로운', '재빠른', '든든한', '신나는', '멋진'];
const NICK_B = ['까치', '해태', '도깨비', '장승', '솥이', '붓대감', '똑딱이', '붕붕이'];

/** 🔴 자유 입력 닉네임은 실명 입력 위험이 있다 → 자동 생성 */
export function randomNickname(rand: () => number = Math.random): string {
  const a = NICK_A[Math.floor(rand() * NICK_A.length)]!;
  const b = NICK_B[Math.floor(rand() * NICK_B.length)]!;
  return `${a} ${b}`;
}

export function defaultSave(): SaveData {
  return {
    profile: { nickname: randomNickname(), gradeMax: 4, createdAt: today() },
    progress: { cleared: {}, challengeCleared: false },
    deck: [],
    codex: { unlocked: ['kkachi', 'musoe'] },
    currency: { meokmul: 0, recovered: 0 },
    edu: { theta: {}, thetaWeekly: [], stats: {}, playMs: 0, diagnostics: [], srs: {}, retentionLog: [], rounds: 0 },
    settings: { sound: true, fontScale: 1, reduceMotion: false },
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

  const cleared: Record<string, number> = {};
  if (isObj(progress['cleared'])) {
    for (const [k, v] of Object.entries(progress['cleared'])) {
      const n = Number(k);
      if (Number.isInteger(n) && n >= 1 && n <= 11) cleared[k] = Math.floor(num(v, 0, 0, 3));
    }
  }

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
    progress: { cleared, challengeCleared: bool(progress['challengeCleared'], false) },
    deck: arr(d['deck'], (x) => (typeof x === 'string' ? x : null)).slice(0, 5),
    codex: {
      unlocked: [...new Set(['kkachi', 'musoe', ...arr(codex['unlocked'], (x) => (typeof x === 'string' ? x : null))])],
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
  };
}

/** 마이그레이션 체인 — 버전이 늘어나면 여기에 단계를 추가한다 */
export function migrate(raw: unknown): SaveData {
  // v0(버전 필드 없음) → v1: 정규화만으로 흡수된다
  return normalize(raw);
}
