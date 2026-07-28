import { describe, it, expect } from 'vitest';
import { ALL_TYPE_IDS, TYPES, exceedsGrade, difficultyOf, type QType } from '../src/edu/curriculum';
import { generate, generateFresh, fromKey, makeRng, MAX_LEVEL } from '../src/edu/generator';
import { buildChoices, answerRank } from '../src/edu/distractor';
import { updateTheta, expectedCorrect, pickLevel } from '../src/edu/mastery';
import { newItem, review, dueQueue, isDue } from '../src/edu/srs';
import { addDays, toDayStr, daysBetween, weekKey } from '../src/edu/date';
import { scanTerms, scanTypes } from '../src/edu/vocabulary-gate';
import { recordAnswer, emptyStat, automaticity, questionDensity } from '../src/edu/stats';

// ── DoD 17: 학년 용어·유형 게이트 ────────────────────────────────────────
describe('학년 적합성 게이트', () => {
  it('혼합 계산 같은 5~6학년 유형은 아예 존재하지 않는다 (MVP 범위)', () => {
    expect(ALL_TYPE_IDS).not.toContain('MX1' as QType);
    for (const t of TYPES) expect(t.gradeMin).toBeLessThanOrEqual(4);
  });

  it('프로필 학년 상한을 넘는 유형을 걸러낸다', () => {
    expect(exceedsGrade('D2', 2)).toBe(true);   // 3학년 시작 유형을 2학년에게
    expect(exceedsGrade('A1', 2)).toBe(false);
    expect(scanTypes(['D2', 'A1'], 2).map((v) => v.where)).toEqual(['type:D2']);
  });

  it('2학년 화면에 교육과정 초과 용어가 있으면 잡아낸다', () => {
    const bad = scanTerms({ 'ui.title': '배수를 찾아라', 'ui.ok': '좋아요' }, 2);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.term).toBe('배수');
  });

  it('영문 약자(HP 등)를 금지한다', () => {
    const bad = scanTerms({ 'hud.hp': 'HP 100' }, 4);
    expect(bad.some((v) => v.term === 'HP')).toBe(true);
  });
});

// ── 문항 생성기 ───────────────────────────────────────────────────────────
describe('문항 생성기', () => {
  it('모든 유형×레벨이 유효한 문항을 만든다 (자릿수·정답 정합)', () => {
    const rng = makeRng(7);
    for (const t of ALL_TYPE_IDS) {
      for (let lv = 1; lv <= MAX_LEVEL; lv++) {
        for (let i = 0; i < 40; i++) {
          const q = generate(t, lv, rng);
          expect(Number.isInteger(q.answer)).toBe(true);
          expect(q.answer).toBeGreaterThanOrEqual(0);
          expect(q.digits).toBe(String(q.answer).length);
          expect(q.prompt.length).toBeGreaterThan(0);
          expect(q.difficulty).toBe(difficultyOf(t, lv));
        }
      }
    }
  });

  it('A2는 반드시 받아올림이 있고, S2는 반드시 받아내림이 있다', () => {
    const rng = makeRng(11);
    for (let i = 0; i < 200; i++) {
      const a2 = generate('A2', 3, rng);
      const m = /^(\d+) \+ (\d+)$/.exec(a2.prompt)!;
      expect(Number(m[1]) + Number(m[2])).toBeGreaterThanOrEqual(10);

      const s2 = generate('S2', 3, rng);
      const n = /^(\d+) − (\d+)$/.exec(s2.prompt)!;
      expect(Number(n[1]) % 10).toBeLessThan(Number(n[2]));
    }
  });

  it('최근 출제 큐에 있는 문항을 피한다', () => {
    const rng = makeRng(3);
    const first = generate('M2', 1, rng);
    const rng2 = makeRng(3);
    const fresh = generateFresh('M2', 1, rng2, [first.key]);
    expect(fresh.key).not.toBe(first.key);
  });

  it('SRS 키로 같은 문항을 복원한다 (복습은 같은 문제여야 한다)', () => {
    const rng = makeRng(5);
    for (const t of ALL_TYPE_IDS) {
      for (let i = 0; i < 20; i++) {
        const q = generate(t, 2, rng);
        const back = fromKey(q.key, 2);
        expect(back, `restore ${q.key}`).not.toBeNull();
        expect(back!.answer).toBe(q.answer);
        expect(back!.prompt).toBe(q.prompt);
      }
    }
  });
});

