/**
 * 셈력(자원) · 콤보 · DDA — 순수 로직. DOM 의존 0.
 * 수치는 tools/probe-model.mjs 와 1:1 (tests/parity.spec.ts 가 대조).
 */
import { BUDGET_SLOPE, CAMPAIGN_STAGES } from './stages';
import { ALLIES } from './units';

/** 정답 1회 기본 보상(1판 기준) */
export const REWARD = 46;
/**
 * 보상이 물량 곡선보다 얼마나 가파르게 오르는가.
 * 🔴 1.0 이면 적 체력 증가만 상쇄한다. 실제로는 아군이 죽어 나가는 소모분이 더 있어서
 *    1.0으로는 부족하다 — 스윕 실측에서 1.0은 ST26·28·30이 무너졌고 1.3부터 전 구간 통과했다.
 *    여유를 두어 1.6을 쓴다. `BUDGET_SLOPE`(stages.ts)와 반드시 함께 조정할 것.
 */
export const REWARD_SLOPE_RATIO = 1.6;

/** 해당 판에서의 정답 1회 기본 보상 — 후반 문항이 더 어려우니 더 많이 준다 */
export function rewardBase(stage: number): number {
  return REWARD * (1 + (Math.min(stage, CAMPAIGN_STAGES) - 1) * BUDGET_SLOPE * REWARD_SLOPE_RATIO);
}
/** 시작 소지금 — 초반 연속 오답이 회복 불가 나선이 되지 않게 하는 완충 */
export const START_MONEY = 200;
/** 콤보로 인정하지 않는 최소 응답 시간(ms) — **연타 방지용**.
 *  🔴 유창성(빠르고 정확하게)을 기르는 게임에서 "빨리 답했다"를 벌하면 목표와 정면으로 어긋난다.
 *  문제를 읽고 누르는 최소 시간보다도 짧은 구간(진짜 연타)만 걸러낸다. */
export const MIN_ANSWER_MS = 250;

/** 자동 충전 바닥선: ST1 5.8/s → ST9+ 7.4/s
 *  🔴 바닥선을 스테이지와 함께 크게 키우면 후반에도 '찍기'가 통한다(실측). 성장은 학습 보상 쪽에만. */
export function baseRegen(stage: number): number {
  return 5.8 + Math.min(1.6, (Math.min(stage, 10) - 1) * 0.2);
}

/** 직전 연속 정답 수 기준 배율 */
export function comboMul(combo: number): number {
  if (combo >= 8) return 1.6;
  if (combo >= 5) return 1.4;
  if (combo >= 3) return 1.2;
  return 1.0;
}

// ── DDA (적응형 난이도) ────────────────────────────────────────────────────
/** 연속 오답 2회마다 1단계 하향, 최대 3단계 */
export const DDA_WRONG_TRIGGER = 2;
export const DDA_RIGHT_RECOVER = 3;
export const DDA_MAX = 3;
/** 1단계당 출제 난이도 하향폭(Elo 점) */
export const DDA_STEP_ELO = 70;
/** 1단계당 보상 감소 — 쉬운 문제로 자원을 파밍하는 경로를 막는다 */
export const DDA_REWARD_PENALTY = 0.3;

export interface DdaState {
  level: number;
  wrongStreak: number;
  rightStreak: number;
}

export function newDda(): DdaState {
  return { level: 0, wrongStreak: 0, rightStreak: 0 };
}

/** 정오답 1건을 반영해 새 DDA 상태를 돌려준다(순수 함수) */
export function stepDda(s: DdaState, correct: boolean): DdaState {
  if (correct) {
    const rightStreak = s.rightStreak + 1;
    if (rightStreak >= DDA_RIGHT_RECOVER && s.level > 0) {
      return { level: s.level - 1, wrongStreak: 0, rightStreak: 0 };
    }
    return { level: s.level, wrongStreak: 0, rightStreak };
  }
  const wrongStreak = s.wrongStreak + 1;
  if (wrongStreak >= DDA_WRONG_TRIGGER && s.level < DDA_MAX) {
    return { level: s.level + 1, wrongStreak: 0, rightStreak: 0 };
  }
  return { level: s.level, wrongStreak, rightStreak: 0 };
}

