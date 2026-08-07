import type { StageDef, SpawnEntry } from './types';
import type { QType } from '../edu/curriculum';
import { ENEMY_BY_ID } from './units';

/**
 * 스테이지 — **무한**. 모든 값은 index 하나에서 결정론적으로 나온다(저장할 게 없다).
 *
 * 구조: 구역(chapter) = 10판, 매 10번째가 수문장(보스).
 *
 * 🔴 1~CAMPAIGN_STAGES 는 "정확도 60%인 아이도 소환 없이 전부 깬다"를 보장하는 구간이다
 *    (밸런스 게이트 G2). 그 뒤부터는 무한 도전이고, 부족한 전력은 소환·승급으로 메운다 —
 *    먹물은 정답에서만 나오므로 **더 많이 맞힌 아이가 더 멀리 간다**가 이 게임의 성장선이다.
 */

/** 소환 없이 클리어를 보장하는 캠페인 길이 */
export const CAMPAIGN_STAGES = 30;
export const CHAPTER_LEN = 10;
export const MAP_LEN = 1000;
/** 한 판 상한(초) — 교착 방지 */
export const MAX_SEC = 420;

/** 볼륨(적 수)은 이 지점에서 성장을 멈춘다 — 계속 늘리면 한 판이 무한정 길어진다 */
const VOLUME_CAP_STAGE = 30;
/**
 * 캠페인 이후 적에게만 붙는 추가 배율(아군 진도 성장은 여기서 멈춘다).
 * 🔴 1.05 였다. 그때 무한 구간은 **벽이 아니라 복도**였다 — 소환 0 로스터조차 ST31~50 을
 *    전부 100% 로 통과했고(실측), 그래서 "못 깨던 판을 키워서 깬다"는 재도전 루프가
 *    시작될 지점이 아예 없었다. 실사용자 보고 "긴장감이 없어"의 절반은 여기서 나온다.
 *    1.07 이면 같은 지점의 적 배율이 2.65배 → 3.87배가 된다.
 */
const ENDLESS_STEP = 1.07;

const CHAPTER_NAMES = [
  '첫걸음 들판',
  '셈바람 성벽',
  '구구 동굴',
  '달빛 대숲',
  '용궁 앞바다',
  '구름 위 하늘성',
];

const BACKGROUNDS = ['bg_field', 'bg_wall', 'bg_cave', 'bg_night', 'bg_sea', 'bg_sky'];
const BOSSES = ['e_boss', 'e_boss2', 'e_boss3', 'e_boss4'];

/** 판 이름 — 구역 안 위치로 붙인다 */
const POS_NAMES: readonly string[] = ['어귀', '오솔길', '건널목', '너른터', '갈림길', '비탈', '숲그늘', '돌다리', '고갯마루', '수문장'];

/** 문항 유형 개방 순서 — src/edu/curriculum.ts 의 난이도(baseB) 오름차순과 일치해야 한다 */
export const TYPE_ORDER: QType[] = ['A1', 'S1', 'A2', 'M1', 'S2', 'AS1', 'M2', 'D1', 'AS2', 'M3', 'D2'];

export function chapterOf(index: number): number {
  return Math.floor((index - 1) / CHAPTER_LEN) + 1;
}
export function posOf(index: number): number {
  return ((index - 1) % CHAPTER_LEN) + 1;
}
export function isBossStage(index: number): boolean {
  return posOf(index) === CHAPTER_LEN;
}

export function chapterName(chapter: number): string {
  const base = CHAPTER_NAMES[(chapter - 1) % CHAPTER_NAMES.length]!;
  const lap = Math.floor((chapter - 1) / CHAPTER_NAMES.length);
  return lap === 0 ? base : `${base} 깊은 곳 ${lap}`;
}

export function stageBackground(index: number): string {
  return BACKGROUNDS[(chapterOf(index) - 1) % BACKGROUNDS.length]!;
}

