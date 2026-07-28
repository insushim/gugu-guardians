#!/usr/bin/env node
/**
 * 단일 HTML 빌더 — dist/ 를 파일 **하나**로 만든다.
 *
 * 왜 필요한가: 아티팩트·이메일 첨부·USB·교내 서버처럼 "파일 하나만 올릴 수 있는" 곳에
 * 그대로 올리기 위해서다. 외부 요청이 0건이 되므로 CSP가 엄격한 호스팅에서도 그림·소리가 산다.
 *
 * 방식: JS 안에 남아 있는 에셋 경로 문자열(`assets/x.webp`·`audio/sfx/x.ogg`)을
 *       data URI 로 치환한다. (assets.ts·audio.ts 가 data: 를 통과시키도록 되어 있다.)
 *
 * 실행: npm run build && node tools/build-single.mjs
 * 출력: dist-single/gugu-guardians.html   (통 HTML — 브라우저로 바로 열림)
 *       dist-single/artifact.html         (아티팩트용 조각 — doctype/html/head/body 없음)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'dist-single');
const TMP = join(ROOT, '.cache-single');

const die = (m) => { console.error(`✗ ${m}`); process.exit(1); };
const kb = (n) => `${Math.round(n / 1024)}KB`;

if (!existsSync(join(DIST, 'index.html'))) die('dist/ 가 없다. 먼저 `npm run build`.');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

// ── 1. 배경만 축소 재인코딩 (단일 파일은 base64 라 원본의 약 1.33배로 부푼다)
const PY = join(process.env.HOME, '.claude/venvs/vibes/bin/python');
const BGS = ['bg_cave', 'bg_field', 'bg_wall'];
if (existsSync(PY)) {
  execFileSync(PY, ['-c', `
import sys
from PIL import Image
for k in ${JSON.stringify(BGS)}:
    src = "${join(ROOT, 'public/assets')}/%s.webp" % k
    dst = "${TMP}/%s.webp" % k
    im = Image.open(src).convert("RGB")
    im = im.resize((1024, int(im.height * 1024 / im.width)), Image.LANCZOS)
    im.save(dst, "WEBP", quality=68, method=6)
`], { stdio: 'inherit' });
} else {
  console.warn('! PIL 없음 — 배경을 원본 크기로 인라인한다(파일이 커진다)');
}

// ── 2. data URI 만들기
const MIME = { '.webp': 'image/webp', '.ogg': 'audio/ogg', '.png': 'image/png' };
const dataUri = (abs) => {
  const mime = MIME[extname(abs)] ?? 'application/octet-stream';
  return `data:${mime};base64,${readFileSync(abs).toString('base64')}`;
};

const manifest = JSON.parse(readFileSync(join(ROOT, 'public/assets/manifest.json'), 'utf8'));
const targets = [];
for (const a of manifest.assets) {
  const key = basename(a.path, '.webp');
  const opt = join(TMP, `${key}.webp`);
  const abs = existsSync(opt) ? opt : join(ROOT, 'public', a.path);
  if (!existsSync(abs)) die(`에셋 없음: ${a.path}`);
  targets.push({ path: a.path, abs });
}
for (const n of ['correct', 'wrong', 'tap', 'summon', 'hit', 'win']) {
  const p = `audio/sfx/${n}.ogg`;
  const abs = join(ROOT, 'public', p);
  if (!existsSync(abs)) die(`소리 없음: ${p}`);
  targets.push({ path: p, abs });
}

// ── 3. 번들 읽고 치환
const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8');
const jsRel = /<script[^>]+src="\.?\/?([^"]+\.js)"/.exec(indexHtml)?.[1] ?? die('dist에서 js를 못 찾음');
const cssRel = /<link[^>]+href="\.?\/?([^"]+\.css)"/.exec(indexHtml)?.[1] ?? die('dist에서 css를 못 찾음');
const css = readFileSync(join(DIST, cssRel), 'utf8');
let js = readFileSync(join(DIST, jsRel), 'utf8');

let rawBytes = 0;
for (const t of targets) {
  if (!js.includes(t.path)) die(`번들에 "${t.path}" 문자열이 없다 — 치환 실패(로더 구조가 바뀌었는지 확인)`);
  rawBytes += statSync(t.abs).size;
  js = js.split(t.path).join(dataUri(t.abs));
}
for (const t of targets) {
  if (js.includes(`"${t.path}"`)) die(`치환 누락: ${t.path}`);
}

// ── 4. 출력
const BODY = `<div id="app" aria-live="polite"><div class="boot">불러오는 중…</div></div>
<div id="rotate-hint" hidden>
  <div>
    <div class="rot-icon" aria-hidden="true">📱↻</div>
    <p><strong>기기를 가로로 돌려 주세요</strong></p>
    <p class="sub">넓은 화면에서 더 잘 보여요</p>
  </div>
</div>`;

const fragment = `<title>구구성 수호대</title>
<meta name="description" content="계산이 빨라질수록 내 군대가 강해지는 초등 연산 라인 디펜스. 로그인 없이 바로 플레이." />
<style>
${css}
</style>
${BODY}
<script type="module">
${js}
</script>`;

const standalone = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no" />
<meta name="theme-color" content="#1B4F8C" />
${fragment.split('\n').slice(0, 2).join('\n')}
<style>
${css}
</style>
</head>
<body>
${BODY}
<script type="module">
${js}
</script>
</body>
</html>`;

const fA = join(OUT, 'gugu-guardians-play.html');
const fS = join(OUT, 'gugu-guardians.html');
writeFileSync(fA, fragment);
writeFileSync(fS, standalone);

console.log([
  '# 단일 HTML 빌드',
  `- 에셋 ${targets.length}개 인라인 (원본 ${kb(rawBytes)} → base64 ${kb(rawBytes * 4 / 3)})`,
  `- JS ${kb(Buffer.byteLength(js) - rawBytes * 4 / 3)} · CSS ${kb(Buffer.byteLength(css))}`,
  `- ${basename(fS)}  ${kb(statSync(fS).size)}   (브라우저로 바로 열기 / 아무 데나 업로드)`,
  `- ${basename(fA)}  ${kb(statSync(fA).size)}   (아티팩트용)`,
  '- 외부 요청: 0건',
].join('\n'));
