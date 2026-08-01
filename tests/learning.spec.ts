import { describe, it, expect } from 'vitest';
import { QuizSession } from '../src/edu/session';
import { pickLevel, expectedCorrect } from '../src/edu/mastery';
import { difficultyOf, LEVEL_MID, TYPES, type QType } from '../src/edu/curriculum';
import { quizTypesFor, CAMPAIGN_STAGES } from '../src/sim/stages';
import { defaultSave } from '../src/save/schema';
import { addDays, today } from '../src/edu/date';

/**
 * **종단 학습 검증** — "게임을 계속하면 실제로 학습이 일어나는가"를 수치로 확인한다.
 *
 * 🔴 단발 테스트(문항이 유효한가·θ가 수렴하는가)로는 이 질문에 답할 수 없다.
 *    아이 한 명을 30판 내내 돌려서 **무엇을 얼마나·어떤 난이도로 풀었는지**를 봐야 한다.
 */

/** 능력이 b 인 문항을 실제로 맞힐 확률 — 로지스틱(θ_true 기준) */
function trueP(thetaTrue: number, b: number): number {
  return 1 / (1 + Math.pow(10, (b - thetaTrue) / 400));
}

interface RunOpts {
  /** 유형별 실제 능력. 없으면 baseAbility 사용 */
  ability: (type: QType, stage: number) => number;
  stages: number;
  perStage: number;
  /** 날짜를 판마다 하루씩 넘길지 (SRS 복습이 실제로 도는지 보려면 필요) */
  advanceDays: boolean;
  /** 적응형 전투 난이도 단계 — 문항 목표 정답률이 여기 묶여 있다 */
  tier?: number;
}

function run(opts: RunOpts) {
  const save = defaultSave();
  save.challenge.tier = opts.tier ?? 0;
  let day = today();
  let rngState = 12345;
  const rand = () => {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
  };
  const log: { stage: number; type: QType; level: number; b: number; correct: boolean; key: string }[] = [];

  for (let stage = 1; stage <= opts.stages; stage++) {
    const s = new QuizSession({
      layer: 'L1', types: quizTypesFor(stage), save, seed: stage * 7919, now: day,
    });
    for (let i = 0; i < opts.perStage; i++) {
      const q = s.next(0);
      const b = difficultyOf(q.type, q.level);
      const correct = rand() < trueP(opts.ability(q.type, stage), b);
      s.submit(correct ? q.answer : q.answer + 1, 2500);
      log.push({ stage, type: q.type, level: q.level, b, correct, key: q.key });
    }
    if (opts.advanceDays) day = addDays(day, 1);
  }
  return { save, log };
}