/**
 * 🔴 아군 성장('셈나라 기운')은 진도 연동 **자동**이다 — 재화로 구매하지 않는다.
 *    구매식으로 두면 필요 재화가 획득 가능량의 40배가 되어 경제가 성립하지 않는다(v1 실측).
 *    캠페인 끝에서 멈추고, 그 뒤 전력 상승은 소환·승급이 담당한다.
 */
export function allyGrowth(index: number): number {
  return Math.pow(1.13, Math.min(index, CAMPAIGN_STAGES) - 1);
}

/**
 * 적 배율 — 캠페인까지는 아군 성장과 정확히 상쇄되고, 그 뒤부터 벌어진다.
 *
 * ⚠️ **캠페인 안에 경사를 넣으려다 되돌렸다(2026-08-07). 다시 시도하기 전에 이걸 읽을 것.**
 *    "정답 80%·95% 아이가 ST1~ST30 전 판 승률 100%"라는 실측을 보고 캠페인 배율에
 *    판당 ×1.032 경사를 넣었더니 **잘하는 아이는 여전히 100% 승, 못하는 아이만 무너졌다**
 *    (정답 40% 패배율 38%→74%, 60% 아이 ST18 승률 90%→33%). ×1.012 로 낮춰도 방향은 같았다
 *    (40% 아이 38%→61%).
 *    이유는 tier.ts 머리말에 이미 적혀 있던 것과 같다 — **전역 배율은 강자에게 안 듣는다.**
 *    잘 맞히면 셈력이 많아 유닛을 더 세우고, 적은 성문 앞에서 16대1로 죽을 뿐이다.
 *    난이도를 아이별로 가르는 손잡이는 **적응 단계(tier)** 하나뿐이다 — 거기를 손대라.
 */
export function enemyMult(index: number): number {
  const over = Math.max(0, index - CAMPAIGN_STAGES);
  return allyGrowth(index) * Math.pow(ENDLESS_STEP, over);
}

/**
 * 이 판에서 낼 문항 유형 — 최신 개방 유형 + 복습 2종.
 * 🔴 회전 인덱스가 겹쳐 한 종류만 남는 판이 생긴다(1판이 실제로 '뺄셈' 하나뿐이었다).
 *    개방된 유형이 2종 이상이면 반드시 2종 이상 나오도록 **최신 쪽부터** 채운다.
 */
export const REVIEW_WINDOW = 6;

export function quizTypesFor(index: number): QType[] {
  const open = TYPE_ORDER.slice(0, Math.min(TYPE_ORDER.length, 2 + Math.floor((index - 1) / 3)));
  /**
   * 🔴 복습은 **최근에 배운 것 안에서만** 돈다.
   *    예전엔 회전 인덱스가 겹칠 때 채우기 루프가 `open[0]`부터 시작해서,
   *    40판(나눗셈 구간)에서도 **'한 자리 덧셈'이 세 유형 중 하나로** 나왔다.
   *    4학년에게 3+2 를 풀리는 건 시간 낭비이고, "뒤로 갈수록 어려워진다"는 약속도 깬다.
   *    아주 오래된 내용의 유지는 판 구성이 아니라 SRS(src/edu/srs.ts)가 담당한다.
   */
  const pool = open.slice(Math.max(0, open.length - REVIEW_WINDOW));
  const picks: QType[] = [];
  const add = (t: QType | undefined): void => { if (t && !picks.includes(t)) picks.push(t); };
  add(pool[pool.length - 1]);
  add(pool[(index * 3) % pool.length]);
  add(pool[(index * 7 + 2) % pool.length]);
  for (let i = pool.length - 1; i >= 0 && picks.length < Math.min(3, pool.length); i--) add(pool[i]);
  // 쉬운 것부터 보여 준다 — 아이가 읽는 순서와 배운 순서를 맞춘다
  return picks.sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b));
}

/** 은퇴하지 않는 웨이브 */
const FOREVER = Infinity;   // 🔴 9999 로 두면 '무한'이 1만 판에서 끝난다(교차검증 지적)

