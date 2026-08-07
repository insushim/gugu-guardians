#!/usr/bin/env python3
"""
킹수학 등재 썸네일 생성 — 400×267 WebP RGB(알파 없음).

🔴 AI 생성이 아니라 **결정론 합성**이다. 이유 두 가지:
   ① 이 크기에서 AI가 그린 한글 제목은 반드시 뭉개지거나 틀린 글자가 나온다
   ② 게임에 실제로 들어 있는 스프라이트를 써야 "썸네일과 다른 게임" 사고가 안 난다

🔴 이 그림이 놓이는 자리를 잊지 말 것: 목록 40개 중 하나, 화면에서 200px 안팎,
   교사가 3m 밖 전자칠판에서 고른다. 그래서 **제목 글자 높이 > 캐릭터 디테일**이다.
   작은 글씨·복잡한 HUD 스크린샷은 그 크기에서 전부 사라진다(kingsmath-track §4).

실행: ~/.claude/venvs/vibes/bin/python tools/build-thumb.py
출력: dist-kingsmath/thumb.webp (+ 검수용 thumb.png, 목록 크기 미리보기 thumb-preview.png)
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'public/assets')
OUT = os.path.join(ROOT, 'dist-kingsmath')

W, H = 400, 267                      # 관찰된 등재 썸네일 규격
MAX_BYTES = 60 * 1024

# 단청 팔레트 — src/style.css 의 토큰과 같은 값이어야 한다(게임과 썸네일이 따로 놀면 안 된다)
HANJI = (250, 246, 238)
MEOK = (34, 29, 26)
JU = (212, 52, 47)
GOLD = (200, 160, 44)
CHEONG = (27, 79, 140)

GOTHIC = '/System/Library/Fonts/AppleSDGothicNeo.ttc'
HEAVY, BOLD, MEDIUM = 16, 6, 2       # TTC 인덱스


def font(size, idx=HEAVY):
    return ImageFont.truetype(GOTHIC, size, index=idx)


def sprite(name, height):
    """투명 여백을 잘라내고 높이 기준으로 맞춘다 — 원본마다 여백이 달라 그냥 쓰면 크기가 제각각이다."""
    p = os.path.join(ASSETS, f'{name}.webp')
    if not os.path.exists(p):
        sys.exit(f'✗ 스프라이트 없음: {p}')
    im = Image.open(p).convert('RGBA')
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)
    w = max(1, round(im.width * height / im.height))
    return im.resize((w, height), Image.LANCZOS)


def shadow(im, blur=(3, 3), alpha=70):
    """먹선 그림자 — 한지 바탕에서 캐릭터가 떠 보이게 한다(민화 화집의 여백 처리)."""
    from PIL import ImageFilter
    a = im.split()[3].point(lambda v: min(255, v * 2))
    s = Image.new('RGBA', im.size, MEOK + (0,))
    s.putalpha(a.point(lambda v: v * alpha // 255))
    return s.filter(ImageFilter.GaussianBlur(blur[0]))


PANEL = 194        # 좌측 먹 패널 폭 — 제목 3글자가 56px로 들어가는 최소치에서 결정


def build():
    """좌우 분할. 글자와 그림이 절대 겹치지 않게 세로로 자른다.

    🔴 v1에서 제목·부제 위에 캐릭터를 겹쳐 놨다가 200px로 줄이니 부제가 통째로 사라졌다.
       작은 그림에서 겹침은 '조금 읽기 어려움'이 아니라 '없음'이 된다.
    """
    img = Image.new('RGB', (W, H), HANJI)
    d = ImageDraw.Draw(img)

    # ── 오른쪽 한지 결: 게임 CSS 의 --hanji-tex 와 같은 원리. 이미지 없이 질감만.
    for x in range(PANEL, W, 3):
        d.line([(x, 0), (x, H)], fill=(243, 237, 226), width=1)
    for y in range(0, H, 4):
        d.line([(PANEL, y), (W, y)], fill=(246, 241, 231), width=1)

    # ── 땅: 캐릭터가 허공에 뜨지 않게 바닥을 만든다. 민화의 청록 언덕색.
    d.rectangle([PANEL, H - 46, W, H], fill=(214, 224, 205))
    d.line([(PANEL, H - 46), (W, H - 46)], fill=(163, 180, 152), width=2)

    # ── 주인공: 셈여우. 가장 밝고 가장 알아보기 쉬운 아군이라 목록에서 눈이 먼저 간다.
    #    아래를 비워 두려고 위로 올린다 — 적이 들어갈 자리다.
    fox = sprite('gumiho', 166)
    fx, fy = W - fox.width - 2, 34
    img.paste(shadow(fox), (fx + 4, fy + 6), shadow(fox))
    img.paste(fox, (fx, fy), fox)

    # ── 적: 셈먹는용. 입에서 숫자가 나오는 그림이라 이 한 마리가 '수학'을 말한다.
    #    🔴 여우 **뒤**에 두면 꼬리에 완전히 먹힌다(v2 실측: 화면에 흔적도 없었다).
    #    🔴 가슴께에 겹쳐 놓으면 '여우가 뭔가 안고 있는 그림'이 된다(v3 실측).
    #       바닥선에 앉히고 앞으로 빼서, 아래는 적 / 위는 아군으로 층을 나눈다.
    boss = sprite('e_boss4', 72)
    bx, by = PANEL - 6, H - 72 - 4
    img.paste(shadow(boss), (bx + 3, by + 4), shadow(boss))
    img.paste(boss, (bx, by), boss)

    # ── 곱셈식 딱지: 200px로 줄여도 살아남는 유일한 '수학' 신호.
    #    캐릭터는 그 크기에서 그냥 '귀여운 그림'이 되고 장르가 안 읽힌다.
    ex, ey, ew, eh = PANEL + 6, 10, 96, 42
    d.rounded_rectangle([ex + 3, ey + 4, ex + ew + 3, ey + eh + 4], radius=10, fill=MEOK)
    d.rounded_rectangle([ex, ey, ex + ew, ey + eh], radius=10, fill=JU, outline=MEOK, width=3)
    d.text((ex + ew // 2, ey + eh // 2), '7 × 8', font=font(26), fill=HANJI, anchor='mm')

    # ── 좌측 먹 패널: 제목 자리. 어두운 바탕이라 목록 어디에 놓여도 글자가 살아남는다
    d.rectangle([0, 0, PANEL, H], fill=MEOK)
    d.rectangle([8, 8, PANEL - 10, H - 9], outline=GOLD, width=2)   # 금박 실선 = 단청 액자

    f = font(58)
    for i, t in enumerate(('구구성', '수호대')):
        d.text((22, 30 + i * 58), t, font=f, fill=HANJI if i == 0 else GOLD)

    d.rectangle([22, 158, 62, 162], fill=JU)                        # 주(朱) 짧은 선
    d.text((22, 174), '곱셈구구 디펜스', font=font(24, BOLD), fill=HANJI)
    d.text((22, 208), '2~4학년 · 셈력으로 싸운다', font=font(15, MEDIUM), fill=(196, 186, 172))

    # ── 먹 테두리: 목록에서 카드 경계를 만든다(오른쪽이 밝아 없으면 흘러내린다)
    d.rectangle([0, 0, W - 1, H - 1], outline=MEOK, width=4)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    img = build()
    png = os.path.join(OUT, 'thumb.png')
    webp = os.path.join(OUT, 'thumb.webp')
    img.save(png)

    q = 92
    while q >= 60:
        img.save(webp, 'WEBP', quality=q, method=6)
        if os.path.getsize(webp) <= MAX_BYTES:
            break
        q -= 6

    # 실제 목록에서 보이는 크기로도 뽑아 둔다 — 이 크기에서 못 읽으면 실패다
    img.resize((200, 134), Image.LANCZOS).save(os.path.join(OUT, 'thumb-preview.png'))

    chk = Image.open(webp)
    assert chk.size == (W, H), f'크기 위반 {chk.size}'
    assert chk.mode in ('RGB', 'RGBA'), chk.mode
    print(f'✅ {webp}  {chk.size[0]}×{chk.size[1]} {chk.mode} '
          f'{os.path.getsize(webp) / 1024:.1f}KB (q={q})')
    if chk.mode == 'RGBA':
        sys.exit('✗ 알파가 남았다 — 등재 규격은 RGB')


if __name__ == '__main__':
    main()
