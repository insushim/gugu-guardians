import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST, assetUrl } from '../src/render/assets';
import { ALLIES, ENEMIES } from '../src/sim/units';
import { stageBackground } from '../src/sim/stages';

/**
 * 에셋 매니페스트 정합성.
 *
 * 🔴 왜 있나: 예전에는 매니페스트가 **두 벌**이었다.
 *    루트 `assets/manifest.json`(앱이 import)과 `public/assets/manifest.json`(빌더·쇼룸이 읽음).
 *    한쪽에만 에셋을 추가하면 이미지가 **조용히** 로드되지 않는다 — 에러도 안 나고
 *    `assetUrl()` 이 빈 문자열을 돌려줘 `<img src="">` 가 페이지 자신을 가리킨다.
 *    실제로 메뉴 인장이 빈 원으로 떴고, 스크린샷을 안 봤으면 못 잡았다.
 */

const ROOT = new URL('..', import.meta.url).pathname;

describe('에셋 매니페스트', () => {
  it('앱이 읽는 매니페스트가 public 의 그 파일과 같다 (진실원 1개)', () => {
    const onDisk = JSON.parse(readFileSync(join(ROOT, 'public/assets/manifest.json'), 'utf8')) as typeof MANIFEST;
    expect(MANIFEST.assets.map((a) => a.key).sort()).toEqual(onDisk.assets.map((a) => a.key).sort());
  });

  it('매니페스트에 적힌 파일이 전부 실제로 있다', () => {
    const missing = MANIFEST.assets.filter((a) => !existsSync(join(ROOT, 'public', a.path)));
    expect(missing.map((a) => a.path)).toEqual([]);
  });

  it('키가 중복되지 않는다', () => {
    const keys = MANIFEST.assets.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  /** 🔴 코드가 이름으로 부르는 에셋은 매니페스트에 반드시 있어야 한다 */
  it('코드에서 직접 부르는 에셋 키가 매니페스트에 있다', () => {
    for (const key of ['crest_haetae', 'castle_ally', 'castle_foe']) {
      expect(assetUrl(key), `${key} 가 매니페스트에 없다`).not.toBe('');
    }
  });

  /**
   * 🔴 **로스터에 유닛을 추가하고 그림을 빠뜨리는 것**을 막는다.
   *    v3 에서 셈지기 14종·엉킴괴수 9종을 한 번에 늘렸는데, 이 검사가 없으면
   *    덱 카드의 `<img src="">` 가 페이지 자신을 가리키고(빈 칸) 전장에서는 도형으로
   *    떨어질 뿐 **에러도 테스트 실패도 없다** — 실제로 배포될 때까지 아무도 모른다.
   *    로스터가 진실원이므로 로스터를 기준으로 대조한다.
   */
  it('로스터의 모든 셈지기·엉킴괴수에 그림이 있다', () => {
    const missing = [
      ...ALLIES.map((u) => [u.id, u.name] as const),
      ...ENEMIES.map((e) => [e.id, e.name] as const),
    ].filter(([id]) => assetUrl(id) === '');
    expect(missing.map(([id, name]) => `${id}(${name})`)).toEqual([]);
  });

  it('배경 키가 전부 매니페스트에 있다', () => {
    const keys = new Set(MANIFEST.assets.map((a) => a.key));
    // 스테이지는 무한이지만 배경은 구역 수만큼 순환한다 — 한 바퀴 돌면 전부 나온다
    for (let i = 1; i <= 60; i++) {
      const bg = stageBackground(i);
      expect(keys.has(bg), `${bg} (ST${i}) 가 매니페스트에 없다`).toBe(true);
    }
  });

  it('없는 키는 빈 문자열을 돌려준다 (호출부가 감지할 수 있게)', () => {
    expect(assetUrl('없는에셋')).toBe('');
  });

  it('kind 값이 정의된 다섯 가지 안에 있다', () => {
    const ok = new Set(['unit', 'enemy', 'castle', 'bg', 'ui']);
    for (const a of MANIFEST.assets) expect(ok.has(a.kind), `${a.key}: ${a.kind}`).toBe(true);
  });
});
