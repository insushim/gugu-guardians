import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (f: string): string => readFileSync(new URL(`../${f}`, import.meta.url).pathname, 'utf8');

/**
 * 타격감 배선 검사.
 *
 * 🔴 캔버스에 무엇이 그려졌는지는 유닛테스트로 못 본다. 하지만 **연출을 부르는 코드가
 *    거기 있는지**는 볼 수 있고, 이 프로젝트에서 실제로 사고가 난 지점이 정확히 거기다:
 *    2026-08-02 에 성 타격 경로의 기술 이벤트를 큐에 담기만 하고 렌더러로 넘기는 한 줄이
 *    빠져 있었는데, 시뮬 테스트는 전부 초록이었다(이벤트는 큐에 있었으니까).
 *    그래서 여기서는 **호출부의 존재**를 검사하고, 실제 화면은 tools/qa-launch.mjs 가 센다.
 */
describe('타격감 배선', () => {
  const battle = read('src/ui/battle.ts');
  const field = read('src/render/field.ts');
  const audio = read('src/render/audio.ts');

  it('정답을 맞히면 전장이 반응한다 (renderer.cheer 호출)', () => {
    // 🔴 정답 처리 블록 안에 있어야 한다 — 파일 아무 데나 있으면 의미가 없다
    const i = battle.indexOf('battle.answer(true');
    const j = battle.indexOf('renderer.cheer(');
    expect(i, '정답 처리 지점을 못 찾았다').toBeGreaterThan(0);
    expect(j, 'renderer.cheer 호출이 없다 — 정답에 화면이 반응하지 않는다').toBeGreaterThan(0);
    expect(Math.abs(j - i), 'cheer 호출이 정답 처리와 떨어져 있다').toBeLessThan(400);
  });

  it('콤보가 소리에 반영된다 (playCorrect 가 콤보를 받는다)', () => {
    expect(battle).toMatch(/playCorrect\(battle\.combo\)/);
    expect(audio).toMatch(/export function playCorrect/);
  });

  it('졌을 때 전용 소리가 난다', () => {
    expect(battle).toMatch(/playLose\(\)/);
    expect(audio).toMatch(/export function playLose/);
  });

  it('수문장 등장에 연출이 있다', () => {
    expect(battle).toMatch(/renderer\.boss\(/);
    expect(battle).toMatch(/playBossAppear\(\)/);
  });

  it('처치 이펙트가 덩치를 받는다 (등급이 화면에서 읽혀야 한다)', () => {
    expect(battle).toMatch(/renderer\.puff\(e\.x, e\.side, e\.big/);
    expect(field).toMatch(/puff\(x: number, side: 1 \| -1, big = 1\)/);
  });

  it('히트스톱이 시뮬 시계를 건드리지 않는다 (그리기 전용)', () => {
    // 🔴 이 프로젝트는 '화면 배속'으로 한 번 밸런스를 깨 봤다(같은 판의 문항 수가 줄었다).
    //    히트스톱은 반드시 그리기 변환에만 있어야 한다.
    expect(field).toMatch(/hitstop\(\)/);
    expect(field, '히트스톱이 setTimeout/시뮬을 건드린다').not.toMatch(/hitstop[\s\S]{0,200}(battle\.|step\(|dt)/);
  });

  /**
   * 🔴 reduceMotion 은 **동작을 줄이라는 설정이지 정보를 지우라는 설정이 아니다**(진단 영향 4/10).
   *    환호는 얻은 먹물과 콤보를 알려 주는 정보라, 움직임만 죽이고 글자는 남겨야 한다.
   */
  it('reduceMotion 이어도 정답 환호의 정보는 남는다', () => {
    const i = field.indexOf('private drawCheers');
    const body = field.slice(i, i + 1400);
    expect(i, 'drawCheers 를 못 찾았다').toBeGreaterThan(0);
    expect(body, 'reduceMotion 에서 조기 return 하면 정보가 사라진다').not.toMatch(/reduceMotion\)\s*return/);
    expect(body, 'reduceMotion 을 고려하지 않는다').toMatch(/reduceMotion/);
  });

  it('QA 하네스가 연출 횟수를 읽을 수 있다', () => {
    expect(battle).toMatch(/cheers: renderer\.cheersShown/);
    expect(battle).toMatch(/bosses: renderer\.bossesShown/);
  });
});
