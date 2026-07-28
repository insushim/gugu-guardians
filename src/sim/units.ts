import type { UnitDef, EnemyDef } from './types';

/**
 * 셈지기(아군) 8종 — 수치는 tools/balance-probe.mjs 실측과 1:1로 일치해야 한다.
 * 🔴 이 파일과 프로브가 어긋나면 GDD의 밸런스 표가 무효가 된다.
 *    tests/data-parity.spec.ts 가 자동 대조한다.
 */
export const ALLIES: readonly UnitDef[] = [
  { id: 'kkachi',    name: '까치돌이',   cost: 45,  hp: 240,  atk: 26,  aspd: 1.0, range: 40,  spd: 58, cd: 2.0,  unlock: 1, role: '싸고 빠른 물량' },
  { id: 'musoe',     name: '무쇠솥이',   cost: 90,  hp: 620,  atk: 18,  aspd: 1.3, range: 40,  spd: 38, cd: 5.0,  unlock: 1, role: '앞을 막는 방패' },
  { id: 'bungbung',  name: '붕붕이',     cost: 130, hp: 210,  atk: 52,  aspd: 1.5, range: 190, spd: 44, cd: 6.0,  unlock: 2, role: '뒤에서 쏘는 활' },
  { id: 'dokkabi',   name: '먹도깨비',   cost: 210, hp: 420,  atk: 130, aspd: 2.0, range: 60,  spd: 66, cd: 9.0,  unlock: 3, role: '한 방이 센 돌격' },
  { id: 'haetae',    name: '해태장군',   cost: 340, hp: 1500, atk: 95,  aspd: 1.8, range: 55,  spd: 32, cd: 14.0, unlock: 5, role: '단단한 중장갑' },
  { id: 'ttokttak',  name: '똑딱이',     cost: 160, hp: 300,  atk: 40,  aspd: 0.7, range: 45,  spd: 50, cd: 6.5,  unlock: 6, role: '아주 빠른 연타' },
  { id: 'butdaegam', name: '붓대감',     cost: 260, hp: 380,  atk: 88,  aspd: 1.4, range: 230, spd: 40, cd: 10.0, unlock: 7, role: '가장 멀리 쏜다' },
  { id: 'jangseung', name: '장승수문장', cost: 520, hp: 2600, atk: 150, aspd: 2.2, range: 60,  spd: 26, cd: 22.0, unlock: 9, role: '거대한 벽' },
] as const;

/** 엉킴괴수(적) — 등장 순서대로 */
export const ENEMIES: readonly EnemyDef[] = [
  { id: 'e_mul',  name: '물음표벌레',  hp: 260,  atk: 24,  aspd: 1.1, range: 40,  spd: 42, role: '기본' },
  { id: 'e_bat',  name: '뒤집힌박쥐',  hp: 180,  atk: 34,  aspd: 0.9, range: 40,  spd: 66, role: '빠름' },
  { id: 'e_arch', name: '삐뚤활잡이',  hp: 240,  atk: 58,  aspd: 1.7, range: 200, spd: 36, role: '원거리' },
  { id: 'e_rock', name: '엉킴바위',    hp: 1400, atk: 60,  aspd: 2.0, range: 45,  spd: 22, role: '단단함' },
  { id: 'e_boss', name: '뒤죽박죽왕',  hp: 4000, atk: 50,  aspd: 2.2, range: 90,  spd: 0,  role: '고정 수문장' },
] as const;

export const ALLY_BY_ID = new Map(ALLIES.map((u) => [u.id, u] as const));
export const ENEMY_BY_ID = new Map(ENEMIES.map((e) => [e.id, e] as const));

/** 출전 덱 크기 (GDD 1-4) */
export const DECK_SIZE = 5;
/** 동시 출전 상한 — 없으면 유닛이 무한 누적된다 */
export const ALLY_CAP = 60;

export function unlockedAllies(stage: number): UnitDef[] {
  const s = Math.min(stage, 10);
  return ALLIES.filter((u) => u.unlock <= s);
}

/** 기본 덱 추천: 최저가 물량 1 + 탱커 1 고정 + 나머지는 비용 상위 (프로브 정책과 동일) */
export function defaultDeck(stage: number): string[] {
  const unlocked = unlockedAllies(stage);
  const fixed = ['kkachi', 'musoe'].filter((id) => unlocked.some((u) => u.id === id));
  const rest = unlocked
    .filter((u) => !fixed.includes(u.id))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, DECK_SIZE - fixed.length)
    .map((u) => u.id);
  return [...fixed, ...rest];
}