/**
 * 적 등장 표 — [id, 등장 스테이지, **은퇴 스테이지**, 첫 등장 시각, 주기 기준, 주기 하한, 예산 지분]
 *
 * 🔴 수량을 적별 계수로 정하지 않는다. 그렇게 하면 **적 종류를 하나 추가할 때마다
 *    총 난이도가 그만큼 올라간다** — 실제로 v2 작업 중 적 3종을 추가했더니 ST10 총 체력이
 *    v1 대비 51% 뛰어 전 구간이 전멸했다. 지분(share) 방식은 총량을 먼저 정하고 나눈다.
 *
 * 🔴 **그래도 종류를 무한정 늘리면 안 된다 — 한 판에 동시에 나오는 종류 수에 상한이 있다.**
 *    수량은 `max(1, round(...))` 이라 지분이 아무리 작아도 **최소 1마리는 나온다.** 그래서
 *    동시 활성 종류가 늘면 "종류당 1마리"만으로 예산이 다 소진된다 — v3 에서 16종을 동시에
 *    켰더니 ST27 에서 1마리씩만 세워도 8,580(예산 8,424)이 되어, 물량 담당(물음표벌레)이
 *    9마리에서 1마리로 쪼그라들고 총 위협은 오히려 31%→53% 초과가 됐다.
 *    실측: 정답 60% 아이 ST20 승률 95%→24%, ST27 81%→38%(G2 6건 FAIL).
 *
 * 🔴 그래서 **옛 괴수는 물러난다.** 동시 활성은 10종 안팎으로 유지한다. 부수 효과로
 *    "구역을 넘으니 처음 보는 괴수가 나온다"가 생겨 진행감도 같이 산다.
 *    새 종을 넣을 때는 반드시 `GUGU_SWEEP_SKIP` 로 원인 귀속을 재고 은퇴표를 함께 손볼 것.
 *
 * 🔴 그리고 지분이 고정하는 것은 **총 체력이지 총 위협이 아니다.** 광역·돌파·방어·장사거리는
 *    같은 체력으로 훨씬 세게 싸운다(하늘연 한 종만으로 ST29 승률 24%p). 특기 있는 종은
 *    지분을 낮게 준다.
 *
 * ⚠️ **행 순서를 보기 좋게 정렬하지 말 것.** 이 배열의 순서가 그대로 `spawns` 순서가 되고,
 *    그건 같은 프레임에 여러 웨이브가 겹칠 때 **누가 먼저 나오는지**를 정한다 — 즉
 *    정렬은 겉모습이 아니라 시뮬 결과를 바꾼다(그리고 프로브와 함께 바꿔야 한다).
 *    등장 스테이지 순으로 읽고 싶으면 주석의 '등장' 열을 보면 된다.
 */
const WAVES: [string, number, number, number, number, number, number][] = [
  //  id          등장  은퇴     t0   주기   하한  지분
  ['e_mul',     1, FOREVER,  3,  9.0,  4.0, 0.30],
  ['e_bat',     2,      12, 14, 13.0,  5.5, 0.12],
  ['e_swarm',   3, FOREVER,  8,  8.0,  3.5, 0.10],
  ['e_arch',    4,      14, 24, 20.0,  8.0, 0.12],
  ['e_split',   5, FOREVER, 20, 16.0,  7.0, 0.06],
  ['e_rock',    6,      16, 52, 36.0, 16.0, 0.14],
  ['e_zero',    7,      13, 18, 10.0,  4.0, 0.08],
  ['e_sky',    12, FOREVER, 28, 22.0,  9.0, 0.05],
  ['e_knot',    9,      18, 30, 22.0,  9.0, 0.12],
  ['e_ghost',  15, FOREVER, 34, 26.0, 12.0, 0.06],
  ['e_minus',  12,      20, 36, 26.0, 11.0, 0.10],
  ['e_dash',   13, FOREVER, 26, 18.0,  7.0, 0.04],
  ['e_shield', 16, FOREVER, 60, 45.0, 22.0, 0.14],
  ['e_armor',  18, FOREVER, 44, 30.0, 14.0, 0.06],
  ['e_thorn',  20, FOREVER, 50, 34.0, 15.0, 0.06],
  ['e_drum',   22, FOREVER, 40, 28.0, 13.0, 0.05],
];

