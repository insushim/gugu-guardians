import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST, assetUrl } from '../src/render/assets';

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

  it('없는 키는 빈 문자열을 돌려준다 (호출부가 감지할 수 있게)', () => {
    expect(assetUrl('없는에셋')).toBe('');
  });

  it('kind 값이 정의된 다섯 가지 안에 있다', () => {
    const ok = new Set(['unit', 'enemy', 'castle', 'bg', 'ui']);
    for (const a of MANIFEST.assets) expect(ok.has(a.kind), `${a.key}: ${a.kind}`).toBe(true);
  });
});
