import type { QType } from './curriculum';
import { difficultyOf, exceedsGrade } from './curriculum';
import { fromKey, generateFresh, makeRng, type Question, type Rng } from './generator';
import { initialTheta, pickLevel, updateTheta } from './mastery';
import { dueQueue, newItem, review, type SrsItem } from './srs';
import { recordAnswer, emptyStat, type TypeStat } from './stats';
import { today, type DayStr } from './date';
import type { SaveData } from '../save/schema';

/**
 * 문항 출제 세션 — L1(전투 중, 유창성 0.85) / L2(관문, 도전 0.60) 공용.
 *
 * 🔴 L1에는 **새 개념을 넣지 않는다.** L1은 이미 아는 것을 빠르게 만드는 자리다.
 *    새 유형 도입은 L2(관문)에서만 한다. 이 규칙이 "게임하면서 공부한다"를 성립시킨다.
 */

export type Layer = 'L1' | 'L2';

export interface SessionOpts {
  layer: Layer;
  /** 이 판의 주력 유형 */
  types: QType[];
  save: SaveData;
  seed: number;
  now?: DayStr;
}

export interface SubmitResult {
  correct: boolean;
  /** 정답 노출 여부 (2회 틀리면 알려준다) */
  reveal: boolean;
  answer: number;
  hint: string;
}

const RECENT_MAX = 12;

export class QuizSession {
  readonly layer: Layer;
  readonly types: QType[];
  private save: SaveData;
  private rng: Rng;
  private now: DayStr;
  private recent: string[] = [];
  private attemptsInSession = 0;
  /** 같은 문항에서 틀린 횟수 (2회면 정답 공개) */
  private wrongOnCurrent = 0;
  current: Question | null = null;
  /** 이번 문항이 힌트/재도전으로 오염됐는가 → θ 갱신 제외 */
  private tainted = false;

  constructor(opts: SessionOpts) {
    this.layer = opts.layer;
    this.save = opts.save;
    this.rng = makeRng(opts.seed);
    this.now = opts.now ?? today();
    // 🔴 학년 초과 유형은 아예 출제 대상에서 제외한다
    this.types = opts.types.filter((t) => !exceedsGrade(t, opts.save.profile.gradeMax));
    if (this.types.length === 0) this.types = ['A1'];
  }

  private thetaOf(type: QType): number {
    return this.save.edu.theta[type] ?? initialTheta(type, this.save.edu.theta);
  }

  private statOf(type: QType): TypeStat {
    return this.save.edu.stats[type] ?? emptyStat();
  }

  /** 다음 문항. 복습 기한이 지난 항목이 있으면 그것을 우선 출제한다(오답 봉인 해제). */
  next(ddaLevel = 0): Question {
    const targetP = this.layer === 'L1' ? 0.85 : 0.6;

    // ① SRS 우선 — 단, 이 판의 유형에 속하는 것만(엉뚱한 단원이 튀어나오지 않게)
    const due = dueQueue(Object.values(this.save.edu.srs), 8, this.now)
      .filter((it) => this.types.includes(it.key.split(':')[0] as QType))
      .filter((it) => !this.recent.includes(it.key));
    const pickedDue: SrsItem | undefined = due[0];
    if (pickedDue) {
      const type = pickedDue.key.split(':')[0] as QType;
      const q = fromKey(pickedDue.key, pickLevel(type, this.thetaOf(type), targetP, ddaLevel));
      if (q) { this.setCurrent(q); return q; }
    }

    // ② 주력 유형에서 새로 생성
    const type = this.types[Math.floor(this.rng() * this.types.length)]!;
    const level = pickLevel(type, this.thetaOf(type), targetP, ddaLevel);
    const q = generateFresh(type, level, this.rng, this.recent);
    this.setCurrent(q);
    return q;
  }

  private setCurrent(q: Question): void {
    this.current = q;
    this.wrongOnCurrent = 0;
    this.tainted = false;
    this.recent.push(q.key);
    if (this.recent.length > RECENT_MAX) this.recent.shift();
  }

  /** 힌트를 보면 이 문항은 θ 갱신에서 제외된다 */
  useHint(): string {
    this.tainted = true;
    return this.current ? hintFor(this.current) : '';
  }

  /**
   * 응답 채점. 🔴 prequential: 예측 → 채점 → 갱신 순서는 updateTheta 안에서 강제된다.
   * 오답이면 성 HP를 깎지 않는다(처벌 금지). 2회 틀리면 정답을 알려주고 넘어간다.
   */
  submit(value: number, elapsedMs: number): SubmitResult {
    const q = this.current;
    if (!q) return { correct: false, reveal: false, answer: 0, hint: '' };
    const correct = value === q.answer;

    if (!correct) {
      this.wrongOnCurrent++;
      this.tainted = true;
    }

    const clean = correct ? !this.tainted : !this.tainted;
    const stat = this.statOf(q.type);
    const res = updateTheta({
      theta: this.thetaOf(q.type),
      b: difficultyOf(q.type, q.level),
      attempts: stat.attempts,
      correct,
      clean,
    });
    if (res.updated) this.save.edu.theta[q.type] = res.theta;

    // 통계·SRS는 오염 여부와 무관하게 기록한다(리포트는 '실제로 무엇을 했는가'를 보여줘야 한다)
    this.save.edu.stats[q.type] = recordAnswer(stat, correct, elapsedMs);
    const item = this.save.edu.srs[q.key] ?? newItem(q.key, this.now);
    this.save.edu.srs[q.key] = review(item, correct, this.now);
    this.attemptsInSession++;

    const reveal = !correct && this.wrongOnCurrent >= 2;
    return { correct, reveal, answer: q.answer, hint: hintFor(q) };
  }

  get answered(): number { return this.attemptsInSession; }
}

/** 정답을 말하지 않는 힌트 — "다시 생각해 보자"에 붙는다 */
export function hintFor(q: Question): string {
  const m = /^(\d+)\s*([+−×÷])\s*(\d+)$/.exec(q.prompt);
  if (!m) return '천천히 다시 세어 볼까?';
  const a = Number(m[1]), op = m[2], b = Number(m[3]);
  switch (op) {
    case '+': return a + b >= 10 ? `${a}에서 10을 먼저 채워 볼까?` : '손가락으로 이어 세어 보자.';
    case '−': return a >= 10 ? '10을 먼저 덜어내고 남은 걸 빼 보자.' : '큰 수에서 작은 수만큼 되돌아가 보자.';
    case '×': return `${a}씩 ${b}번 뛰어 세어 보자.`;
    case '÷': return `${b}씩 몇 번 덜어낼 수 있을까?`;
    default: return '천천히 다시 해 보자.';
  }
}