/**
 * 수량 계산에 쓰는 **실효 체력**. 갈래벌레처럼 쓰러지며 새끼를 남기는 적은
 * 새끼의 체력까지 자기 몫으로 쳐야 예산이 안 샌다.
 * 🔴 이걸 빼면 분열형을 넣는 순간 그 웨이브가 예산의 3배를 실제로 내보낸다 —
 *    "종류를 늘려도 총 난이도가 변하지 않는다"는 지분 방식의 전제가 깨진다.
 */
function effectiveHp(id: string): number {
  const e = ENEMY_BY_ID.get(id);
  if (!e) return 200;
  const sp = e.split;
  const childHp = sp ? (ENEMY_BY_ID.get(sp.id)?.hp ?? 0) * sp.n : 0;
  return e.hp + childHp;
}

/**
 * 물량 증가 기울기. 🔴 이 값과 `REWARD_SLOPE_RATIO`(economy.ts)는 **짝**이다 —
 * 적 수가 늘어난 만큼 정답 보상도 올라가야 저성취 아동이 후반에 막히지 않는다.
 * 한쪽만 바꾸면 G2(하드월 없음)가 즉시 깨진다(스윕 실측: 보상 고정 시 ST27부터 붕괴).
 */
export const BUDGET_SLOPE = 0.10;

/**
 * 성 체력 계수 — 성은 아군 성장과 자동 상쇄되므로 난이도가 아니라 **판 길이**를 정한다.
 * 🔴 신바람(아군 가속)을 넣으면서 30000 → 42000 으로 올렸다. 아군이 빨라진 만큼 판이
 *    짧아져 ST1~ST30 전 구간이 목표 길이(55~240초) 아래로 떨어졌기 때문이다(G1 8건 FAIL).
 *    기능을 넣으면 길이 계수도 같이 봐야 한다 — 둘은 같은 값을 다르게 미는 손잡이다.
 */
/**
 * 적 성 체력 계수.
 * 🔴 42000 이었다. 그때 1판은 **성:적군 체력이 9:1** 이라, 전선이 적 성에 닿는 24초 이후로는
 *    50초 넘게 "무저항 체력바 갈기"만 남았다(실측: 28초부터 화면의 적 0마리).
 *    아이 눈에는 "적이 안 나온다 / 성이 너무 세다"로 보인다 — 실제 사용자 보고와 일치.
 *    스윕 실측(아군 상한 16 기준): 34000·28000·23000 전부 게이트 통과, 19000 부터 G5(학습량)
 *    가 깨진다. 바닥(23000)에 여유를 두고 25000 을 쓴다 → 1판 성 체력 21000 → 12500(−40%).
 *    ⚠️ 물량(적 예산) 쪽으로는 못 푼다 — 성→적군으로 체력을 옮기는 안은 **전부 G2 를 깼다**
 *       (성은 되받아치지 않지만 적군은 때린다). 초반 물량만 올리는 안도 중반이 무너져 FAIL.
 */
const CASTLE_K = 25000;
/**
 * 1판 적 **군대** 총 체력의 기준값. `CASTLE_K`(성)와 짝이다.
 * 🔴 이 둘의 비율이 곧 "한 판이 전투인가 체력바 갈기인가"를 정한다 —
 *    9:1 이면 90%가 무저항 성 때리기가 된다(실측).
 */
const BUDGET_K = 2340;

/**
 * 판 길이 램프 — 첫 판은 짧게, 캠페인 중반에 기준 길이에 도달한다.
 *
 * 🔴 왜 필요한가: 성 체력이 아군 성장과 정확히 같은 속도로 커지면 **모든 판의 길이가 같다.**
 *    ST1 도 ST30 과 같은 길이가 되어 "첫 판인데 왜 안 끝나지"가 된다(사용자 실플레이 보고).
 *    난이도(적 예산·배율)는 그대로 두고 **길이만** 초반에 줄인다 — 그래야 G2(정확도 60%
 *    무소환 클리어)에 손대지 않고 체감만 고친다.
 * 🔴 우리 성에는 이 램프를 걸지 않는다. 우리 성 체력은 "버틸 수 있는 시간"이라 줄이면
 *    초반이 오히려 어려워진다 — 방향이 반대다.
 */
