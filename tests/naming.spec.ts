import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALLIES, ENEMIES, RARITIES, SLOTS_BY_RARITY } from '../src/sim/units';
import { NICK_A, NICK_B } from '../src/save/schema';

/**
 * 이름 게이트 — `docs/RESEARCH.md` §3-4 가 "개발 착수 전 통과 필수"로 적어 두고
 * 체크박스를 비워 둔 항목이다("유닛·적·재화 명칭 전수 자체 창작 확인 · 금지어 목록 대조 자동 테스트").
 *
 * 🔴 왜 자동화하나: 셈지기가 24 → 38종, 엉킴괴수가 12 → 21종으로 늘었다. 이 규모에서
 *    "사람이 눈으로 훑는 확인"은 반드시 샌다. 같은 문서가 유닛명 충돌을 **🔴 높음** 리스크로
 *    분류해 두었으므로, 눈이 아니라 기계가 지켜야 한다.
 * ⚠️ 이 검사는 **상표 조사도 법률 자문도 아니다.** "명백히 남의 것"을 막는 하한선일 뿐이고,
 *    출시 전 법무 검토는 그대로 필요하다(RESEARCH §3 머리말).
 */

/**
 * 쓰지 않는 말.
 * - 경쟁작·타사 IP: 장르 선행작과 그 한국어 표기(RESEARCH §3-2 '마케팅에 경쟁작명 사용').
 * - 널리 알려진 창작물 제목: 전통 소재와 겹쳐 **무심코 쓰기 쉬운** 것들만 골랐다.
 *   (예: '각시탈'은 하회탈의 한 종류라는 점에서 전통 명칭이지만, 동명의 만화·드라마가
 *    워낙 유명해 유닛명으로 쓰면 연상 충돌이 크다. 실제로 v3 작업 중 한 번 넣었다가 뺐다.)
 */
const FORBIDDEN = [
  '냥코', '배틀캣츠', 'battlecats', 'battle cats', 'nyanko', 'ponos',
  '클래시', 'clash', '브롤', 'brawl', '포켓몬', 'pokemon', '피카츄',
  '마인크래프트', 'minecraft', '로블록스', 'roblox',
  '각시탈', '아기공룡', '둘리', '뽀로로', '타요', '핑크퐁', '상어가족',
];

/**
 * 공립학교 교구로 쓰이므로 **특정 종교의 예배 대상**을 전투 유닛으로 세우지 않는다.
 * 🔴 v3 작업 중 전설 셈지기를 '미륵돌부처'로 넣었다가 '선돌장군'(선사시대 입석)으로 바꿨다.
 *    선돌은 같은 '거대한 돌' 인상이면서 종교 중립이다.
 *    민간신앙에서 온 소재(도깨비·산신령·용왕·해태)는 이 범주로 보지 않는다 —
 *    특정 교단의 예배 대상이 아니라 설화 캐릭터다.
 */
const RELIGIOUS = ['부처', '불상', '보살', '미륵', '예수', '그리스도', '천사', '십자가', '알라', '마호메트'];

/** 저학년이 읽는 이름이라 무섭거나 폭력적인 낱말은 피한다 */
const SCARY = ['죽음', '시체', '피', '살인', '지옥', '악마', '저주', '무덤'];

/**
 * 문맥을 떼면 나쁘게 읽히는 말. 화면 글자에는 쓰지 않는다(코드 주석은 무관).
 * 🔴 '새끼'는 동물 새끼를 뜻해도 아이가 소리 내어 읽으면 교실에서 문제가 된다 —
 *    분열형 적의 설명에 실제로 들어가 있었고 교차검증에서 걸렸다.
 */
const MISREADABLE = ['새끼', '병신', '미친'];

function allNames(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const u of ALLIES) {
    out.push({ where: `아군 ${u.id}.name`, text: u.name });
    out.push({ where: `아군 ${u.id}.role`, text: u.role });
    if (u.skill) out.push({ where: `아군 ${u.id}.skill.name`, text: u.skill.name });
  }
  for (const e of ENEMIES) {
    out.push({ where: `적 ${e.id}.name`, text: e.name });
    out.push({ where: `적 ${e.id}.role`, text: e.role });
  }
  for (const r of RARITIES) out.push({ where: `등급 ${r.id}`, text: r.name });
  for (const a of NICK_A) out.push({ where: '별명 앞말', text: a });
  for (const b of NICK_B) out.push({ where: '별명 뒷말', text: b });
  return out;
}

