import type { SaveData } from '../save/schema';
import { nickIndex } from '../save/schema';
import { weekKeyUTC, type Submission } from '../../shared/board-contract';

/**
 * 주간 순위용 집계 버킷 — **순수 로직만**. 네트워크는 `src/net/board.ts` 에 있다.
 *
 * 🔴 여기서 쓰는 주 라벨은 **UTC 기준**(shared/board-contract.ts `weekKeyUTC`)이다.
 *    로컬 날짜로 나누면 KST 월요일 새벽에 클라이언트는 새 주, 서버는 아직 지난 주가 되어
 *    최대 9시간 동안 화면 라벨과 실제 순위 데이터의 주가 어긋난다.
 *    (SRS·복습 예정일은 여전히 로컬 날짜다 — 그쪽 기준은 아이의 하루다.)
 *
 * 왜 누적 통계(edu.stats)를 쓰지 않고 따로 세는가:
 * 주간 순위는 "이번 주에 얼마나 했나"라 누적값에서 뺄 기준선이 필요한데,
 * 그 기준선을 서버가 들고 있으면 주가 바뀔 때마다 서버-클라 시각차로 어긋난다.
 * 클라이언트가 주간 버킷을 직접 들고 주가 바뀌면 0으로 되돌리는 쪽이 훨씬 단순하고,
 * 틀려도 그 주 한 명의 기록만 어긋난다.
 */

export interface WeeklyDelta {
  /** 이번 판에서 맞힌 문항 수 */
  correct: number;
  /** 이번 판 플레이 시간(ms) */
  playMs: number;
  /** 이겼을 때의 판 번호. 졌으면 0 */
  stage: number;
}

/**
 * 한 판이 끝날 때 버킷을 갱신한다. 주가 바뀌었으면 먼저 0으로 되돌린다.
 * 🔴 `d` 를 직접 고친다(store.update 안에서 부르는 용도).
 */
export function bumpWeekly(d: SaveData, delta: WeeklyDelta, week: string): void {
  if (d.board.week !== week) {
    d.board.week = week;
    d.board.correct = 0;
    d.board.stage = 0;
    d.board.playMs = 0;
  }
  d.board.correct += Math.max(0, Math.floor(delta.correct));
  d.board.playMs += Math.max(0, delta.playMs);
  d.board.stage = Math.max(d.board.stage, Math.max(0, Math.floor(delta.stage)));
}

/**
 * 🔴 앱은 이 두 함수만 쓴다. 주 라벨을 인자로 받는 순수 버전은 테스트 전용이다.
 *
 *    왜 이렇게 나눴나: 처음엔 호출부가 주 라벨을 직접 넘겼는데, 전투 종료는 **로컬** 주로,
 *    제출은 **UTC** 주로 찍는 상태가 되었다. 둘이 어긋나는 시간대(KST 월요일 새벽)에는
 *    `submitBody` 가 "이번 주 기록이 아니다"라고 판단해 아이의 한 주치를 통째로 0으로 보낸다.
 *    호출부에서 주를 고를 수 있는 한 이 실수는 언제든 다시 난다 → 고를 수 없게 만들었다.
 */
export function bumpWeeklyNow(d: SaveData, delta: WeeklyDelta): void {
  bumpWeekly(d, delta, weekKeyUTC(Date.now()));
}

export function submitBodyNow(d: SaveData): SubmitBody | null {
  return submitBody(d, weekKeyUTC(Date.now()));
}

/** 서버로 보낼 본문. 🔴 문자열 필드는 기기 토큰 하나뿐이다(별명은 인덱스로 나간다) */
export type SubmitBody = Submission;

/**
 * 제출 본문을 만든다. 주가 어긋났으면(마지막 판이 지난 주였음) 이번 주 값은 0이다 —
 * 지난 주 성적이 이번 주 순위표에 올라가면 안 된다.
 */
export function submitBody(d: SaveData, week: string): SubmitBody | null {
  if (!d.board.consent || !d.board.device) return null;
  const fresh = d.board.week === week;
  const [na, nb] = nickIndex(d.profile.nickname);
  return {
    d: d.board.device,
    na,
    nb,
    c: fresh ? d.board.correct : 0,
    s: fresh ? d.board.stage : 0,
    // 참고값이다 — 서버가 자기 시계로 다시 상한을 씌운다(shared/board-contract.ts applyCaps)
    p: Math.round(fresh ? d.board.playMs : 0),
  };
}