const LEN_RAMP_END = 12;
const LEN_RAMP_MIN = 0.50;
export function lengthRamp(index: number): number {
  const t = Math.min(1, Math.max(0, (index - 1) / (LEN_RAMP_END - 1)));
  return LEN_RAMP_MIN + (1 - LEN_RAMP_MIN) * t;
}

/** 한 판에 나오는 적의 기준 총 체력(배율 적용 전). 볼륨은 캠페인 끝에서 멈춘다. */
export function enemyBudget(index: number): number {
  const v = Math.min(Math.max(1, index), VOLUME_CAP_STAGE);
  return BUDGET_K * (1 + (v - 1) * BUDGET_SLOPE);
}

/** 보스가 가져가는 예산 비중 / 보스 판에서 잡몹에 남기는 비중 */
const BOSS_SHARE = 0.5, BOSS_MOB_SHARE = 0.75;
/** 한 종류가 화면을 뒤덮지 않게 하는 상한 */
const PER_WAVE_CAP = 40;

export function stageDef(index: number): StageDef {
  const n = Math.max(1, Math.floor(index));
  const chapter = chapterOf(n);
  const pos = posOf(n);
  const boss = isBossStage(n);
  const mult = enemyMult(n);
  const growth = allyGrowth(n);
  const budget = enemyBudget(n);
  const v = Math.min(n, VOLUME_CAP_STAGE);

  // 🔴 스폰은 유한하다. 무한 반복으로 두면 느린 플레이어일수록 적이 누적돼
  //    "못하면 더 불리해지는" 죽음의 나선이 생긴다(저성취 하드월의 구조적 원인).
  const active = WAVES.filter(([, from, to]) => n >= from && n <= to);
  const shareSum = active.reduce((s, w) => s + w[6], 0) || 1;
  const mobBudget = budget * (boss ? BOSS_MOB_SHARE : 1);

  const spawns: SpawnEntry[] = [];
  for (const [id, , , t0, everyBase, everyMin, share] of active) {
    const hp = effectiveHp(id);
    spawns.push({
      id,
      t0,
      every: Math.max(everyMin, everyBase - (v * (everyBase - everyMin)) / VOLUME_CAP_STAGE),
      cap: Math.max(1, Math.min(PER_WAVE_CAP, Math.round((mobBudget * (share / shareSum)) / hp))),
    });
  }
  if (boss) {
    const id = BOSSES[(chapter - 1) % BOSSES.length]!;
    const base = ENEMY_BY_ID.get(id)?.hp ?? 4000;
    // 수문장 체력을 예산에 묶는다 — 안 그러면 구역마다 보스 기본 체력 차이가 배율과 겹쳐 폭발한다
    spawns.push({ id, t0: 35, every: 9999, cap: 1, hpMul: (budget * BOSS_SHARE) / base });
  }

  return {
    index: n,
    chapter,
    pos,
    name: `${chapter}-${pos} ${POS_NAMES[pos - 1] ?? ""}`,
    chapterName: chapterName(chapter),
    bg: stageBackground(n),
    mult,
    // 보스 판은 수문장 자체가 관문이라 성 체력을 낮춘다
    castleHp: Math.round(CASTLE_K * growth * lengthRamp(n) * (boss ? 0.7 : 1)),
    playerCastleHp: Math.round(3400 * growth),
    spawns,
    quizTypes: quizTypesFor(n),
    boss,
    endless: n > CAMPAIGN_STAGES,
  };
}

/** 지도에 그릴 구역 하나(10판) */
export function chapterStages(chapter: number): StageDef[] {
  const first = (chapter - 1) * CHAPTER_LEN + 1;
  return Array.from({ length: CHAPTER_LEN }, (_, i) => stageDef(first + i));
}
