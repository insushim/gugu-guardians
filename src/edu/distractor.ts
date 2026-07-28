import type { Question } from './generator';
import type { Rng } from './generator';

/**
 * 오답 후보 생성 — **오개념 기반**.
 *
 * 🔴 과거 실측: 오답을 정답 ±1·±2 대칭으로 만들면 정답이 늘 가운데 값이 되어,
 *    계산하지 않고 최대·최소만 버려도 정답률 45%가 나온다(기준선 25%).
 *    → 정답의 **크기 순위**와 **화면 위치**를 모두 균등하게 강제한다.
 */

function misconceptions(qn: Question): number[] {
  const out: number[] = [];
  const m = /^(\d+)\s*([+−×÷])\s*(\d+)$/.exec(qn.prompt);
  if (m) {
    const a = Number(m[1]), op = m[2], b = Number(m[3]);
    switch (op) {
      case '×':
        out.push(a * (b + 1), a * (b - 1), (a + 1) * b, (a - 1) * b, a + b);
        break;
      case '+':
        out.push(a + b - 10, a + b + 10, a - b, a + b - 1, a + b + 1);
        break;
      case '−':
        out.push(b - a, a - b + 10, a - b - 1, a - b + 1, a + b);
        break;
      case '÷':
        out.push(Math.floor(a / b) + 1, Math.floor(a / b) - 1, a - b, b);
        break;
    }
    // 자릿수 반전 (두 자리 답에서 흔한 오개념)
    const s = String(qn.answer);
    if (s.length === 2) out.push(Number(s[1]! + s[0]!));
  }
  return out.filter((v) => Number.isInteger(v) && v >= 0 && v !== qn.answer);
}

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface Choices {
  /** 화면에 보여줄 4개 보기(순서 그대로) */
  options: number[];
  /** 정답의 인덱스 */
  answerIndex: number;
}

/**
 * 4지선다 보기를 만든다.
 * 정답의 크기 순위를 1~4 중 균등하게 뽑고, 그 순위가 되도록 아래/위 후보를 채운다.
 * 마지막에 화면 위치를 섞어 위치 편향도 없앤다.
 */
export function buildChoices(qn: Question, rng: Rng): Choices {
  const pool = [...new Set(misconceptions(qn))];
  const below = pool.filter((v) => v < qn.answer).sort((x, y) => y - x);
  const above = pool.filter((v) => v > qn.answer).sort((x, y) => x - y);

  // 🔴 정답보다 작은 보기는 0 이상이어야 하므로, 정답이 작으면 순위 4(아래 3개)가 물리적으로 불가능하다.
  //    가능한 순위 범위를 먼저 구한 뒤 그 안에서 균등하게 뽑아야 분포가 실제로 균등해진다.
  const maxBelow = Math.min(3, Math.max(0, qn.answer));
  const targetRank = 1 + Math.floor(rng() * (maxBelow + 1)); // 1..(1+maxBelow)
  let needBelow = targetRank - 1;
  let needAbove = 4 - targetRank;

  const chosen: number[] = [];
  const used = new Set<number>([qn.answer]);

  /** src(오개념 후보) → 부족하면 합성. 합성이 불가능하면 채운 개수를 돌려준다(무한 루프 금지). */
  const take = (src: number[], n: number, synth: (i: number) => number): number => {
    let taken = 0;
    for (const v of src) {
      if (taken >= n) break;
      if (used.has(v) || v < 0) continue;
      used.add(v); chosen.push(v); taken++;
    }
    for (let i = 1; taken < n && i <= 60; i++) {
      const v = synth(i);
      if (v < 0 || used.has(v)) continue;
      used.add(v); chosen.push(v); taken++;
    }
    return taken;
  };

  const gotBelow = take(below, needBelow, (i) => qn.answer - i - 2);
  needAbove += needBelow - gotBelow;              // 아래를 못 채웠으면 위에서 보충
  needBelow = gotBelow;
  const gotAbove = take(above, needAbove, (i) => qn.answer + i + 2);
  if (gotBelow + gotAbove < 3) {
    // 극단적으로 후보가 부족한 경우의 최후 보루 — 위쪽으로 계속 밀어 채운다
    let v = qn.answer + 1;
    while (chosen.length < 3 && v < qn.answer + 200) {
      if (!used.has(v)) { used.add(v); chosen.push(v); }
      v++;
    }
  }

  const options = shuffle([qn.answer, ...chosen], rng);
  return { options, answerIndex: options.indexOf(qn.answer) };
}

/** 정답의 크기 순위(1=가장 작음) — 테스트가 분포를 검사한다 */
export function answerRank(c: Choices, answer: number): number {
  return [...c.options].sort((a, b) => a - b).indexOf(answer) + 1;
}