describe('종단 학습 — 30판을 실제로 돌려 본다', () => {
  it('판이 깊어질수록 새 유형이 열리고, 마지막엔 전 유형이 나온다', () => {
    const openAt: Record<string, number> = {};
    for (let n = 1; n <= CAMPAIGN_STAGES; n++) {
      for (const t of quizTypesFor(n)) if (openAt[t] === undefined) openAt[t] = n;
    }
    const table = TYPES.map((t) => `${t.id}(${t.label}) ${openAt[t.id] ?? '미개방'}판`);
    console.log('  유형 개방 시점: ' + table.join(' · '));
    // 11종이 모두 캠페인 안에서 열려야 한다 — 안 열리면 그 단원은 영영 안 나온다
    for (const t of TYPES) {
      expect(openAt[t.id], `${t.label} 이 캠페인 내내 안 열린다`).toBeDefined();
    }
    // 1판은 한 자리 덧셈·뺄셈뿐이어야 한다
    expect(quizTypesFor(1).sort()).toEqual(['A1', 'S1']);
    // 후반 판에는 한 자리 덧셈이 주력으로 남아 있으면 안 된다
    expect(quizTypesFor(30)).not.toContain('A1');
  });

  it('실력이 그대로면 난이도도 그대로, 실력이 늘면 난이도가 따라 오른다', () => {
    const flat = run({ ability: (t) => difficultyOf(t, LEVEL_MID) - 50, stages: 30, perStage: 22, advanceDays: true });
    const grow = run({ ability: (t, st) => difficultyOf(t, LEVEL_MID) - 50 + st * 12, stages: 30, perStage: 22, advanceDays: true });
    const avgB = (log: typeof flat.log, from: number, to: number) => {
      const sel = log.filter((x) => x.stage >= from && x.stage <= to);
      return sel.reduce((s, x) => s + x.b, 0) / sel.length;
    };
    const lvDist = (log: typeof flat.log) => {
      const c: Record<number, number> = {};
      for (const x of log) c[x.level] = (c[x.level] ?? 0) + 1;
      return [1, 2, 3, 4, 5].map((l) => `Lv${l}:${c[l] ?? 0}`).join(' ');
    };
    const fEarly = avgB(flat.log, 1, 5), fLate = avgB(flat.log, 26, 30);
    const gEarly = avgB(grow.log, 1, 5), gLate = avgB(grow.log, 26, 30);
    console.log(`  실력 고정 아이: 문항난이도 ${fEarly.toFixed(0)} → ${fLate.toFixed(0)}  레벨분포 ${lvDist(flat.log)}`);
    console.log(`  실력 상승 아이: 문항난이도 ${gEarly.toFixed(0)} → ${gLate.toFixed(0)}  레벨분포 ${lvDist(grow.log)}`);
    // 유형이 열리는 것만으로도 후반이 어려워진다
    expect(fLate).toBeGreaterThan(fEarly);
    // 🔴 실력이 는 아이는 더 어려운 문항을 받아야 한다.
    //    사다리를 넓히기 전에는 이게 성립하지 않아 한동안 '현상 기록'으로만 두었다
    //    (레벨이 전부 Lv1 에 눌려 있어 실력이 난이도에 반영되지 않았다).
    expect(gLate, '실력이 늘어도 문항 난이도가 그대로다 — 레벨 적응이 죽었다').toBeGreaterThan(fLate);
    // 다섯 칸 중 최소 두 칸은 실제로 쓰여야 한다. 한 칸만 쓰이면 사다리가 장식이다.
    const used = new Set(grow.log.map((x) => x.level));
    expect(used.size, `쓰인 레벨이 ${[...used].join(',')} 뿐이다 — 사다리가 작동하지 않는다`).toBeGreaterThan(1);
  });

  it('한 판에서 같은 식이 반복되지 않는다 (문항 다양성)', () => {
    const { log } = run({ ability: () => 1200, stages: 30, perStage: 22, advanceDays: true });
    const worst: string[] = [];
    for (let st = 1; st <= 30; st++) {
      const keys = log.filter((x) => x.stage === st).map((x) => x.key);
      const ratio = new Set(keys).size / keys.length;
      if (ratio < 0.5) worst.push(`${st}판 ${(ratio * 100).toFixed(0)}%`);
    }
    const overall = new Set(log.map((x) => x.key)).size;
    console.log(`  30판 총 ${log.length}문항 중 서로 다른 식 ${overall}개 · 판내 중복 심한 판: ${worst.join(', ') || '없음'}`);
    expect(worst, `같은 식이 절반 넘게 반복되는 판: ${worst.join(', ')}`).toHaveLength(0);
    expect(overall).toBeGreaterThan(150);
  });

  it('복습(SRS)이 실제로 승급하고, 틀린 것이 다시 나온다', () => {
    const { save, log } = run({ ability: () => 1250, stages: 30, perStage: 22, advanceDays: true });
    const states: Record<string, number> = {};
    for (const it of Object.values(save.edu.srs)) states[it.state] = (states[it.state] ?? 0) + 1;
    console.log(`  SRS 항목 ${Object.keys(save.edu.srs).length}개 · 상태 ${JSON.stringify(states)}`);
    // 틀린 문제가 나중에 다시 출제됐는가
    // 🔴 마지막 판들에서 틀린 것은 되돌아올 시간 자체가 없다 — 분모에 넣으면 부당하게 낮게 나온다.
    //    25판까지 틀린 것만 세고, 그 뒤 5판 동안 다시 나왔는지를 본다.
    const wrongKeys = new Set(log.filter((x) => !x.correct && x.stage <= 25).map((x) => x.key));
    let reserved = 0;
    for (const k of wrongKeys) {
      const first = log.findIndex((x) => x.key === k && !x.correct);
      if (log.slice(first + 1).some((x) => x.key === k)) reserved++;
    }
    console.log(`  25판까지 틀린 식 ${wrongKeys.size}개 중 다시 출제된 것 ${reserved}개 (${((reserved / wrongKeys.size) * 100).toFixed(0)}%)`);
    expect(reserved / wrongKeys.size).toBeGreaterThan(0.5);
    expect(states['익힘'] ?? 0).toBeGreaterThan(0);
  });

  it('전투 중 체감 정답률이 목표(85%) 근처다 — 너무 쉽지도 어렵지도 않다', () => {
    // 🔴 먼저 전부 재고 나서 판정한다 — 첫 실패에서 멈추면 "어느 실력대가 무너지는가"를 못 본다
    // 🔴 "모든 유형에 실력이 같은 아이"로 재면 불공정하다 — 실제 아이는 한 자리 덧셈은 능숙하고
    //    나눗셈은 처음이다. 유형 난이도(baseB)에 실력을 연동해 **현실적인 프로필**로 잰다.
    //    offset = 아이가 그 단원을 얼마나 앞서 있는가(+면 능숙, −면 아직).
    // 🔴 기준은 **단원 표준 난이도(baseB = 레벨 LEVEL_MID)** 다. 예전엔 `difficultyOf(t, 1)` 로
    //    잡았는데, 그러면 사다리를 손볼 때 **아이 실력도 같이 움직여** 변화가 안 보인다
    //    (실측: 사다리를 ±300으로 넓혔는데 정답률 표가 한 자리도 안 변했다 — 테스트가 자기참조였다).
    const rows: { ab: number; rate: number; early1_10: number; late21_30: number }[] = [];
    for (const ab of [-200, -100, 0, 100, 200]) {
      const { log } = run({ ability: (t) => difficultyOf(t, LEVEL_MID) + ab, stages: 30, perStage: 22, advanceDays: true });
      const segN = (from: number, to: number) => {
        const s = log.filter((x) => x.stage >= from && x.stage <= to);
        return s.filter((x) => x.correct).length / s.length;
      };
      const seg = (from: number, to: number) => (segN(from, to) * 100).toFixed(0) + '%';
      const late = log.filter((x) => x.stage > 10);
      const rate = late.filter((x) => x.correct).length / late.length;
      rows.push({ ab, rate, early1_10: segN(1, 10), late21_30: segN(21, 30) });
      const lv = log.reduce((a, x) => (a[x.level] = (a[x.level] ?? 0) + 1, a), {} as Record<number, number>);
      console.log(`  단원대비 ${ab >= 0 ? '+' : ''}${ab}점  1~10판 ${seg(1, 10)} · 11~20판 ${seg(11, 20)} · 21~30판 ${seg(21, 30)}  레벨 ${[1,2,3,4,5].map((l) => lv[l] ?? 0).join('/')}`);
    }
    /**
     * 🔴 **이 표가 사다리 교정의 증거다.** 2026-07-31 이전에는 이랬다:
     *      −200점 22% · +0점 **50%** · +200점 73%, 그리고 660문항 중 레벨 2 이상은 0~28개.
     *    설계 목표(0.85)는 물론이고 밸런스 게이트가 가정하는 최저 60%에도 못 미쳤다.
     *    원인은 산수였다 — p=0.85 를 맞추려면 문항이 아이보다 302 Elo 아래여야 하는데
     *    사다리(`baseB … baseB+240`)가 위로만 뻗어 있어 **가장 쉬운 레벨 1조차 아이보다 위**였다.
     *    `difficultyOf` 를 `baseB + (level−3)*150`(baseB±300)으로 바꿔 아이를 사다리 한가운데
     *    세웠다. 그 뒤 −200점 61% · +0점 84% · +200점 93%.
     */
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.rate, `실력이 더 좋은 아이가 더 못 맞힌다 (${rows[i - 1]!.ab} → ${rows[i]!.ab})`)
        .toBeGreaterThan(rows[i - 1]!.rate);
    }
    for (const r of rows) {
      // 판이 깊어져도 같은 아이의 정답률이 무너지지 않는다
      expect(r.late21_30, `단원대비 ${r.ab}점 아이가 후반에 붕괴한다 (${(r.early1_10 * 100).toFixed(0)}% → ${(r.late21_30 * 100).toFixed(0)}%)`)
        .toBeGreaterThan(r.early1_10 - 0.12);
      // 🔴 가장 뒤처진 아이(−200점)도 **밸런스 게이트가 가정하는 60%** 언저리는 나와야 한다.
      //    안 그러면 게임은 통과하는데 아이는 계속 틀리는, 교육 쪽만 무너진 상태가 된다.
      expect(r.rate, `단원대비 ${r.ab}점 아이가 11판 이후 ${(r.rate * 100).toFixed(0)}% — 적응이 이 실력대를 못 받쳐 준다`)
        .toBeGreaterThan(0.55);
      expect(r.rate, `단원대비 ${r.ab}점 아이가 ${(r.rate * 100).toFixed(0)}% — 너무 쉽다`).toBeLessThan(0.97);
    }
    // 그 단원을 막 배운 아이는 목표(0.85) 근처여야 한다 — 유창성 훈련이 성립하는 구간
    const atLevel = rows.find((r) => r.ab === 0)!;
    expect(atLevel.rate, `막 배운 아이가 ${(atLevel.rate * 100).toFixed(0)}% (목표 85%)`).toBeGreaterThan(0.75);
    expect(atLevel.rate, `막 배운 아이가 ${(atLevel.rate * 100).toFixed(0)}% (목표 85%)`).toBeLessThan(0.93);
  });
});

