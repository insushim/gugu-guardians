import { describe, it, expect } from 'vitest';
import {
  MISSIONS, DAILY_N, DAILY_BONUS, missionsFor, emptyDaily, rollDaily,
  bump, isDone, allDone, claimable, claim,
} from '../src/meta/daily';
import { normalize, defaultSave, SAVE_VERSION } from '../src/save/schema';
import { addDays, today } from '../src/edu/date';

const D1 = '2026-08-20';
const D2 = '2026-08-21';

describe('오늘의 임무 — 생성', () => {
  it('같은 날이면 언제 불러도 같은 임무다 (저장하지 않아도 되는 근거)', () => {
    expect(missionsFor(D1)).toEqual(missionsFor(D1));
  });

  it('날이 바뀌면 임무도 바뀐다', () => {
    // 며칠을 훑어 "항상 똑같지는 않다"를 본다 — 하루만 비교하면 우연히 같을 수 있다
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(missionsFor(addDays(D1, i)).map((m) => m.id).join(','));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('하루에 세 개, 서로 다른 종류다 (같은 임무가 두 줄 나오지 않는다)', () => {
    for (let i = 0; i < 400; i++) {
      const ms = missionsFor(addDays(D1, i));
      expect(ms).toHaveLength(DAILY_N);
      expect(new Set(ms.map((m) => m.id)).size).toBe(DAILY_N);
    }
  });

  it('목표치는 항상 그 임무의 후보 중 하나이고 1 이상이다', () => {
    const byId = new Map(MISSIONS.map((m) => [m.id, m]));
    for (let i = 0; i < 400; i++) {
      for (const m of missionsFor(addDays(D1, i))) {
        expect(byId.get(m.id)!.goals).toContain(m.goal);
        expect(m.goal).toBeGreaterThan(0);
        expect(m.reward).toBeGreaterThan(0);
        expect(m.text).toContain(String(m.goal));
      }
    }
  });
});

describe('오늘의 임무 — 진행과 보상', () => {
  const goalOf = (i: number, day = D1): number => missionsFor(day)[i]!.goal;

  it('진행도는 목표치를 넘지 않는다', () => {
    const id = missionsFor(D1)[0]!.id;
    const s = bump(emptyDaily(D1), id, 9999, D1);
    expect(s.progress[0]).toBe(goalOf(0));
  });

  it('목표를 채우면 완료로 잡히고 보상이 열린다', () => {
    const m = missionsFor(D1)[0]!;
    const s = bump(emptyDaily(D1), m.id, m.goal, D1);
    expect(isDone(s, 0, D1)).toBe(true);
    expect(claimable(s, D1)).toBe(m.reward);
  });

  it('한 번 받은 보상은 다시 받을 수 없다', () => {
    const m = missionsFor(D1)[0]!;
    const s = bump(emptyDaily(D1), m.id, m.goal, D1);
    const first = claim(s, D1);
    expect(first.ink).toBe(m.reward);
    expect(claimable(first.state, D1)).toBe(0);
    expect(claim(first.state, D1).ink).toBe(0);
  });

  it('셋 다 하면 덤이 붙고, 덤도 한 번만 받는다', () => {
    let s = emptyDaily(D1);
    const ms = missionsFor(D1);
    ms.forEach((m) => { s = bump(s, m.id, m.goal, D1); });
    expect(allDone(s, D1)).toBe(true);
    const total = ms.reduce((a, m) => a + m.reward, 0) + DAILY_BONUS;
    const r = claim(s, D1);
    expect(r.ink).toBe(total);
    expect(claimable(r.state, D1)).toBe(0);
  });

  /**
   * 🔴 이 두 개가 이 파일의 핵심이다 — 임무를 "하지 않고" 달성하는 경로가 있으면
   *    임무는 학습 목표가 아니라 파밍 대상이 된다.
   */
  it('연속 정답은 **최고 기록**으로 센다 — 3콤보 세 판이 8콤보가 되지 않는다', () => {
    // combo 임무가 나오는 날을 찾아서 검사한다(날마다 임무 구성이 다르므로)
    let day = D1;
    for (let i = 0; i < 400; i++) {
      const d = addDays(D1, i);
      if (missionsFor(d).some((m) => m.id === 'combo')) { day = d; break; }
    }
    const idx = missionsFor(day).findIndex((m) => m.id === 'combo');
    expect(idx).toBeGreaterThanOrEqual(0);
    let s = emptyDaily(day);
    s = bump(s, 'combo', 3, day);
    s = bump(s, 'combo', 3, day);
    s = bump(s, 'combo', 3, day);
    expect(s.progress[idx]).toBe(3);            // 9가 되면 안 된다
    // 더 잘한 판이 나오면 갱신된다 — 목표치를 넘지는 않는다(그날 목표는 5나 8이다)
    const goal = missionsFor(day)[idx]!.goal;
    s = bump(s, 'combo', 4, day);
    expect(s.progress[idx]).toBe(Math.min(goal, 4));
    s = bump(s, 'combo', 99, day);
    expect(s.progress[idx]).toBe(goal);
  });

  it('누적형(문제 맞히기)은 판을 나눠 해도 합쳐진다', () => {
    let day = D1;
    for (let i = 0; i < 400; i++) {
      const d = addDays(D1, i);
      if (missionsFor(d).some((m) => m.id === 'correct')) { day = d; break; }
    }
    const idx = missionsFor(day).findIndex((m) => m.id === 'correct');
    let s = emptyDaily(day);
    s = bump(s, 'correct', 7, day);
    s = bump(s, 'correct', 8, day);
    expect(s.progress[idx]).toBe(15);
  });

  it('없는 임무 id·0 이하 증가는 아무 일도 하지 않는다', () => {
    const s = emptyDaily(D1);
    expect(bump(s, '없는임무', 5, D1)).toEqual(s);
    expect(bump(s, missionsFor(D1)[0]!.id, 0, D1)).toEqual(s);
    expect(bump(s, missionsFor(D1)[0]!.id, -3, D1)).toEqual(s);
  });
});

describe('오늘의 임무 — 날이 바뀔 때', () => {
  it('날이 바뀌면 진행도와 수령 기록이 새 하루로 갈린다', () => {
    let s = emptyDaily(D1);
    s = bump(s, missionsFor(D1)[0]!.id, 999, D1);
    const rolled = rollDaily(s, D2);
    expect(rolled.date).toBe(D2);
    expect(rolled.progress).toEqual([0, 0, 0]);
    expect(rolled.claimed).toEqual([false, false, false]);
    expect(rolled.bonus).toBe(false);
  });

  it('같은 날에는 갈아 끼우지 않는다 (진행도가 날아가면 안 된다)', () => {
    const s = bump(emptyDaily(D1), missionsFor(D1)[0]!.id, 3, D1);
    expect(rollDaily(s, D1)).toBe(s);
  });

  /**
   * 🔴 어제 못 받은 보상을 오늘 받을 수 있으면, "어제 안 했으니 오늘 두 배" 같은
   *    누적 압박이 생긴다. 조용히 사라지는 것이 이 게임의 원칙이다.
   */
  it('어제 완료해 두고 안 받은 보상은 오늘로 넘어오지 않는다', () => {
    let s = emptyDaily(D1);
    missionsFor(D1).forEach((m) => { s = bump(s, m.id, m.goal, D1); });
    expect(claimable(s, D1)).toBeGreaterThan(0);
    expect(claimable(rollDaily(s, D2), D2)).toBe(0);
  });
});

describe('오늘의 임무 — 세이브 정규화', () => {
  it('새 저장에는 오늘 날짜의 빈 임무가 들어 있다', () => {
    const d = defaultSave();
    expect(d.daily.date).toBe(today());
    expect(d.daily.progress).toHaveLength(DAILY_N);
  });

  it('임무 칸이 없는 옛 저장(v5)도 그대로 열리고 기록이 보존된다', () => {
    const old = normalize({
      version: 5,
      data: { progress: { maxStage: 12, cleared: { '12': 3 } }, currency: { meokmul: 500 } },
    });
    expect(old.daily.progress).toEqual([0, 0, 0]);
    expect(old.daily.claimed).toEqual([false, false, false]);
    expect(old.progress.maxStage).toBe(12);      // 기존 기록 보존
    expect(old.currency.meokmul).toBe(500);
  });

  it('손상된 임무 칸은 안전한 모양으로 잘린다 (NaN·문자열·길이 불일치)', () => {
    const bad = normalize({
      version: 6,
      data: { daily: { date: 12345, progress: ['x', Number.NaN, 7, 9, 9], claimed: [1, true], bonus: 'yes' } },
    });
    expect(bad.daily.progress).toHaveLength(DAILY_N);
    expect(bad.daily.progress.every((n) => Number.isFinite(n) && n >= 0)).toBe(true);
    expect(bad.daily.claimed).toHaveLength(DAILY_N);
    expect(bad.daily.claimed.every((b) => typeof b === 'boolean')).toBe(true);
    expect(bad.daily.bonus).toBe(false);
    expect(bad.daily.date).toBe(today());        // 숫자 날짜는 오늘로 되돌린다
  });

  it('세이브 버전이 올라갔다 (마이그레이션이 걸리는 근거)', () => {
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(6);
  });
});
