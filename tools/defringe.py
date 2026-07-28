#!/usr/bin/env python3
"""
컷아웃 스프라이트의 마젠타 후광 제거.

배경 제거(rembg) 후 생성 단계의 마젠타 백드롭이 실루엣 주변에 '보라색 후광'으로 남는다.

🔴 판별 기준은 추측이 아니라 **실측**으로 정했다:
   - 후광 픽셀      : RGB ≈ (145, 12, 144)  → **초록 채널이 0에 가깝다**
   - 캐릭터의 보라색 : RGB ≈ (139, 80, 155)  → 초록이 80 근처
   "마젠타스러움(min(R,B) − G)"만 보면 물음표벌레 같은 보라 캐릭터를 통째로 지운다(실측 사고).
   → **G가 낮을 것**을 필수 조건으로 넣어야 한다.

실행: python3 tools/defringe.py _raw/units _raw/enemies
"""
import sys
import pathlib
import numpy as np
from PIL import Image

MIN_RB = 100        # 후광은 R·B가 모두 이 이상
MAX_G = 45          # 🔴 핵심 조건: 초록이 거의 없다 (캐릭터 보라는 G≈80)
MAX_RB_DIFF = 45    # R과 B가 비슷해야 마젠타
SOFT_MAX_G = 72     # 이 구간은 알파만 줄인다(경계 그라데이션)
ALPHA_CUT = 24


def defringe(path):
    im = Image.open(path).convert("RGBA")
    a = np.array(im).astype(np.int16)
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]

    mrb = np.minimum(r, b)
    magenta_shape = (mrb > MIN_RB) & (np.abs(r - b) < MAX_RB_DIFF)

    hard = magenta_shape & (g < MAX_G) & (al > 0)
    al[hard] = 0

    soft = magenta_shape & (g >= MAX_G) & (g < SOFT_MAX_G) & (al > 0)
    if soft.any():
        t = (SOFT_MAX_G - g[soft]) / (SOFT_MAX_G - MAX_G)
        al[soft] = (al[soft] * (1 - t * 0.85)).astype(np.int16)

    al[al < ALPHA_CUT] = 0

    m = (al > 0).astype(np.uint8)
    er = m.copy()
    er[1:, :] &= m[:-1, :]
    er[:-1, :] &= m[1:, :]
    er[:, 1:] &= m[:, :-1]
    er[:, :-1] &= m[:, 1:]
    edge = (m == 1) & (er == 0)
    al[edge] = (al[edge] * 0.6).astype(np.int16)

    a[..., 3] = al
    a[al == 0, 0:3] = 0
    Image.fromarray(a.astype(np.uint8), "RGBA").save(path)
    return int(hard.sum()), int(soft.sum())


def main():
    dirs = sys.argv[1:] or ["_raw/units", "_raw/enemies"]
    n = 0
    for d in dirs:
        for p in sorted(pathlib.Path(d).glob("*.png")):
            hard, soft = defringe(p)
            n += 1
            print(f"  {p.name}: 후광 {hard}px 제거 · 경계 {soft}px 완화")
    print(f"✅ {n}개 처리")


if __name__ == "__main__":
    main()
