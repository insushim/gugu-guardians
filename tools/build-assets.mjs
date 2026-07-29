#!/usr/bin/env node
/**
 * 에셋 파이프라인: _raw/*.png → public/assets/*.webp + public/assets/manifest.json
 *
 * 🔴 원본 PNG를 public/ 에 두지 않는다 — 번들에 통째로 복사돼 dist가 수십 배 부푼다(실측).
 *    원본은 배포 대상 밖(_raw/)에 남기고 런타임용 WebP만 public/ 에 만든다.
 * 🔴 용도별 파라미터 분리: 스프라이트=알파 보존 / 배경=리사이즈 + 알파 제거.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const RAW = join(ROOT, '_raw');
const OUT = join(ROOT, 'public/assets');
const TMP = join(ROOT, '_raw/.tmp');

const SPRITE_H = 256;   // 스프라이트 기준 높이(px)
const BG_W = 1280;      // 배경 기준 폭(px)

const CREST_H = 320;    // 메뉴 인장은 스프라이트보다 크게 보이므로 해상도를 더 준다

const GROUPS = [
  { dir: 'units',   kind: 'unit',  h: SPRITE_H, alpha: true },
  { dir: 'enemies', kind: 'enemy', h: SPRITE_H, alpha: true },
  { dir: 'bg',      kind: 'bg',    w: BG_W,     alpha: false },
  // 🔴 crest 를 그룹에 넣지 않으면, 이 스크립트가 매니페스트를 통째로 다시 쓸 때
  //    crest_haetae 항목이 조용히 사라진다 → assetUrl()이 빈 문자열 → 메뉴 인장이
  //    에러 한 줄 없이 빈 원으로 뜬다(실제로 한 번 당했다). 원본을 두는 곳이 곧 진실원이다.
  { dir: 'crest',   kind: 'ui',    h: CREST_H,  alpha: true },
];
const CASTLE_KEYS = new Set(['castle_ally', 'castle_foe']);

function has(cmd) {
  try { execFileSync('which', [cmd], { stdio: 'pipe' }); return true; } catch { return false; }
}
if (!has('cwebp')) {
  console.error('cwebp 가 필요합니다:  brew install webp');
  process.exit(1);
}
const hasSips = has('sips');

mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const assets = [];
let totalIn = 0, totalOut = 0;

for (const g of GROUPS) {
  const dir = join(RAW, g.dir);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.png')); } catch { continue; }
  for (const f of files) {
    const key = basename(f, '.png');
    const src = join(dir, f);
    const tmp = join(TMP, f);
    totalIn += statSync(src).size;

    copyFileSync(src, tmp);
    if (hasSips) {
      const args = g.h ? ['--resampleHeightWidthMax', String(g.h)] : ['--resampleWidth', String(g.w)];
      try { execFileSync('sips', [...args, tmp, '--out', tmp], { stdio: 'pipe' }); } catch { /* 원본 유지 */ }
    }

    const out = join(OUT, `${key}.webp`);
    const webpArgs = g.alpha
      ? ['-q', '88', '-alpha_q', '100', '-m', '6', tmp, '-o', out]
      : ['-q', '82', '-m', '6', '-noalpha', tmp, '-o', out];
    execFileSync('cwebp', webpArgs, { stdio: 'pipe' });
    totalOut += statSync(out).size;

    const kind = CASTLE_KEYS.has(key) ? 'castle' : g.kind;
    assets.push({
      key,
      path: `assets/${key}.webp`,   // public/ 아래 파일은 빌드 시 dist 루트로 복사된다
      kind,
      origin: 'ai',
      license: 'Meta AI 생성 · 프로젝트 내 사용. 핵심 IP는 상용화 전 인간 디자이너 최종화 필요',
    });
  }
}

rmSync(TMP, { recursive: true, force: true });
assets.sort((a, b) => a.key.localeCompare(b.key));

mkdirSync(join(ROOT, 'assets'), { recursive: true });
const manifestJson = JSON.stringify({ version: 1, assets }, null, 2) + '\n';
writeFileSync(join(ROOT, 'public/assets/manifest.json'), manifestJson);
// 쇼룸(정적 페이지)이 런타임에 읽을 수 있도록 배포 경로에도 같은 파일을 둔다
writeFileSync(join(OUT, 'manifest.json'), manifestJson);

const credits = [
  '# 에셋 출처 (자동 생성 — tools/build-assets.mjs)',
  '',
  '| 키 | 종류 | 출처 | 라이선스 |',
  '|---|---|---|---|',
  ...assets.map((a) => `| ${a.key} | ${a.kind} | ${a.origin} | ${a.license} |`),
  '',
  '## 사운드',
  '- 효과음/BGM: CC0 (Kenney 등) — 추가 시 이 표에 반영',
  '',
].join('\n');
writeFileSync(join(ROOT, 'assets/CREDITS.md'), credits);

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
console.log(`✅ ${assets.length}개 변환: ${kb(totalIn)} → ${kb(totalOut)} (${((1 - totalOut / totalIn) * 100).toFixed(0)}% 감소)`);
console.log(`   manifest: assets/manifest.json · credits: assets/CREDITS.md`);
