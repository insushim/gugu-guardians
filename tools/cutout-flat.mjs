#!/usr/bin/env node
/**
 * 단색 배경 컷아웃 — 먹선을 못 넘는 flood fill 방식.
 *
 * 🔴 왜 rembg를 안 쓰나: rembg(u2net)는 "무엇이 주인공인가"를 추측한다. 민화풍 캐릭터는
 *    얼굴이 아이보리·흰색인 경우가 많은데, 배경도 순백이라 **얼굴을 배경으로 오인해 지운다.**
 *    실제로 해태 유닛은 얼굴·뿔의 알파가 0까지 깎여 유령이 된 채 배포됐고(반투명 69%),
 *    게임 안 128px에서는 아무도 못 알아챘다. 인장으로 키우고 나서야 드러났다.
 *
 * 이 방식은 그 사고가 **구조적으로 불가능하다**: 배경은 "이미지 테두리에서 출발해
 * 먹선을 넘지 않고 도달할 수 있는 흰 영역"으로만 정의한다. 캐릭터 안쪽은 굵은 먹선으로
 * 닫혀 있으므로, 얼굴이 순백이어도 바깥에서 도달할 수 없다 → 절대 안 지워진다.
 * 추측이 없으니 같은 입력에 항상 같은 결과가 나온다.
 *
 * 대신 전제가 있다: **배경이 단색이고, 캐릭터 외곽선이 닫혀 있어야 한다.**
 * 배경색은 네 모서리에서 읽어내므로 순백이 아니어도 된다 — 실제로 Meta가 "pure solid white
 * background" 지시를 무시하고 마젠타로 뽑은 적이 있다. 색을 가정하지 않으면 그때도 그냥 동작한다.
 * 외곽선이 끊겨 배경이 안쪽으로 새면 피사체 비율이 급감하므로 아래 경고로 잡힌다.
 *
 * 실행: node tools/cutout-flat.mjs <입력.png> [출력.png]   (출력 생략 시 제자리 덮어쓰기)
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PY = join(process.env.HOME, '.claude/venvs/vibes/bin/python');
const [src, dst] = process.argv.slice(2);

if (!src) { console.error('사용법: node tools/cutout-flat.mjs <입력.png> [출력.png]'); process.exit(1); }
if (!existsSync(src)) { console.error(`✗ 입력이 없다: ${src}`); process.exit(1); }
if (!existsSync(PY)) { console.error('✗ PIL/numpy 환경이 없다(~/.claude/venvs/vibes)'); process.exit(1); }

const out = execFileSync(PY, ['-c', `
import sys
import numpy as np
from scipy import ndimage
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]

TOL     = 20           # 배경색과 이만큼 이내면 '배경일 수 있음'. 먹선·채색은 멀어서 여기 못 든다.
SOFT_LO = 5            # 경계 반투명 구간(안티에일리어싱 보존) — 배경색으로부터의 거리
SOFT_HI = 55
SPECK   = 0.0002       # 이보다 작은 조각은 노이즈로 보고 버린다(전체 픽셀 대비)

a = np.array(Image.open(src).convert('RGB')).astype(np.float64)

# 0) 배경색은 네 모서리에서 읽는다 — 순백이라고 가정하지 않는다
corners = np.stack([a[0, 0], a[0, -1], a[-1, 0], a[-1, -1]])
bgc = np.median(corners, axis=0)
d = np.abs(a - bgc).max(axis=2)        # 배경색으로부터의 거리

# 1) 테두리에서 먹선을 넘지 않고 도달 가능한 배경색 영역 = 배경
lbl, n = ndimage.label(d <= TOL)
edge = np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))
bg = np.isin(lbl, edge[edge > 0])

# 2) 알파: 배경 0 / 내부 255 / 경계는 배경색에서 얼마나 멀어졌는지에 따라 부드럽게
alpha = np.where(bg, 0.0, 255.0)
band = (~bg) & ndimage.binary_dilation(bg, iterations=2)
alpha[band] = (np.clip((d - SOFT_LO) / (SOFT_HI - SOFT_LO), 0, 1) * 255)[band]

# 3) 파편 제거 — 본체와 떨어진 작은 조각(생성 노이즈)
sol = alpha > 200
sl, sn = ndimage.label(sol)
if sn:
    sz = ndimage.sum(np.ones_like(sl), sl, range(1, sn + 1))
    tiny = np.isin(sl, (np.nonzero(sz < a[..., 0].size * SPECK)[0] + 1))
    alpha[ndimage.binary_dilation(tiny, iterations=3) & (alpha > 0)] = 0

# 4) 배경색이 섞인 경계색을 되돌린다 — 안 하면 캐릭터 둘레에 배경색 테가 남는다
f = (alpha / 255.0)[..., None]
rgb = np.where(f > 0.02, (a - (1 - f) * bgc) / np.maximum(f, 0.02), 0)
Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha]).astype(np.uint8)).save(dst)

# 5) 자기검증 — 배경을 못 찾거나(전부 남음) 외곽선이 끊겨 배경이 새면(다 날아감) 여기서 잡힌다
subj = (alpha >= 40)
inner = ndimage.binary_fill_holes(subj)
hole = (inner & ~subj).sum() / max(1, inner.sum())
print('배경색 %s · 피사체 %.1f%% · 내부구멍 %.2f%%'
      % (tuple(int(v) for v in bgc), subj.mean() * 100, hole * 100))
if subj.mean() > 0.95: print('⚠️ 피사체 95%% 초과 — 배경이 단색이 아니라 배경 제거가 사실상 안 됐다')
if subj.mean() < 0.05: print('⚠️ 피사체 5%% 미만 — 외곽선이 끊겨 배경이 안쪽까지 샜다')
if hole > 0.03:        print('⚠️ 내부 구멍 3%% 초과 — 외곽선이 끊겨 배경이 안쪽으로 샜을 수 있다')
`, src, dst ?? src], { encoding: 'utf8' });

console.log(`${src.split('/').pop()} → ${(dst ?? src).split('/').pop()}  ${out.trim()}`);