// ── DoD 16: 오답 후보 분포 ────────────────────────────────────────────────
describe('4지선다 오답 후보', () => {
  const N = 2000;
  it('정답의 크기 순위가 균등하다 (카이제곱)', () => {
    const rng = makeRng(20260728);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      const q = generate('M2', 3, rng);
      const c = buildChoices(q, rng);
      counts[answerRank(c, q.answer) - 1]!++;
    }
    const exp = N / 4;
    const chi = counts.reduce((s, o) => s + (o - exp) ** 2 / exp, 0);
    expect(counts.every((c) => c > 0)).toBe(true);
    expect(chi, `counts=${counts}`).toBeLessThan(16.27); // df=3, p=0.001
  });

  it('정답의 화면 위치가 균등하다', () => {
    const rng = makeRng(999);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      const q = generate('A2', 2, rng);
      counts[buildChoices(q, rng).answerIndex]!++;
    }
    const exp = N / 4;
    const chi = counts.reduce((s, o) => s + (o - exp) ** 2 / exp, 0);
    expect(chi, `counts=${counts}`).toBeLessThan(16.27);
  });

  it('보기에 중복이 없고 정답이 정확히 하나 있다', () => {
    const rng = makeRng(42);
    for (const t of ALL_TYPE_IDS) {
      for (let i = 0; i < 100; i++) {
        const q = generate(t, 3, rng);
        const c = buildChoices(q, rng);
        expect(c.options).toHaveLength(4);
        expect(new Set(c.options).size).toBe(4);
        expect(c.options.filter((v) => v === q.answer)).toHaveLength(1);
        expect(c.options[c.answerIndex]).toBe(q.answer);
        expect(c.options.every((v) => v >= 0)).toBe(true);
      }
    }
  });
});

// ── 숙련도(Elo) ───────────────────────────────────────────────────────────
describe('숙련도 추정', () => {
  it('prequential — 예측은 갱신 전 θ로 계산된다', () => {
    const r = updateTheta({ theta: 1200, b: 1200, attempts: 0, correct: true, clean: true });
    expect(r.predicted).toBeCloseTo(0.5, 6);
    expect(r.theta).toBeGreaterThan(1200);
  });

  it('힌트로 오염된 응답은 θ를 갱신하지 않는다', () => {
    const r = updateTheta({ theta: 1200, b: 1200, attempts: 5, correct: true, clean: false });
    expect(r.updated).toBe(false);
    expect(r.theta).toBe(1200);
  });

  it('실제 정답률 85%인 학습자의 θ가 그 근처로 수렴한다', () => {
    let theta = 1000;
    const b = 1200;
    const rng = makeRng(2024);
    for (let i = 0; i < 400; i++) {
      const correct = rng() < 0.85;
      theta = updateTheta({ theta, b, attempts: i, correct, clean: true }).theta;
    }
    // P=0.85 평형점: b + 400*log10(0.85/0.15) ≈ 1200 + 301
    expect(expectedCorrect(theta, b)).toBeGreaterThan(0.7);
    expect(expectedCorrect(theta, b)).toBeLessThan(0.95);
  });

  it('L1은 쉬운 레벨, L2는 어려운 레벨을 고른다', () => {
    const theta = 1300;
    expect(pickLevel('M2', theta, 0.85)).toBeLessThanOrEqual(pickLevel('M2', theta, 0.6));
  });
});