describe('이름 게이트 (RESEARCH §3-4)', () => {
  it('금지어(경쟁작·타사 IP·유명 창작물 제목)가 들어간 이름이 없다', () => {
    const hits = allNames().filter(({ text }) =>
      FORBIDDEN.some((w) => text.toLowerCase().includes(w.toLowerCase())),
    );
    expect(hits.map((h) => `${h.where}="${h.text}"`)).toEqual([]);
  });

  it('특정 종교의 예배 대상을 전투 유닛으로 쓰지 않는다', () => {
    const hits = allNames().filter(({ text }) => RELIGIOUS.some((w) => text.includes(w)));
    expect(hits.map((h) => `${h.where}="${h.text}"`)).toEqual([]);
  });

  it('저학년에게 무서운 낱말이 없다', () => {
    const hits = allNames().filter(({ text }) => SCARY.some((w) => text.includes(w)));
    expect(hits.map((h) => `${h.where}="${h.text}"`)).toEqual([]);
  });

  it('문맥을 떼면 나쁘게 읽히는 말이 화면 글자에 없다', () => {
    const hits = allNames().filter(({ text }) => MISREADABLE.some((w) => text.includes(w)));
    expect(hits.map((h) => `${h.where}="${h.text}"`)).toEqual([]);
  });

  /** 🔴 같은 이름이 둘이면 도감·덱에서 아이가 구분할 수 없다 */
  it('셈지기·엉킴괴수 이름이 겹치지 않는다', () => {
    const names = [...ALLIES.map((u) => u.name), ...ENEMIES.map((e) => e.name)];
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    expect([...new Set(dup)]).toEqual([]);
  });

  it('id 도 겹치지 않는다 — 겹치면 그림이 서로 덮어쓴다', () => {
    const ids = [...ALLIES.map((u) => u.id), ...ENEMIES.map((e) => e.id)];
    const dup = ids.filter((n, i) => ids.indexOf(n) !== i);
    expect([...new Set(dup)]).toEqual([]);
  });

  /**
   * 🔴 이름은 **한글로만** 쓴다. 주 사용자가 초등 2학년이라 한자·영문 약자를 못 읽는다.
   *    (이 프로젝트는 예전에 메뉴 인장에 한자 龜 를 썼다가 같은 이유로 뺐다.)
   */
  it('셈지기·엉킴괴수 이름이 한글·공백뿐이다', () => {
    const bad = [...ALLIES, ...ENEMIES].filter((u) => !/^[가-힣 ]+$/.test(u.name));
    expect(bad.map((u) => `${u.id}="${u.name}"`)).toEqual([]);
  });

  /** 생성 프롬프트에도 경쟁작이 섞이면 화풍이 그쪽으로 끌려간다(RESEARCH §3-3) */
  it('에셋 생성 프롬프트에 경쟁작 이름이 없다', () => {
    for (const f of ['tools/gen-jobs-v2.mjs', 'tools/gen-jobs-v3.mjs']) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url).pathname, 'utf8').toLowerCase();
      // 이 테스트 파일 자체의 목록은 제외해야 하므로 프롬프트 파일만 본다
      const hits = FORBIDDEN.filter((w) => src.includes(w.toLowerCase()));
      expect(hits, f).toEqual([]);
    }
  });
});

/**
 * 로스터 데이터 무결성 — 두 미러(TS·프로브)가 **같은 JSON** 을 읽으므로,
 * JSON 자체가 틀리면 parity 테스트로는 절대 안 잡힌다(교차검증 지적).
 * 그래서 JSON 을 직접 검사한다.
 */
describe('로스터 데이터 무결성', () => {
  it('모든 등급에 출전 자리 수가 정의돼 있다', () => {
    // 🔴 `SLOTS_BY_RARITY[u.rarity] ?? 1` 은 모르는 등급을 **1자리로 통과**시킨다(fail-open).
    //    등급 이름에 오타가 나면 가장 센 셈지기가 한 자리만 먹고 나가는데,
    //    두 미러가 같은 오타를 읽으므로 미러 대조로는 영영 안 드러난다.
    const missing = RARITIES.filter((r) => typeof SLOTS_BY_RARITY[r.id] !== 'number');
    expect(missing.map((r) => r.id)).toEqual([]);
    for (const r of RARITIES) expect(SLOTS_BY_RARITY[r.id]).toBeGreaterThanOrEqual(1);
  });

  it('모든 셈지기·엉킴괴수의 등급/참조가 실재한다', () => {
    const ids = new Set(RARITIES.map((r) => r.id));
    expect(ALLIES.filter((u) => !ids.has(u.rarity)).map((u) => `${u.id}:${u.rarity}`)).toEqual([]);
    // 분열이 가리키는 새끼가 실제로 있어야 한다 — 없으면 조용히 아무 일도 안 일어난다
    const eids = new Set(ENEMIES.map((e) => e.id));
    const dangling = ENEMIES.filter((e) => e.split && !eids.has(e.split.id));
    expect(dangling.map((e) => `${e.id}→${e.split!.id}`)).toEqual([]);
  });
});
