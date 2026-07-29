#!/usr/bin/env node
/**
 * 스프라이트 내부 구멍 검사 — 배경 제거(rembg)가 캐릭터를 파먹었는지 본다.
 *
 * 🔴 이 검사가 없어서 해태 얼굴에 구멍이 뚫린 채로 배포됐다. 게임 안에서는 128px라
 *    아무도 못 알아챘고, 인장으로 키우자 드러났다. 구멍은 콘솔 에러도 테스트 실패도
 *    남기지 않는다 — 눈으로 크게 보기 전까지 조용하다.
 *
 * 판정: 테두리에서 flood fill 로 '바깥 배경'을 칠하고, 남은 투명 픽셀 = 내부 구멍.
 * ⚠️ 비율만으로 단정하지 말 것 — 격자·그물·문틀처럼 원래 뚫린 형태도 있다.
 *    얼굴 영역(위쪽 40%)에 구멍이 몰려 있으면 거의 확실히 사고다.
 *
 * 실행: node tools/hole-check.mjs [_raw/units _raw/enemies]
 */
import { readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
const PY = join(process.env.HOME, '.claude/venvs/vibes/bin/python');
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['_raw/units', '_raw/enemies'];

if (!existsSync(PY)) { console.log('! PIL 없음 — 검사 건너뜀'); process.exit(0); }

const files = dirs.flatMap((d) => {
  const abs = join(ROOT, d);
  return existsSync(abs) ? readdirSync(abs).filter((f) => f.endsWith('.png')).map((f) => join(abs, f)) : [];
});
if (!files.length) { console.log('! 검사할 원본이 없다(_raw 는 배포본에 없다)'); process.exit(0); }

const out = execFileSync(PY, ['-c', `
import sys, json
from collections import deque
from PIL import Image
res=[]
for path in sys.argv[1:]:
    im=Image.open(path).convert('RGBA'); im.thumbnail((300,600), Image.LANCZOS)
    w,h=im.size; a=im.split()[3].load(); T=40
    seen=[[False]*w for _ in range(h)]; q=deque()
    for x in range(w):
        for y in (0,h-1):
            if a[x,y]<T and not seen[y][x]: seen[y][x]=True; q.append((x,y))
    for y in range(h):
        for x in (0,w-1):
            if a[x,y]<T and not seen[y][x]: seen[y][x]=True; q.append((x,y))
    while q:
        x,y=q.popleft()
        for dx,dy in ((1,0),(-1,0),(0,1),(0,-1)):
            nx,ny=x+dx,y+dy
            if 0<=nx<w and 0<=ny<h and not seen[ny][nx] and a[nx,ny]<T:
                seen[ny][nx]=True; q.append((nx,ny))
    hole=[(x,y) for y in range(h) for x in range(w) if a[x,y]<T and not seen[y][x]]
    solid=sum(1 for y in range(h) for x in range(w) if a[x,y]>=T)
    top=sum(1 for x,y in hole if y < h*0.40)
    res.append({'f':path.split('/')[-1],'hole':len(hole),'solid':solid,
                'ratio':len(hole)/max(1,solid),'faceShare':(top/len(hole)) if hole else 0})
print(json.dumps(res))
`, ...files], { encoding: 'utf8' });

const rows = JSON.parse(out).sort((a, b) => b.ratio - a.ratio);
const bad = rows.filter((r) => r.ratio > 0.02 && r.faceShare > 0.5);
console.log('# 스프라이트 내부 구멍');
console.log(`${'파일'.padEnd(22)} ${'구멍/몸통'.padStart(9)} ${'얼굴쪽'.padStart(7)}`);
for (const r of rows.filter((x) => x.ratio > 0.005)) {
  const flag = bad.includes(r) ? '  ← 얼굴에 구멍(재생성 검토)' : '';
  console.log(`${r.f.padEnd(22)} ${(r.ratio * 100).toFixed(1).padStart(8)}% ${(r.faceShare * 100).toFixed(0).padStart(6)}%${flag}`);
}
console.log(`\n검사 ${rows.length}개 · 얼굴 구멍 의심 ${bad.length}개`);
