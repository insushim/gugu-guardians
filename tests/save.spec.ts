import { describe, it, expect } from 'vitest';
import { normalize, migrate, defaultSave, randomNickname, SAVE_VERSION } from '../src/save/schema';

/**
 * DoD 18·19 — 저장/복구.
 * 🔴 손상 세이브 방어를 try/catch에 기대지 말 것: `Object.values(123)`은 예외 없이 빈 배열을
 *    돌려주므로 catch에 안 걸리고, 잘못된 타입이 그대로 상태에 남아 나중에 터진다.
 *    경계에서 필드별 타입 검사 → 모르는 키 제거 → 기본값 복구(화이트리스트 정규화)가 정석.
 */
describe('세이브 정규화', () => {
  it('왕복(저장→로드)이 값을 보존한다', () => {
    const d = defaultSave();
    d.progress.cleared['3'] = 2;
    d.currency.meokmul = 120;
    d.edu.theta['M2'] = 1310;
    d.edu.srs['M2:8x7'] = { key: 'M2:8x7', state: '익힘', streak: 1, dueAt: '2026-08-02', lastServedAt: '2026-07-30' };
    const back = normalize({ version: SAVE_VERSION, data: JSON.parse(JSON.stringify(d)) });
    expect(back.progress.cleared['3']).toBe(2);
    expect(back.currency.meokmul).toBe(120);
    expect(back.edu.theta['M2']).toBe(1310);
    expect(back.edu.srs['M2:8x7']!.streak).toBe(1);
    expect(back.edu.srs['M2:8x7']!.state).toBe('익힘');
  });

  it('완전히 잘못된 입력에서도 크래시 없이 기본값으로 복구된다', () => {
    const junk: unknown[] = [
      null, undefined, 0, 123, '', 'hello', [], [1, 2, 3], true,
      { data: 123 }, { data: 'x' }, { data: [] }, { data: { edu: 5 } },
      { data: { profile: 'nope', progress: [], edu: { srs: 'x', stats: 7, theta: null } } },
    ];
    for (const j of junk) {
      const d = normalize(j);
      expect(d.profile.nickname.length).toBeGreaterThan(0);
      expect(d.currency.meokmul).toBe(0);
      expect(Object.keys(d.edu.srs)).toHaveLength(0);
      expect(d.codex.unlocked).toContain('kkachi');
      expect(d.settings.sound).toBe(true);
    }
  });

  it('조작된 수치를 범위로 클램프한다 (치트 방어선)', () => {
    const d = normalize({ data: {
      currency: { meokmul: -999, recovered: 1e12 },
      progress: { cleared: { '3': 99, '99': 3, 'x': 2 } },
      edu: { theta: { M2: 99999, NOPE: 1200 }, stats: { M2: { attempts: 10, correct: 999, correctFast: 999 } } },
      profile: { gradeMax: 42 },
      deck: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    } });
    expect(d.currency.meokmul).toBe(0);
    expect(d.currency.recovered).toBe(999999);
    expect(d.progress.cleared['3']).toBe(3);          // 별은 최대 3
    expect(d.progress.cleared['99']).toBeUndefined(); // 없는 스테이지 제거
    expect(d.progress.cleared['x']).toBeUndefined();  // 숫자 아닌 키 제거
    expect(d.edu.theta['M2']).toBe(2400);
    expect((d.edu.theta as Record<string, number>)['NOPE']).toBeUndefined();
    expect(d.edu.stats['M2']!.correct).toBe(10);      // 정답 수는 시도 수를 넘을 수 없다
    expect(d.profile.gradeMax).toBe(6);
    expect(d.deck).toHaveLength(5);
  });

  it('SRS 상태가 정의된 4종 밖이면 학습중으로 되돌린다', () => {
    const d = normalize({ data: { edu: { srs: {
      'M2:8x7': { state: '해킹됨', streak: 99, dueAt: 12345 },
      'A1:1+1': { state: '완성', streak: 1, dueAt: '2026-09-01', lastServedAt: '2026-08-01' },
    } } } });
    expect(d.edu.srs['M2:8x7']!.state).toBe('학습중');
    expect(d.edu.srs['M2:8x7']!.streak).toBe(5);       // 상한 클램프
    expect(typeof d.edu.srs['M2:8x7']!.dueAt).toBe('string');
    expect(d.edu.srs['A1:1+1']!.state).toBe('완성');
  });

  it('버전 필드가 없는 옛 저장본도 마이그레이션된다', () => {
    const d = migrate({ data: { currency: { meokmul: 50 } } });
    expect(d.currency.meokmul).toBe(50);
    expect(d.edu.rounds).toBe(0);
  });

  it('닉네임은 자동 생성된다 (자유 입력은 실명 입력 위험)', () => {
    const n = randomNickname(() => 0.5);
    expect(n).toMatch(/^\S+ \S+$/);
    expect(n.length).toBeLessThanOrEqual(20);
  });
});