describe('DDA — 연속 오답 시 문항이 쉬워져야 한다', () => {
  /**
   * 🔴 이 게임의 DDA 는 "연속 2회 틀리면 한 단계 쉽게"가 설계다(economy.ts).
   *    부호가 뒤집히면 **막힌 아이에게 더 어려운 문제를 준다** — 학습 게임에서 가장 나쁜 실패다.
   *    화면으로는 절대 안 보인다(레벨이 프롬프트에 안 드러난다).
   */
  it('DDA 단계가 오를수록 체감 정답률이 떨어지지 않는다', () => {
    const rows: string[] = [];
    for (const type of ['A1', 'A2', 'M1', 'M2', 'AS1', 'AS2', 'D1', 'D2'] as const) {
      for (const theta of [1150, 1300, 1450, 1600]) {
        const p = [0, 1, 2, 3].map((d) => expectedCorrect(theta, difficultyOf(type, pickLevel(type, theta, 0.85, d))));
        rows.push(`${type}/θ${theta}: ${p.map((x) => x.toFixed(2)).join(' → ')}`);
        for (let d = 1; d <= 3; d++) {
          expect(
            p[d]!,
            `${type} θ=${theta} — DDA ${d}단계에서 체감 정답률이 ${p[0]!.toFixed(2)} → ${p[d]!.toFixed(2)} 로 떨어졌다 (막힌 아이에게 더 어려운 문제를 주고 있다)`,
          ).toBeGreaterThanOrEqual(p[0]! - 0.01);
        }
      }
    }
    console.log('  ' + rows.join('\n  '));
  });
});

