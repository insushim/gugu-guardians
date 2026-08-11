import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { matchInk, INK_PER_CORRECT, MATCH_INK_CAP } from '../src/sim/economy';
import { CAMPAIGN_STAGES } from '../src/sim/stages';
// @ts-expect-error — 프로브 모델은 순수 JS다(Node 로 그대로 돌려야 해서 TS로 두지 않는다)
import * as probe from '../tools/probe-model.mjs';

/**
 * 판 보상 — **막힌 아이의 수입 경로.**
 *
 * 🔴 2026-08-11 전수 조사에서 드러난 구조적 결함의 회귀 방지다. 그때 먹물이 늘어나는 곳이
 *    `src/ui/screens.ts` 의 관문 한 곳뿐이었고 지급 조건이 "별이 나아진 만큼"이라,
 *    **지면 0 · 이미 3별인 판 재도전도 0** 이었다. 전력을 올리려면 먹물이 필요한데
 *    먹물을 벌려면 이겨야 하는 순환이라, 사용자가 요구한 재도전 루프가 성립할 수 없었다.
 */
describe('판 보상 (matchInk)', () => {
  it('맞힌 문제가 있으면 반드시 0보다 크다 — 이게 수입 경로의 전부다', () => {
    for (const stage of [1, 10, 20, 30, 45]) {
      expect(matchInk(1, stage), `ST${stage}`).toBeGreaterThan(0);
    }
  });

  it('한 문제도 못 맞히면 0이다 (찍기로 버는 길을 만들지 않는다)', () => {
    expect(matchInk(0, 20)).toBe(0);
    expect(matchInk(-5, 20)).toBe(0);
  });

  it('많이 맞힐수록 많이 받는다 (단조 증가)', () => {
    let prev = -1;
    for (let c = 0; c <= 25; c++) {
      const v = matchInk(c, 15);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('뒤 판일수록 같은 정답 수에 더 준다', () => {
    expect(matchInk(10, 20)).toBeGreaterThan(matchInk(10, 1));
  });

  it('상한이 걸린다 — 한 판을 무한정 늘려 버는 길을 막는다', () => {
    expect(matchInk(100000, CAMPAIGN_STAGES)).toBe(MATCH_INK_CAP);
  });

  it('무한 구간에서도 배율이 발산하지 않는다 (캠페인 끝에서 멈춘다)', () => {
    expect(matchInk(12, CAMPAIGN_STAGES + 50)).toBe(matchInk(12, CAMPAIGN_STAGES));
  });

  /**
   * 🔴 **이 테스트가 실제 결함을 잡는다.** 위 계산이 다 맞아도 `main.ts` 가 패배 경로에서
   *    지급을 안 하면 아무 소용이 없다 — 그리고 그게 정확히 예전 상태였다.
   *    계산이 아니라 **배선**을 검사한다.
   */
  it('패배 경로에서도 먹물을 지급한다 (main.ts 배선)', () => {
    const src = readFileSync(new URL('../src/main.ts', import.meta.url).pathname, 'utf8');
    // 지급이 승/패 분기보다 **먼저** 일어나야 둘 다 받는다
    const pay = src.indexOf('meokmul += ink');
    const branch = src.indexOf("r.status === 'win'");
    expect(pay, 'main.ts 에 판 보상 지급이 없다').toBeGreaterThan(0);
    expect(branch, "승패 분기를 찾지 못했다").toBeGreaterThan(0);
    expect(pay, '판 보상이 승패 분기 뒤에 있다 — 진 판이 다시 0이 된다').toBeLessThan(branch);
  });

  it('프로브 미러가 같은 값을 낸다 (게이트가 다른 경제로 돌면 무의미하다)', () => {
    for (const [c, st] of [[1, 1], [7, 12], [23, 30], [40, 55], [10000, 20]] as const) {
      expect(probe.matchInk(c, st), `correct=${c} stage=${st}`).toBe(matchInk(c, st));
    }
    expect(probe.INK_PER_CORRECT).toBe(INK_PER_CORRECT);
  });
});
