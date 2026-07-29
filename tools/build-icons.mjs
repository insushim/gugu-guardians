#!/usr/bin/env node
/**
 * 파비콘·앱 아이콘 생성 — _raw/crest/crest_haetae.png 한 장에서 전부 만든다.
 *
 * 🔴 작은 크기는 초상 전체를 줄이면 안 된다. 32px에서 전신·어깨까지 다 넣으면
 *    얼굴이 6~7px가 되어 무슨 그림인지 알아볼 수 없다 → 32·48px은 **얼굴만 크롭**하고,
 *    192px 이상만 초상 전체를 쓴다.
 * 🔴 apple-touch-icon 은 투명을 지원하지 않는다(검게 깔린다) → 한지색 바탕을 깐다.
 *
 * 실행: node tools/build-icons.mjs
 * 출력: public/favicon.png(32) · favicon-48.png · icon-192.png · icon-512.png · apple-touch-icon.png(180)
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PY = join(process.env.HOME, '.claude/venvs/vibes/bin/python');
const SRC = join(ROOT, '_raw/crest/crest_haetae.png');

if (!existsSync(SRC)) { console.error(`✗ 인장 원본이 없다: ${SRC}`); process.exit(1); }
if (!existsSync(PY)) { console.error('✗ PIL 환경이 없다(~/.claude/venvs/vibes)'); process.exit(1); }

const out = execFileSync(PY, ['-c', `
import sys
from PIL import Image

src, pub = sys.argv[1], sys.argv[2]
HANJI = (250, 246, 238, 255)

im = Image.open(src).convert('RGBA')
bb = im.getbbox()                      # 불투명 영역
im = im.crop(bb)
w, h = im.size

# 얼굴 크롭 — 세로 상단부, 가로 중앙. 뿔 끝까지 넣으면 얼굴이 작아지므로 이마 위만 살짝 남긴다.
side = int(w * 0.76)
cx = w // 2
cy = int(h * 0.45)
face = im.crop((max(0, cx - side // 2), max(0, cy - side // 2),
                min(w, cx + side // 2), min(h, cy + side // 2)))

def square(img):
    s = max(img.size)
    c = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    c.alpha_composite(img, ((s - img.width) // 2, (s - img.height) // 2))
    return c

full, fc = square(im), square(face)

def save(img, size, name, bg=None):
    r = img.resize((size, size), Image.LANCZOS)
    if bg:
        c = Image.new('RGBA', (size, size), bg); c.alpha_composite(r); r = c
    r.save('%s/%s' % (pub, name))
    return name

print(' · '.join([
    save(fc,    32, 'favicon.png'),
    save(fc,    48, 'favicon-48.png'),
    save(full, 192, 'icon-192.png'),
    save(full, 512, 'icon-512.png'),
    save(full, 180, 'apple-touch-icon.png', HANJI),
]))
`, SRC, join(ROOT, 'public')], { encoding: 'utf8' });

console.log(`✅ 아이콘 생성: ${out.trim()}`);
