/**
 * 휴대폰 가로 모드 자동 전체화면.
 *
 * 🔴 **방향 전환만으로는 전체화면에 못 들어간다.** `requestFullscreen()` 은 브라우저의
 *    *사용자 활성화*(user activation) 안에서만 허용된다 — `orientationchange` 나 `resize`
 *    핸들러에서 부르면 전부 거부된다(Chrome/Firefox/Safari 공통). 그래서 여기서는
 *    **가로로 돌린 뒤 첫 손가락 터치**를 기다렸다가 그 순간에 요청한다.
 *    아이 입장에서는 "돌리고 화면을 한 번 누르면 꽉 찬다"가 되고, 어차피 게임 시작하려면
 *    버튼을 누르므로 체감상 자동이다.
 *
 * 🔴 **아이폰 사파리에는 이 API 자체가 없다.** iPhone 의 Safari 는 요소 전체화면
 *    (`requestFullscreen`·`webkitRequestFullscreen`)을 아예 구현하지 않는다 — 스크립트로는
 *    어떤 방법으로도 주소창을 없앨 수 없다. 그 기기의 해법은 **홈 화면에 추가**뿐이라
 *    `apple-mobile-web-app-capable` 을 index.html 에 넣어 두었다(추가하면 진짜 전체화면).
 *    여기서는 기능 감지로 조용히 넘어간다 — 되지도 않을 걸 시도해 콘솔을 더럽히지 않는다.
 *    (아이패드 사파리는 `webkitRequestFullscreen` 이 있어 동작한다.)
 *
 * 🔴 **사용자가 직접 나간 전체화면을 다시 붙잡지 않는다.** 뒤로가기 제스처나 ESC 로 나간 건
 *    의사 표시다. 다음 터치에 도로 끌고 들어가면 기기를 빼앗는 느낌이 된다.
 *    다시 무장하는 시점은 **가로로 새로 돌렸을 때** 하나뿐이다.
 */

/** 가로로 눕힌 휴대폰의 세로 크기 상한. 전자칠판·태블릿 거치·데스크톱은 여기서 걸러진다 */
const PHONE_MAX_H = 700;

interface FsElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}
interface FsDocument extends Document {
  webkitFullscreenElement?: Element | null;
}

const docEl = (): FsElement => document.documentElement as FsElement;

/** 요소 전체화면을 지원하는가 — 아이폰 사파리는 여기서 false 다 */
export function fullscreenSupported(): boolean {
  const el = docEl();
  return typeof el.requestFullscreen === 'function'
    || typeof el.webkitRequestFullscreen === 'function';
}

export function isFullscreen(): boolean {
  const d = document as FsDocument;
  return Boolean(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/**
 * 지금 전체화면으로 바꿔도 되는 상황인가.
 * 🔴 손가락 기기 + 가로 + 휴대폰 크기, 셋 다여야 한다. 마우스가 있는 기기에서
 *    페이지가 제멋대로 전체화면이 되면 그건 고장으로 읽힌다.
 */
function shouldAuto(): boolean {
  if (!fullscreenSupported() || isFullscreen()) return false;
  if (!matchMedia('(pointer: coarse)').matches) return false;
  if (window.innerWidth < window.innerHeight) return false;      // 세로면 안내 화면이 뜬다
  return window.innerHeight <= PHONE_MAX_H;
}

/**
 * 전체화면 상태에서만 방향을 잠글 수 있다(명세). 되면 좋고 안 되면 그만 —
 * iOS 는 전 기종 미지원이고 데스크톱도 대개 거부한다.
 */
function lockLandscape(): void {
  const o = screen.orientation as ScreenOrientation & {
    lock?: (v: string) => Promise<void>;
  } | undefined;
  try {
    void o?.lock?.('landscape').catch(() => { /* 지원 안 하면 그대로 둔다 */ });
  } catch { /* 구형 브라우저에서 동기 throw */ }
}

function enter(): void {
  if (!shouldAuto()) return;
  const el = docEl();
  try {
    // navigationUI:'hide' — 안드로이드 크롬에서 주소창까지 확실히 감춘다.
    // webkit 쪽(구형·아이패드)은 인자를 안 받으므로 분기한다.
    const p = typeof el.requestFullscreen === 'function'
      ? el.requestFullscreen({ navigationUI: 'hide' })
      : el.webkitRequestFullscreen?.();
    void Promise.resolve(p).then(lockLandscape).catch(() => { /* 거부돼도 게임은 그대로 */ });
  } catch { /* 활성화 밖 호출 등 — 조용히 넘어간다 */ }
}

let listening = false;
/** 사용자가 스스로 나갔으면 다시 붙잡지 않는다 */
let userExited = false;

function onGesture(): void {
  if (userExited) return;
  enter();
  if (isFullscreen()) stopListening();
}

function startListening(): void {
  if (listening) return;
  listening = true;
  // 🔴 `once: true` 를 쓰면 안 된다 — 세로 상태의 첫 터치로 소진되어, 정작 가로로 돌린
  //    뒤에는 아무 일도 안 일어난다. 성공했을 때만 우리가 직접 떼어 낸다.
  document.addEventListener('pointerup', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
}

function stopListening(): void {
  if (!listening) return;
  listening = false;
  document.removeEventListener('pointerup', onGesture, true);
  document.removeEventListener('keydown', onGesture, true);
}

/** 앱 시작 시 한 번 부른다 */
export function armAutoFullscreen(): void {
  if (!fullscreenSupported()) return;

  startListening();

  // 가로로 새로 돌리면 다시 무장한다 — 여기서만 `userExited` 를 푼다
  const onOrientation = (): void => {
    if (window.innerWidth > window.innerHeight) {
      userExited = false;
      startListening();
    }
  };
  window.addEventListener('orientationchange', onOrientation);
  window.addEventListener('resize', onOrientation);

  const onFsChange = (): void => {
    if (isFullscreen()) { stopListening(); return; }
    // 나갔다 = 사용자가 나간 것이다(우리는 나가지 않는다)
    userExited = true;
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
}
