#!/usr/bin/env node
/**
 * 스프라이트 알파 무결성 게이트 — 배경 제거가 캐릭터를 갉아먹었는지 본다.
 *
 * 🔴 왜 있나: 이 검사가 없어서 **해태 유닛이 유령인 채로 배포됐다.** 배경 제거(rembg)는
 *    "무엇이 주인공인가"를 추측하는데, 민화풍 캐릭터는 얼굴이 아이보리라 순백 배경과
 *    구분을 못 하고 지워버린다. 해태는 얼굴·뿔 알파가 0까지 깎였고(반투명 69%),
 *    e_shield 는 아예 **몸통과 등껍질이 통째로 사라져 머리만 떠다녔다**(불투명 6.6%).
 *    둘 다 콘솔 에러도 테스트 실패도 남기지 않았다 — 게임 안 128px 에서는 그냥
 *    "밝은 얼굴", "작은 적"으로 보였고, 인장으로 키우고 나서야 드러났다.
 *
 * 세 가지 고장을 따로 잰다. 하나만 봐서는 셋 다 못 잡는다:
 *   ① 내부 구멍   — 실루엣 안쪽의 완전투명. 얼굴에 몰리면 사고.
 *                    ⚠️ 격자·그물·문틀은 원래 뚫려 있으므로 비율만으로 단정하지 않는다.
 *   ② 반투명 잔재 — 알파가 40~200으로 깎인 영역. "번져 보인다"의 정체.
 *   ③ 대량 삭제   — 불투명 면적이 또래 대비 급감. ②는 살아남은 부분만 보므로
 *                    90%가 지워진 스프라이트를 오히려 '깨끗하다'고 판정한다(실측).
 *
 * 실행: node tools/asset-check.mjs [_raw/units _raw/enemies _raw/crest]
 * 종료: 0 통과 / 1 위반
 */
import { readdirSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('..', import.meta.url).pathname;
/**
 * 🔴 인터프리터를 한 대의 로컬 venv 에 못 박아 두면 **그 컴퓨터 밖에서는 게이트가 사라진다.**
 *    게다가 아래 "없으면 건너뜀"과 만나면 CI 는 아무것도 검사하지 않고 초록불을 켠다 —
 *    안 도는 것보다 **돈다고 착각하는 쪽이 더 나쁘다**. 찾을 수 있는 파이썬을 쓴다.
 */
const LOCAL_PY = join(process.env.HOME ?? '', '.claude/venvs/vibes/bin/python');
const PY = process.env['GUGU_PY'] || (existsSync(LOCAL_PY) ? LOCAL_PY : 'python3');
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['_raw/units', '_raw/enemies', '_raw/crest'];

const GHOST_MAX = 20;    // 내부 반투명 상한(%) — 정상 스프라이트는 2~5%, 고장난 해태는 69%였다
const SOLID_MIN = 0.45;  // 불투명 면적이 또래 중앙값의 이 배수 미만이면 본체가 지워진 것

/**
 * 🔴 파이썬·의존성이 없을 때 **조용히 통과시키지 않는다.** 예전엔 exit 0 이라
 *    "게이트가 돌았다"와 "게이트가 자기를 껐다"가 출력상 구분되지 않았다.
 *    일부러 건너뛰려면 ASSET_CHECK_OPTIONAL=1 을 명시해야 한다.
 */
try {
  execFileSync(PY, ['-c', 'import numpy, scipy, PIL'], { stdio: 'ignore' });
} catch {
  const msg = `✗ 스프라이트 게이트를 돌릴 수 없다 — ${PY} 에 numpy/scipy/pillow 가 없다.`;
  if (process.env['ASSET_CHECK_OPTIONAL'] === '1') { console.log(`${msg} (ASSET_CHECK_OPTIONAL=1 이라 건너뜀)`); process.exit(0); }
  console.error(`${msg}\n  설치: pip install numpy scipy pillow   /  다른 파이썬: GUGU_PY=/path/to/python`);
  process.exit(1);
}

const files = dirs.flatMap((d) => {
  const abs = isAbsolute(d) ? d : join(ROOT, d);
  return existsSync(abs) ? readdirSync(abs).filter((f) => /\.(png|webp)$/i.test(f)).map((f) => join(abs, f)) : [];
});
/**
 * 🔴 "검사할 파일 0개"도 통과로 세지 않는다 — 단, 기본 대상(_raw)은 커밋되지 않아
 *    없는 게 정상이므로 거기서만 조용히 넘어간다. **경로를 직접 지정했는데 0개면 실패다**
 *    (디렉터리 이름이 바뀌거나 빌드가 산출물을 안 냈는데 CI가 초록불이 되는 걸 막는다).
 */
if (!files.length) {
  const explicit = process.argv.slice(2).length > 0;
  if (!explicit) { console.log('! 검사할 원본이 없다(_raw 는 배포본에 없다)'); process.exit(0); }
  console.error(`✗ 지정한 경로에 검사할 이미지가 없다: ${dirs.join(', ')}`);
  process.exit(1);
}

const rows = JSON.parse(execFileSync(PY, ['-c', `
import sys, json
import numpy as np
from scipy import ndimage
from PIL import Image

res = []
for path in sys.argv[1:]:
    im = Image.open(path).convert('RGBA')
    im.thumbnail((320, 640), Image.LANCZOS)
    al = np.array(im)[..., 3]
    h = al.shape[0]

    # 바깥 배경 = 테두리에서 이어진 투명영역. 그 밖의 투명 = 내부 구멍.
    lbl, n = ndimage.label(al < 40)
    edge = np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))
    inner = ~np.isin(lbl, edge[edge > 0])

    hole = inner & (al < 40)
    ys = np.nonzero(hole)[0]
    res.append({
        'f': path.split('/')[-1],
        'solid': float((al >= 200).mean() * 100),
        'ghost': float((((al >= 40) & (al < 200))[inner]).mean() * 100) if inner.any() else 0.0,
        'hole': float(hole.mean() * 100),
        # 구멍이 위쪽 40%(=얼굴)에 몰려 있으면 사람이 봐야 한다
        'face': float((ys < h * 0.40).mean() * 100) if ys.size else 0.0,
    })
print(json.dumps(res))
`, ...files], { encoding: 'utf8' }));

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const medSolid = median(rows.map((r) => r.solid));

const fail = [];
for (const r of rows) {
  if (r.ghost > GHOST_MAX) fail.push(`${r.f}: 내부 반투명 ${r.ghost.toFixed(1)}% (상한 ${GHOST_MAX}%) — 배경 제거가 캐릭터를 갉았다`);
  if (r.solid < medSolid * SOLID_MIN) fail.push(`${r.f}: 불투명 ${r.solid.toFixed(1)}% (또래 중앙값 ${medSolid.toFixed(1)}%) — 본체 대부분이 지워졌다`);
}

rows.sort((a, b) => b.ghost - a.ghost);
console.log(`# 스프라이트 알파 무결성 — ${rows.length}개 (불투명 중앙값 ${medSolid.toFixed(1)}%)`);
for (const r of rows.slice(0, 5)) {
  console.log(`  ${r.f.padEnd(18)} 불투명 ${r.solid.toFixed(1).padStart(5)}%  반투명 ${r.ghost.toFixed(1).padStart(4)}%  구멍 ${r.hole.toFixed(1).padStart(4)}%${r.hole > 3 && r.face > 60 ? '  ⚠️ 구멍이 얼굴에 몰림 — 눈으로 확인' : ''}`);
}

if (fail.length) {
  console.error(`\n✗ 알파 무결성 위반 ${fail.length}건`);
  for (const m of fail) console.error(`  - ${m}`);
  console.error('\n  고치는 법: 순백 배경으로 다시 뽑고 node tools/cutout-flat.mjs 로 컷아웃한다(rembg 금지).');
  process.exit(1);
}
console.log('✅ 위반 0건');
