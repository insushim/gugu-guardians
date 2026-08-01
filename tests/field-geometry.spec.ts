import { describe, it, expect } from 'vitest';
import { castleBox, castleSize, fieldPad, screenToWorld } from '../src/render/field';
import { MAP_LEN } from '../src/sim/stages';

/**
 * 성 그림이 전투 구역을 덮지 않는지 감시한다.
 *
 * 🔴 왜 있는가 — 실사용자가 두 번 보고한 "적이 성에서 안 나온다"의 정체가 이 좌표 문제였다.
 *    성 스프라이트를 월드 끝점에 **중심 정렬**해 그리는 바람에, 성 그림의 안쪽 절반이
 *    전투가 벌어지는 구간을 통째로 덮었다. 900×480 실측:
 *      · 적 성 스프라이트 = 월드 902.7 ~ 1097.3
 *      · 적 스폰 지점     = 월드 1000  (성 그림 한가운데)
 *      · 근접 아군 정지점 = 월드 963   (역시 성 그림 안쪽)
 *    적은 태어난 자리에서 한 픽셀도 못 움직이고 0.7~1.5초 만에 죽는데(ST1 3번째 적부터),
 *    그 장면이 전부 검은 성 그림 위에 겹쳐 그려지니 아이 눈에는 아무 일도 없어 보였다.
 *
 * 🔴 이 테스트는 공식을 복붙하지 않는다 — `castleBox()`(렌더러가 실제로 쓰는 함수)를 불러
 *    월드 좌표로 되돌려 잰다. 공식을 테스트에 옮겨 적으면 무엇도 검증하지 못한다.
 */

/** 실기기에서 나오는 전장 캔버스 크기들(가로 × 세로) */
const VIEWPORTS: [number, number, string][] = [
  [900, 480, '데스크톱'],
  [1280, 560, '와이드'],
  [1024, 420, '태블릿 가로'],
  [768, 520, '태블릿 세로'],
  [390, 400, '휴대폰 세로'],
  [360, 300, '작은 휴대폰'],
  [844, 300, '휴대폰 가로'],
];

/** 근접 아군이 적 성을 때리려고 멈추는 자리(가장 긴 근접 사거리 기준) */
const MELEE_STOP_WORLD = MAP_LEN - 65;

describe('전장 좌표계 — 성은 전장 밖에 선다', () => {
  for (const [w, h, name] of VIEWPORTS) {
    it(`${name} ${w}×${h}: 적 성 그림이 전투 구역을 침범하지 않는다`, () => {
      const box = castleBox(w, h, false);
      const innerWorld = screenToWorld(box.x, w, h);
      // 성의 안쪽 모서리가 월드 끝점보다 앞(작은 값)이면 전장을 덮는 것이다
      expect(innerWorld).toBeGreaterThanOrEqual(MAP_LEN - 0.5);
      // 근접 아군이 서는 자리는 성 그림 바깥이어야 한다
      expect(innerWorld).toBeGreaterThan(MELEE_STOP_WORLD);
    });

    it(`${name} ${w}×${h}: 우리 성 그림도 전장 밖이다`, () => {
      const box = castleBox(w, h, true);
      const innerWorld = screenToWorld(box.x + box.w, w, h);
      expect(innerWorld).toBeLessThanOrEqual(0.5);
    });

    it(`${name} ${w}×${h}: 성이 화면 밖으로 잘리지 않는다`, () => {
      const foe = castleBox(w, h, false);
      const ally = castleBox(w, h, true);
      expect(ally.x).toBeGreaterThanOrEqual(-0.5);
      expect(foe.x + foe.w).toBeLessThanOrEqual(w + 0.5);
    });

    it(`${name} ${w}×${h}: 전장 폭이 화면의 절반 아래로 눌리지 않는다`, () => {
      // 성 자리를 확보하느라 정작 싸울 땅이 사라지면 안 된다
      const field = w - fieldPad(w, h) * 2;
      expect(field / w).toBeGreaterThan(0.38);
    });

    it(`${name} ${w}×${h}: 성 한 채가 가로폭의 20%를 넘지 않는다`, () => {
      expect(castleSize(w, h).w / w).toBeLessThanOrEqual(0.2);
    });
  }
});
