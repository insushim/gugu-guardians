/** 최소 DOM 헬퍼 — 프레임워크 없이 가볍게 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const c of children) n.append(c);
  return n;
}

export function btn(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = el('button', { class: cls, type: 'button' }, label);
  b.addEventListener('click', onClick);
  return b;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** 화면 전환 — 이전 화면의 정리 함수를 반드시 호출한다
 *  (오버레이/타이머를 정리하지 않으면 다음 화면으로 샌다) */
export type Teardown = () => void;

let currentTeardown: Teardown | null = null;

export function mount(root: HTMLElement, build: () => { node: HTMLElement; teardown?: Teardown }): void {
  if (currentTeardown) { currentTeardown(); currentTeardown = null; }
  clear(root);
  const { node, teardown } = build();
  node.classList.add('on');
  root.append(node);
  currentTeardown = teardown ?? null;
  // 새 화면의 첫 조작 가능한 요소로 포커스를 옮긴다(키보드 접근성)
  const first = node.querySelector<HTMLElement>('button, [tabindex]');
  first?.focus({ preventScroll: true });
}

export function stars(n: number): string {
  return '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n);
}
