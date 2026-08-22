import type { AapState } from '../net/aap';

/**
 * 🚪 "알찬으로 들어왔다" 배지.
 *
 * 왜 따로 파일인가: 지금 단계(P1-4a 관찰)에서 **이게 유일한 산출물**이다. 보상도 학습기록도
 * 꺼져 있어서, 다리가 실제로 도는지 확인할 방법이 이 배지 하나뿐이다. 유일한 눈을
 * `main.ts` 안에 묻어 두면 테스트가 안 붙는다.
 *
 * 🔴 `sub` 는 절대 찍지 않는다. 앱별 식별자라 알찬 uid 는 아니지만, 남의 화면·스크린샷·
 *    교실 TV 에 남을 이유가 없다.
 */

/** 배지가 스스로 사라지기까지(ms). 게임 화면을 오래 가리지 않는다. */
export const BADGE_MS = 4000;

/**
 * 상태를 보고 배지를 만든다. 붙이지는 않는다 — 붙이는 건 호출자의 몫이라 테스트가 쉽다.
 *
 * @param st 현재 AAP 상태
 * @param doc 문서(테스트 주입용)
 * @return 붙일 요소. 띄울 게 없으면 null
 */
export function buildAapBadge(st: AapState, doc: Document): HTMLElement | null {
  // 🔴 성공했을 때만 띄운다. 그냥 들어온 경우(`none`)에 아무것도 안 뜨는 건 의도다 —
  //    이 게임은 로그인이 없고, 알찬은 여러 입구 중 하나일 뿐이다.
  if (st.kind !== 'ok') return null;
  const el = doc.createElement('div');
  el.className = 'aap-badge';
  el.setAttribute('role', 'status');
  // 별명은 학생이 **스스로 정한 것**만 알찬이 실어 보낸다(실명은 안 온다 — 규약 §2).
  el.textContent = st.nick ? `알찬 · ${st.nick}` : '알찬으로 연결됨';
  return el;
}

/**
 * 만들어 붙이고, 시간이 지나면 스스로 지운다.
 *
 * @param st 현재 AAP 상태
 * @param doc 문서
 * @return 붙였으면 그 요소
 */
export function showAapBadge(st: AapState, doc: Document = document): HTMLElement | null {
  const el = buildAapBadge(st, doc);
  if (!el) return null;
  doc.body.append(el);
  setTimeout(() => el.remove(), BADGE_MS);
  return el;
}
