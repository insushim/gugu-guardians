import type { AapState } from '../net/aap';

/**
 * 🚪 알찬 연결 상태를 **사람이 읽을 문장**으로.
 *
 * 왜 필요한가: 배지는 4초 뒤 사라진다. 지금은 관찰 단계라 "다리가 실제로 돌았나"를 확인하는
 * 게 목적인데, 그 확인이 **4초짜리 배지를 놓쳤느냐**에 달려 있으면 확인 수단이 아니다
 * (2026-08-22 Gemini 레인). 선생님이 언제든 열어 볼 수 있는 자리를 하나 둔다.
 *
 * 🔴 `sub` 는 여기서도 안 찍는다. 설정 화면은 교실 TV 에 띄워 놓고 설명하는 자리다.
 */

export interface AapStatusLine { title: string; detail: string }

/**
 * @param st 현재 상태
 * @return 설정 화면에 넣을 제목·설명
 */
export function aapStatusLine(st: AapState): AapStatusLine {
  if (st.kind === 'ok') {
    return {
      title: st.nick ? `연결됨 · ${st.nick}` : '연결됨',
      detail: '알찬을 거쳐 들어왔어요. 앞으로 여기서 한 공부가 알찬에 기록돼요.',
    };
  }
  if (st.kind === 'failed') {
    // 🔴 사유(`signature`·`exp` 등)를 화면에 쓰지 않는다. 아이가 읽을 말이 아니고,
    //    선생님에게도 "다시 열어 보라"가 유일하게 할 수 있는 일이라 사유가 소용없다.
    //    개발자가 필요하면 콘솔에 남아 있다.
    return {
      title: '연결하지 못했어요',
      detail: '알찬에서 다시 열어 주세요. 그래도 안 되면 선생님께 말씀드려 주세요.',
    };
  }
  return {
    title: '연결 안 함',
    detail: '알찬을 거치지 않고 들어왔어요. 게임은 전부 그대로 할 수 있어요.',
  };
}
