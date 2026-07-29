#!/usr/bin/env node
/**
 * v2 신규 에셋 생성 잡 파일 만들기 → Meta AI 배치 입력.
 *
 * 🔴 화풍 접미사(STYLE)는 v1과 **글자 그대로 같아야** 한다. 한 글자만 달라도 톤이 갈리고,
 *    같은 화면에 v1·v2 캐릭터가 나란히 서면 즉시 티가 난다.
 * 🔴 아군은 facing right, 적은 facing left — 코드는 좌우 반전을 하지 않는다(에셋이 정본).
 * 🔴 Meta는 알파를 못 만든다 → 순백 배경 + cutout(rembg).
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

const BG_STYLE =
  'Korean folk art minhwa style, bold ink outlines, flat colors, horizontal 16:9 game background, ' +
  'no characters, no text, no letters, no UI';

/** 등급이 올라갈수록 시각적으로 확실히 더 귀해 보여야 한다 */
const GRADE = {
  normal: '',
  rare: ' slightly ornate details,',
  unique: ' ornate elegant ornaments, subtle glow,',
  epic: ' majestic ornate armor with gold accents, imposing presence,',
  legend: ' legendary divine radiant aura, lavish gold and jade ornaments, awe-inspiring,',
};

const ALLIES = [
  ['jipsin',     'normal', 'a tiny cheerful straw sandal spirit with little arms and a woven straw body, carrying a twig'],
  ['onggi',      'normal', 'a round earthenware onggi jar spirit with a lid hat and a calm smiling face, sturdy'],
  ['yeonip',     'normal', 'a small child spirit wearing a big green lotus leaf as a hat and cloak, holding a dewdrop'],
  ['buttong',    'normal', 'a bamboo brush-holder spirit with calligraphy brushes sticking out like hair, holding one brush as a spear'],
  ['chorong',    'rare',   'a blue silk palace lantern spirit glowing warmly, with tassels and small arms'],
  ['namak',      'rare',   'a nimble wooden clog merchant spirit wearing straw hat, wooden shoes, running pose'],
  ['sotdu',      'rare',   'a broad cast-iron cauldron lid warrior holding the lid as a huge round shield'],
  ['baekho',     'unique', 'a noble white tiger guardian standing on hind legs, striped white and black fur, fierce'],
  ['cheongryong','unique', 'a coiling blue-green Korean dragon spirit with flowing whiskers, floating'],
  ['samjogo',    'unique', 'a three-legged golden crow spirit with sun disc behind it, wings spread'],
  ['hyeonmu',    'epic',   'a black tortoise guardian with a snake coiled around its shell, heavy stone armor'],
  ['jujak',      'epic',   'a vermilion phoenix bird spirit with flame plumage, wings spread wide'],
  ['dokkabidae', 'epic',   'a large dokkaebi captain goblin with two horns, a spiked iron club and a general\'s cape'],
  ['gumiho',     'legend', 'a nine-tailed fox spirit in a hanbok, nine flowing white tails fanned out'],
  ['sansin',     'legend', 'an old mountain-god sage with a long white beard, a staff and a tiger at his side'],
  ['yongwang',   'legend', 'a dragon king in royal robes and a crown, holding a trident, sea waves at his feet'],
];

const ENEMIES = [
  ['e_zero',   'a hollow round zero-shaped ghost monster, pale grey, empty eyes, drifting'],
  ['e_knot',   'a long snake monster made of tangled knotted rope, dark green, hissing'],
  ['e_minus',  'a crooked crow monster holding a bent minus-sign stick like a spear, black feathers'],
  ['e_shield', 'a squat armored turtle monster with a cracked tangled iron shell, brown and rust'],
  ['e_swarm',  'a cluster of tiny scribbled number bug monsters swarming together, chaotic scribbles, ink black'],
  ['e_boss2',  'a huge knot-king monster made of ten braided ropes with a crooked iron crown, imposing'],
  ['e_boss3',  'a colossal endless-tangle monster, swirling infinite loops of dark thread, glowing red eyes, terrifying but cartoonish'],
];

const BGS = [
  ['bg_night', 'wide empty moonlit bamboo grove at night, indigo sky with a large full moon, silver bamboo'],
  ['bg_sea',   'wide empty underwater dragon palace courtyard, jade water, coral pillars, rising bubbles'],
  ['bg_sky',   'wide empty floating palace above a sea of clouds at dawn, pink and gold sky, distant peaks'],
];

const jobs = [];
for (const [id, grade, desc] of ALLIES) {
  jobs.push({
    prompt: `${desc},${GRADE[grade]} facing right. ${STYLE}`,
    output: join(RAW, 'units', `${id}.png`),
    cutout: true,
  });
}
for (const [id, desc] of ENEMIES) {
  jobs.push({
    prompt: `${desc}, facing left. ${STYLE}`,
    output: join(RAW, 'enemies', `${id}.png`),
    cutout: true,
  });
}
for (const [id, desc] of BGS) {
  jobs.push({ prompt: `${desc}, ${BG_STYLE}`, output: join(RAW, 'bg', `${id}.png`), cutout: false });
}

mkdirSync(join(RAW, 'units'), { recursive: true });
mkdirSync(join(RAW, 'enemies'), { recursive: true });
mkdirSync(join(RAW, 'bg'), { recursive: true });
const out = join(RAW, 'jobs-v2.json');
writeFileSync(out, JSON.stringify(jobs, null, 1));
console.log(`${jobs.length}건 → ${out}`);
console.log(`  아군 ${ALLIES.length} · 적 ${ENEMIES.length} · 배경 ${BGS.length}`);
