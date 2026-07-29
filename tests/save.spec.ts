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
    expect(d.progress.cleared['99']).toBe(3);         // 스테이지는 무한이라 99판도 유효하다
    expect(d.progress.cleared['x']).toBeUndefined();  // 숫자 아닌 키 제거
    expect(d.edu.theta['M2']).toBe(2400);
    expect((d.edu.theta as Record<string, number>)['NOPE']).toBeUndefined();
    expect(d.edu.stats['M2']!.correct).toBe(10);      // 정답 수는 시도 수를 넘을 수 없다
    expect(d.profile.gradeMax).toBe(6);
    // 🔴 존재하지 않는 id 는 잘라내는 게 아니라 **버린다** — 남겨 두면 출전 화면이 빈 칸을 그린다
    expect(d.deck).toEqual([]);
  });

  it('덱은 보유한 유닛만 최대 5기까지 남는다', () => {
    const roster = Object.fromEntries(
      ['jipsin', 'kkachi', 'musoe', 'onggi', 'buttong', 'bungbung'].map((id) => [id, { level: 1, shards: 0 }]),
    );
    const d = normalize({ data: {
      roster,
      deck: ['jipsin', 'kkachi', 'musoe', 'onggi', 'buttong', 'bungbung', '가짜'],
    } });
    expect(d.deck).toEqual(['jipsin', 'kkachi', 'musoe', 'onggi', 'buttong']);
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

  /**
   * 🔴 v1 → v2 는 **기존 플레이어의 기록이 걸린 경로**다.
   *    v1에는 roster 가 없고 codex.unlocked 가 사실상 보유 목록이었다.
   *    여기서 하나라도 흘리면 업데이트 후 "내 셈지기가 사라졌어요"가 된다.
   */
  describe('v1 → v2 승격', () => {
    const v1 = {
      version: 1,
      data: {
        profile: { nickname: '씩씩한 까치', gradeMax: 3, createdAt: '2026-06-01' },
        progress: { cleared: { '1': 3, '2': 2, '3': 1 }, challengeCleared: true },
        deck: ['kkachi', 'musoe', 'dokkabi'],
        codex: { unlocked: ['kkachi', 'musoe', 'bungbung', 'dokkabi'] },
        currency: { meokmul: 240, recovered: 12 },
        edu: {
          theta: { M2: 1290 }, thetaWeekly: [{ week: '2026-W24', theta: { M2: 1200 } }],
          stats: { M2: { attempts: 40, correct: 31, correctFast: 20, answerMs: 90000 } },
          playMs: 640000, diagnostics: [], rounds: 7,
          srs: { 'M2:8x7': { key: 'M2:8x7', state: '익힘', streak: 1, dueAt: '2026-08-02', lastServedAt: '2026-07-30' } },
          retentionLog: [{ key: 'M2:8x7', matured: '2026-07-01', recheck: '2026-07-22', ok: true }],
        },
        settings: { sound: false, fontScale: 1.2, reduceMotion: true },
      },
    };

    it('학습 기록·진행도·재화를 하나도 잃지 않는다', () => {
      const d = migrate(v1);
      expect(d.profile.nickname).toBe('씩씩한 까치');
      expect(d.profile.gradeMax).toBe(3);
      expect(d.progress.cleared).toEqual({ '1': 3, '2': 2, '3': 1 });
      expect(d.currency.meokmul).toBe(240);
      expect(d.currency.recovered).toBe(12);
      expect(d.edu.theta['M2']).toBe(1290);
      expect(d.edu.stats['M2']!.attempts).toBe(40);
      expect(d.edu.playMs).toBe(640000);
      expect(d.edu.rounds).toBe(7);
      expect(d.edu.srs['M2:8x7']!.state).toBe('익힘');
      expect(d.edu.retentionLog).toHaveLength(1);
      expect(d.edu.thetaWeekly).toHaveLength(1);
      // v2.2에서 음악 토글이 추가됐다 — 옛 세이브에는 없으므로 기본 켜짐으로 채워진다
      expect(d.settings).toEqual({ sound: false, music: true, fontScale: 1.2, reduceMotion: true });
    });

    it('codex.unlocked 를 보유 셈지기(roster)로 승격한다', () => {
      const d = migrate(v1);
      for (const id of ['kkachi', 'musoe', 'bungbung', 'dokkabi']) {
        expect(d.roster[id], `${id} 가 사라졌다`).toEqual({ level: 1, shards: 0 });
      }
    });

    it('maxStage 를 클리어 기록에서 복원한다', () => {
      expect(migrate(v1).progress.maxStage).toBe(3);
    });

    it('덱에서 보유하지 않은 id 는 떨어져 나간다', () => {
      const d = migrate({ data: { deck: ['kkachi', '없는유닛', 'musoe'] } });
      expect(d.deck).toEqual(['kkachi', 'musoe']);
    });

    it('roster 의 레벨은 등급 상한으로 클램프된다 (치트 방어선)', () => {
      const d = normalize({ data: { roster: {
        kkachi: { level: 999, shards: -5 },     // 노멀 = 상한 5
        yongwang: { level: 999, shards: 1e9 },  // 전설 = 상한 15
        없는유닛: { level: 3, shards: 3 },
      } } });
      expect(d.roster['kkachi']).toEqual({ level: 5, shards: 0 });
      expect(d.roster['yongwang']!.level).toBe(15);
      expect(d.roster['없는유닛']).toBeUndefined();
    });

    it('두 번 마이그레이션해도 결과가 같다 (멱등)', () => {
      const once = migrate(v1);
      const twice = migrate({ version: 2, data: JSON.parse(JSON.stringify(once)) });
      expect(twice).toEqual(once);
    });
  });

  it('닉네임은 자동 생성된다 (자유 입력은 실명 입력 위험)', () => {
    const n = randomNickname(() => 0.5);
    expect(n).toMatch(/^\S+ \S+$/);
    expect(n.length).toBeLessThanOrEqual(20);
  });
});