// ── DoD 15: SRS ───────────────────────────────────────────────────────────
describe('SRS 간격 반복', () => {
  it('연속 2회 정답으로 학습중→익힘→다짐→완성 승급한다', () => {
    let it0 = newItem('M2:8x7', '2026-07-01');
    expect(it0.state).toBe('학습중');
    it0 = review(it0, true, '2026-07-01');
    expect(it0.state).toBe('학습중');           // 1회로는 승급하지 않는다
    expect(it0.streak).toBe(1);
    it0 = review(it0, true, '2026-07-02');
    expect(it0.state).toBe('익힘');
    it0 = review(it0, true, '2026-07-05');
    it0 = review(it0, true, '2026-07-06');
    expect(it0.state).toBe('다짐');
    it0 = review(it0, true, '2026-07-13');
    it0 = review(it0, true, '2026-07-14');
    expect(it0.state).toBe('완성');
    expect(daysBetween('2026-07-14', it0.dueAt)).toBe(21);
  });

  it('streak이 저장되어야 앱을 껐다 켜도 진행이 유지된다', () => {
    const once = review(newItem('A1:3+4'), true, '2026-07-01');
    const restored = { ...once };               // 저장→로드 흉내
    const after = review(restored, true, '2026-07-02');
    expect(after.state).toBe('익힘');
  });

  it('오답이면 학습중으로 강등되고 streak이 0이 된다', () => {
    let it0 = newItem('M2:8x7', '2026-07-01');
    it0 = review(it0, true, '2026-07-01');
    it0 = review(it0, true, '2026-07-02');   // 익힘
    it0 = review(it0, false, '2026-07-05');
    expect(it0.state).toBe('학습중');
    expect(it0.streak).toBe(0);
  });

  it('기한이 안 된 항목은 출제하지 않는다', () => {
    const it0 = review(newItem('A1:1+1'), true, '2026-07-01');
    expect(isDue(it0, '2026-07-01')).toBe(false);
    expect(isDue(it0, '2026-07-02')).toBe(true);
  });

  it('오래 안 나온 항목이 영구 미출제되지 않는다 (tail starvation)', () => {
    const items = [
      { ...newItem('A1:old'), dueAt: '2026-06-01', lastServedAt: '2026-06-01' },
      { ...newItem('A1:new1'), dueAt: '2026-07-01', lastServedAt: '2026-07-01' },
      { ...newItem('A1:new2'), dueAt: '2026-07-01', lastServedAt: '2026-07-01' },
    ];
    const q = dueQueue(items, 1, '2026-07-02');
    expect(q[0]!.key).toBe('A1:old');
  });
});

// ── 날짜 (KST 하루 밀림 회귀) ─────────────────────────────────────────────
describe('날짜 유틸', () => {
  it('addDays(x, 0) === x — UTC 변환으로 하루 밀리지 않는다', () => {
    for (const d of ['2026-01-01', '2026-07-28', '2026-12-31', '2026-03-01']) {
      expect(addDays(d, 0)).toBe(d);
    }
  });

  it('로컬 자정 Date가 같은 날짜 문자열로 돌아온다', () => {
    const d = new Date(2026, 6, 28); // 로컬 2026-07-28 00:00
    expect(toDayStr(d)).toBe('2026-07-28');
    // toISOString().slice(0,10)은 KST에서 전날이 된다 — 그래서 쓰지 않는다
  });

  it('월/연 경계를 넘는다', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-02-26', '2026-03-01')).toBe(3);
  });

  it('주 키가 생성된다', () => {
    expect(weekKey('2026-07-28')).toMatch(/^2026-W\d{2}$/);
  });
});

// ── 학습 통계 ─────────────────────────────────────────────────────────────
describe('학습 성과 지표', () => {
  it('자동화율은 정답이면서 3초 이내인 비율이다', () => {
    let s = emptyStat();
    s = recordAnswer(s, true, 1500);
    s = recordAnswer(s, true, 5000);
    s = recordAnswer(s, false, 1000);
    s = recordAnswer(s, true, 2000);
    expect(s.attempts).toBe(4);
    expect(s.correct).toBe(3);
    expect(automaticity(s)).toBeCloseTo(0.5, 6);
  });

  it('문항 밀도는 0~1로 제한된다', () => {
    expect(questionDensity(60000, 150000)).toBeCloseTo(0.4, 6);
    expect(questionDensity(999, 0)).toBe(0);
    expect(questionDensity(200000, 100000)).toBe(1);
  });
});
