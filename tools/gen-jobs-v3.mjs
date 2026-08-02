#!/usr/bin/env node
/**
 * v3 신규 에셋 생성 잡 파일 만들기 → Meta AI 배치 입력.
 *
 * 🔴 화풍 접미사(STYLE)는 v1·v2와 **글자 그대로 같아야** 한다. 한 글자만 달라도 톤이 갈리고,
 *    같은 화면에 구·신 캐릭터가 나란히 서면 즉시 티가 난다.
 * 🔴 아군은 facing right, 적은 facing left — 코드는 좌우 반전을 하지 않는다(에셋이 정본).
 * 🔴 Meta는 알파를 못 만든다 → 순백 배경으로 뽑고 **`tools/cutout-flat.mjs`** 로 오린다.
 *    (`--cutout`(rembg)은 쓰지 않는다. rembg 는 밝은 얼굴을 배경으로 오인해 지운다 —
 *     해태가 유령이 된 채 배포된 적이 있다. 먹선 flood fill 은 그 사고가 구조적으로 불가능하다.)
 *
 * 실행: node tools/gen-jobs-v3.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const RAW = join(ROOT, '_raw');

const STYLE =
  'Korean folk art minhwa style, bold black ink outlines, flat vibrant dancheong palette ' +
  '(vermilion red, indigo blue, jade green, ochre yellow, white), cute 3-head-tall chibi proportions, ' +
  'full body visible, single character centered, pure solid white background, no text, no letters, ' +
  'no shadow, no border, children\'s educational game sprite art';

/** 등급이 올라갈수록 시각적으로 확실히 더 귀해 보여야 한다 */
const GRADE = {
  normal: '',
  rare: ' slightly ornate details,',
  unique: ' ornate elegant ornaments, subtle glow,',
  epic: ' majestic ornate armor with gold accents, imposing presence,',
  legend: ' legendary divine radiant aura, lavish gold and jade ornaments, awe-inspiring,',
};

/** 신규 셈지기 14종 */
const ALLIES = [
  ['dongjaseok',  'normal', 'a small chubby stone child statue spirit with a round carved face and short arms, granite grey with mossy patches'],
  ['jorongbak',   'normal', 'a bouncy round bottle-gourd spirit with a green vine curl on top, tiny arms and legs, cheerful'],
  ['bitjaru',     'normal', 'a broom spirit made of a straw besom with a little face on the handle, sweeping wide with both arms'],
  ['chotbul',     'rare',   'a young candle-boy spirit in a scholar hat with a bright flame on his head, holding a small lantern'],
  ['dolhareubang','rare',   'a stout Jeju dolhareubang basalt grandfather statue with a mushroom hat, big round eyes, hands on belly'],
  ['mulbangul',   'rare',   'a graceful water-droplet bride spirit in a blue hanbok, a large clear waterdrop on her shoulder, splashing'],
  ['kkwaenggwari','rare',   'a lively musician spirit striking a small brass gong, sound rings drawn around him, sangmo hat with a white ribbon'],
  ['talchum',     'unique', 'a swift Korean talchum mask dancer in a smiling wooden hahoe mask and flowing red-and-white robe, mid-leap, twin fans'],
  ['bulgasari',   'unique', 'a shaggy iron-eating bulgasari beast with a bear-like body, small horns and iron nails stuck in its fur, chewing a nail'],
  ['seonnyeo',    'unique', 'a heavenly fairy in flowing pastel silk ribbons, scattering flower petals from a basket, floating'],
  ['bulgae',      'epic',   'a fierce fire dog with burning mane and tail, a small sun disc held in its jaws, charging'],
  ['eosa',        'epic',   'a secret royal inspector in a black gat hat and dark robe, raising a round bronze horse-tablet that glows'],
  ['cheollima',   'legend', 'a winged celestial horse rearing up, streaming mane, hooves trailing light'],
  ['seondol',     'legend', 'a colossal ancient standing menhir stone guardian with a simple carved face and a flat capstone, upright, weathered granite, moss'],
];

/** 신규 엉킴괴수 9종 */
const ENEMIES = [
  ['e_split',    'a fat tangled caterpillar monster with a segmented body that looks ready to split in two, ink black and murky green'],
  ['e_splitlet', 'a tiny tangled grub monster, one small segment with two dot eyes, ink black'],
  ['e_sky',      'a torn paper kite monster floating high, cross-frame, ragged tail, scowling face on the sail'],
  ['e_drum',     'a squat monster carrying a big Korean barrel drum on its belly, beating it with two sticks, sound rings around'],
  ['e_ghost',    'a dense dark ink-cloud monster with many small angry eyes inside the cloud, drifting low'],
  ['e_dash',     'a lightning-fast wisp monster shaped like a crooked bolt with thin legs, motion streaks, sprinting'],
  ['e_armor',    'a heavy iron-plated tangle monster, thick riveted armor plates over knotted rope, rust brown'],
  ['e_thorn',    'a squat bramble monster, a ball of thorny black vines with a wide mouth and thorns bristling outward'],
  ['e_boss4',    'a colossal number-devouring dragon monster with a wide jaw swallowing broken numerals, dark scales and gold horns, imposing'],
];

const jobs = [];
for (const [id, grade, desc] of ALLIES) {
  jobs.push({
    prompt: `${desc},${GRADE[grade]} facing right. ${STYLE}`,
    output: join(RAW, 'units', `${id}.png`),
    cutout: false,
  });
}
for (const [id, desc] of ENEMIES) {
  jobs.push({
    prompt: `${desc}, facing left. ${STYLE}`,
    output: join(RAW, 'enemies', `${id}.png`),
    cutout: false,
  });
}

mkdirSync(join(RAW, 'units'), { recursive: true });
mkdirSync(join(RAW, 'enemies'), { recursive: true });
const out = join(RAW, 'jobs-v3.json');
writeFileSync(out, JSON.stringify(jobs, null, 1));
console.log(`${jobs.length}건 → ${out}`);
console.log(`  아군 ${ALLIES.length} · 적 ${ENEMIES.length}`);
console.log('  다음: ~/.claude/venvs/vibes/bin/python ~/.claude/bin/meta-image.py --batch ' + out);
console.log('  그 다음: 각 png 에 node tools/cutout-flat.mjs (rembg 아님)');