/**
 * 난이도 단계가 오르면 **문항도 실제로 어려워지는가.**
 *
 * 🔴 사용자 보고 "너무 쉬워서 노잼"에는 전투만이 아니라 문항도 들어 있었다.
 *    실측: 30판을 돌려도 레벨 3~5 가 **한 번도** 안 나왔다(Lv1 589 / Lv2 71 / Lv3~5 0).
 *    목표 정답률 0.85 고정이 원인이다 — 그 목표를 맞추려면 문항이 아이보다 302 Elo 아래여야 해서
 *    사다리의 위쪽 절반이 구조적으로 안 쓰인다. 이제 목표는 난이도 단계에 묶여 있다.
 */
describe('난이도 단계가 오르면 문항도 어려워진다', () => {
  const ability = (t: QType) => difficultyOf(t, LEVEL_MID);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

  it('높은 단계는 같은 아이에게 더 어려운 문항을 낸다', () => {
    const lo = run({ ability, stages: 30, perStage: 22, advanceDays: true, tier: 0 });
    const hi = run({ ability, stages: 30, perStage: 22, advanceDays: true, tier: 6 });
    const bLo = mean(lo.log.map((r) => r.b));
    const bHi = mean(hi.log.map((r) => r.b));
    const lvLo = mean(lo.log.map((r) => r.level));
    const lvHi = mean(hi.log.map((r) => r.level));
    const accLo = lo.log.filter((r) => r.correct).length / lo.log.length;
    const accHi = hi.log.filter((r) => r.correct).length / hi.log.length;
    // eslint-disable-next-line no-console
    console.log(`  0단계: 문항난이도 ${bLo.toFixed(0)} · 평균레벨 ${lvLo.toFixed(2)} · 체감 정답률 ${(accLo * 100).toFixed(0)}%`);
    // eslint-disable-next-line no-console
    console.log(`  6단계: 문항난이도 ${bHi.toFixed(0)} · 평균레벨 ${lvHi.toFixed(2)} · 체감 정답률 ${(accHi * 100).toFixed(0)}%`);

    expect(bHi).toBeGreaterThan(bLo);
    expect(lvHi).toBeGreaterThan(lvLo);
    // 어려워지되, 저학년이 좌절할 만큼 떨어지면 안 된다
    // 저학년 좌절선 — 열 문제 중 셋 넘게 틀리기 시작하면 도전이 아니라 벌이다
    expect(accHi).toBeGreaterThan(0.68);
    expect(accHi).toBeLessThan(accLo);
  });

  it('사다리 위쪽(레벨 3 이상)이 실제로 쓰인다 — 그 단원을 확실히 넘어선 아이에게', () => {
    // 단원 기준보다 300점 앞선 아이 = 그 단원을 이미 소화한 아이
    const strong = run({
      ability: (t) => difficultyOf(t, LEVEL_MID) + 300,
      stages: 30, perStage: 22, advanceDays: true, tier: 6,
    });
    const high = strong.log.filter((r) => r.level >= 3).length;
    // eslint-disable-next-line no-console
    console.log(`  앞선 아이·6단계: 레벨3+ 문항 ${high}개 / ${strong.log.length}개 (${Math.round((high / strong.log.length) * 100)}%)`);
    expect(high).toBeGreaterThan(0);
  });
});