/** 정답 보상 = 판 기본값 × 콤보배율 × (1 − DDA 단계 × 0.3) */
export function rewardFor(combo: number, ddaLevel: number, stage = 1): number {
  const mul = Math.max(0, 1 - ddaLevel * DDA_REWARD_PENALTY);
  return rewardBase(stage) * comboMul(combo) * mul;
}

// ── 셈력 그릇(상한) ────────────────────────────────────────────────────────
/**
 * 셈력에는 상한이 있다. 상한이 없으면 **답을 쌓아 두고 한 번에 쏟는 전략**이 최적이 되어,
 * "지금 풀어서 지금 내보낸다"는 이 게임의 리듬이 사라진다.
 * (자원 상한으로 방출 리듬을 만드는 건 라인 디펜스·실시간 카드 게임의 오랜 관행이다.
 *  장르 선행작 조사는 docs/RESEARCH.md §1·부록 A 참조 — 여기엔 우리 설계 이유만 적는다.)
 * 대신 상한 자체를 먹물로 키우게 해서, 학습으로 번 재화가 전투 용량으로 이어지게 한다.
 *
 * 🔴 기본 상한을 **손으로 적지 않고 로스터에서 유도한다.** 상한이 가장 비싼 셈지기보다
 *    작으면 그 유닛은 뽑아도 **영영 소환할 수 없다** — 아이 입장에서는 최고 보상이
 *    고장난 것으로 보인다. 실제로 600 으로 적었다가 전설 3종(900·780·700)이 전부
 *    소환 불가가 됐다(프로브에서 무한 도달 한계가 ST60→ST50 으로 떨어져 드러났다).
 *    여유분은 프로브의 '예비금 규칙'과 같은 값(최저가 2기분)을 쓴다 — 가장 비싼 유닛을
 *    내고도 전선이 비지 않을 만큼은 남아야 하기 때문이다.
 */
const PRICIEST_ALLY = Math.max(...ALLIES.map((u) => u.cost));
const CHEAPEST_ALLY = Math.min(...ALLIES.map((u) => u.cost));
export const MANA_CAP_BASE = Math.max(600, PRICIEST_ALLY + CHEAPEST_ALLY * 2);
export const MANA_CAP_STEP = 180;
export const MANA_CAP_MAX_LV = 6;

/** 그릇 단계(0~6) → 셈력 상한 */
export function manaCap(level: number): number {
  const lv = Math.max(0, Math.min(MANA_CAP_MAX_LV, Math.floor(level)));
  return MANA_CAP_BASE + lv * MANA_CAP_STEP;
}

/**
 * 다음 단계 강화 비용(먹물).
 *
 * 🔴 처음엔 8단계·220×1.55^lv 였는데, 그러면 **마지막 두 단계 값이 캠페인 30판을
 *    전부 3별로 깬 총수입(4,932)보다 비쌌다**(3,050 + 4,730). 목표가 아니라 장식이 된다.
 *    게다가 먹물은 소환과 같은 지갑이라 실제 여유는 그보다도 적다.
 *    실측 재계산 후 6단계·200×1.45^lv 로 완만하게 바꿨다 —
 *    1별만 받는 아이도 4단계, 3별 아이는 캠페인 끝에 6단계를 다 채운다.
 */
export function manaCapCost(level: number): number {
  const lv = Math.max(0, Math.floor(level));
  return lv >= MANA_CAP_MAX_LV ? Infinity : Math.round(200 * Math.pow(1.45, lv) / 10) * 10;
}

