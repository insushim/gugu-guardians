/**
 * 에셋 로더 — 🔴 경로는 코드에 박지 않는다. `assets/manifest.json` 이 단일 진실원이다.
 *    (생성 스크립트·게임 로더·쇼룸·크레딧 생성기가 같은 파일을 본다.)
 */
import manifestRaw from '../../assets/manifest.json';

export interface AssetEntry {
  key: string;
  path: string;
  kind: 'unit' | 'enemy' | 'castle' | 'bg' | 'ui';
  /** ai | human | cc0 — 라이선스 대장 생성에 쓴다 */
  origin: 'ai' | 'human' | 'cc0';
  license: string;
}

export const MANIFEST = manifestRaw as { version: number; assets: AssetEntry[] };

const images = new Map<string, HTMLImageElement>();
const failed = new Set<string>();

export function getImage(key: string): HTMLImageElement | null {
  const img = images.get(key);
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

export function assetMissing(key: string): boolean {
  return failed.has(key);
}

/** 🔴 동적 `new URL('../../' + path, import.meta.url)` 은 번들러가 상위 디렉토리를 통째로
 *  에셋으로 끌어간다(실측: package-lock.json·index.html 까지 dist에 들어갔다).
 *  public/ 아래 파일은 빌드 시 그대로 복사되므로 BASE_URL 기준 상대경로로 참조한다. */
function resolve(path: string): string {
  // 단일 HTML 배포(tools/build-single.mjs)에서는 매니페스트 경로가 data URI로 치환된다
  if (path.startsWith('data:')) return path;
  const base = import.meta.env.BASE_URL || './';
  return `${base}${path}`;
}

/** 전체 에셋을 로드한다. 실패해도 게임은 진행된다(도형 폴백). */
export async function loadAll(onProgress?: (done: number, total: number) => void): Promise<void> {
  const list = MANIFEST.assets;
  let done = 0;
  await Promise.all(
    list.map(
      (a) =>
        new Promise<void>((resolveP) => {
          const img = new Image();
          img.decoding = 'async';
          img.onload = () => { images.set(a.key, img); done++; onProgress?.(done, list.length); resolveP(); };
          img.onerror = () => { failed.add(a.key); done++; onProgress?.(done, list.length); resolveP(); };
          img.src = resolve(a.path);
        }),
    ),
  );
}

export function assetUrl(key: string): string {
  const a = MANIFEST.assets.find((x) => x.key === key);
  return a ? resolve(a.path) : '';
}