// ── 신바람(아군 가속) ────────────────────────────────────────────────────
/**
 * 문제를 맞히면 **내 군대가 빨라진다** — 더 빨리 걷고 더 빨리 때린다.
 * 손을 놓으면 서서히 원래 속도로 돌아온다.
 *
 * 🔴 처음엔 이걸 '화면 배속'(세상의 시계를 빠르게)으로 만들었다가 되돌렸다.
 *    시간을 압축하면 **아이가 같은 판에서 푸는 문제 수가 그만큼 준다.**
 *    실측: 배속 2.5배에서 ST5 문항이 23→19개로 떨어져 학습량 하한(G5, 20문항)이 깨졌고,
 *    자원 공급도 같이 줄어 ST27에 하드월이 생겼다(G2 승률 71%). 감쇠를 키워 막으려 했더니
 *    이번엔 정답 직후 한 프레임만 반짝이고 마는 장식이 됐다 — 두 방향 다 막힌 설계였다.
 *    대상을 세상에서 **내 군대**로 바꾸면 그 상충이 사라진다: 세상의 시계는 그대로라
 *    문제 수와 자원 공급이 보존되고, 그러면서 판은 실제로 더 빨리 끝난다(더 빨리 이기니까).
 *    게임의 한 줄 컨셉("계산이 빨라질수록 내 군대가 강해진다")과도 정확히 같은 말이 된다.
 */
export const HASTE_MAX = 1.8;
/** 정답 1회가 주는 가속 증가분 */
export const HASTE_PER_CORRECT = 0.22;
/** 시뮬 1초당 풀리는 양 */
export const HASTE_DECAY = 0.08;

/** 가속 부스트 값(0~) → 실제 배율 */
export function hasteOf(boost: number): number {
  return 1 + Math.max(0, Math.min(HASTE_MAX - 1, boost));
}

/**
 * 가속을 아이가 읽을 수 있는 말로 바꾼다.
 * 🔴 "×1.8" 처럼 소수로 표시하면 안 된다 — **소수는 3학년 2학기 내용**이라
 *    주 사용자인 2학년은 읽지 못한다. 숫자 대신 단계와 화살표로 보여 준다.
 * @returns 표시할 문자열. 평소 속도면 빈 문자열
 */
export function hasteLabel(haste: number): string {
  if (haste >= 1.6) return '⚡⚡⚡ 신바람';
  if (haste >= 1.35) return '⚡⚡ 빨라짐';
  if (haste >= 1.12) return '⚡ 빨라짐';
  return '';
}

// ── 먹 대포 ────────────────────────────────────────────────────────────────
/**
 * 성에 달린 비상용 한 방. 이 장르가 흔히 두는 자리의 장치다 —
 * "밀리고 있을 때 시간을 벌어 주는, 쿨다운 있는 비상 수단".
 *
 * 🔴 단 **시간으로 차지 않고 정답으로 찬다.** 시간 충전으로 두면 손을 놓고 기다리는 게
 *    이득인 순간이 생겨 학습과 재미가 서로 경쟁한다. Prodigy 비판의 핵심이 정확히 그것이었다
 *    ("게임 요소가 수학에서 주의를 빼앗는다"). 이 게임의 모든 쾌감 장치는 **정답의 하류**에 둔다.
 * 🔴 설명 문구로 가르치지 않는다 — 다 차면 버튼이 스스로 빛난다(PvZ 조지 팬: 텍스트 말고 행동으로).
 */
export const CANNON_PER_CORRECT = 0.09;   // 정답 약 12개면 한 발
export const CANNON_KNOCKBACK = 90;       // 뒤로 밀어내는 거리(맵 길이 1000 기준)

/**
 * 그 판에서 대포 한 발이 주는 피해(성장 배율은 호출부에서 곱한다).
 * 🔴 0.12 로 뒀더니 대포만으로 캠페인 로스터가 전설 로스터만큼 멀리 가서
 *    **소환이 무의미**해졌다(게이트 FAIL). 0.05 는 "밀릴 때 숨통을 틔우는" 수준이다.
 */
export function cannonDamage(enemyBudget: number): number {
  return enemyBudget * 0.05;
}
