/**
 * 효과음 — CC0(Kenney) 실물 파일.
 *
 * 🔴 **첫 사용자 입력에서 AudioContext를 언락하지 않으면 배포 후 무음 버그 1순위**다.
 *    브라우저는 사용자 제스처 전에는 오디오를 재생하지 않는다.
 * 🔴 프로시저럴 합성은 쓰지 않는다 — 같은 노력으로도 "기계음"이 된다(실측).
 */
import * as store from '../save/store';

export type Sfx = 'correct' | 'wrong' | 'tap' | 'summon' | 'hit' | 'win';

const FILES: Record<Sfx, string> = {
  correct: 'audio/sfx/correct.ogg',
  wrong: 'audio/sfx/wrong.ogg',
  tap: 'audio/sfx/tap.ogg',
  summon: 'audio/sfx/summon.ogg',
  hit: 'audio/sfx/hit.ogg',
  win: 'audio/sfx/win.ogg',
};

const VOLUME: Record<Sfx, number> = {
  correct: 0.55, wrong: 0.4, tap: 0.25, summon: 0.4, hit: 0.22, win: 0.6,
};

let ctx: AudioContext | null = null;
const buffers = new Map<Sfx, AudioBuffer>();
let unlocked = false;
/** 같은 소리가 겹쳐 도배되는 것을 막는다(지속딜 타격음이 초당 수십 번 나면 소음이 된다) */
const lastPlayed = new Map<Sfx, number>();
const MIN_GAP_MS: Partial<Record<Sfx, number>> = { hit: 110, summon: 60, tap: 40 };

function base(): string {
  return import.meta.env.BASE_URL || './';
}

/** 첫 사용자 제스처에서 호출된다 */
export function unlock(): void {
  if (unlocked) return;
  unlocked = true;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    void ctx.resume();
    void preload();
  } catch {
    ctx = null;
  }
}

async function preload(): Promise<void> {
  if (!ctx) return;
  await Promise.all(
    (Object.keys(FILES) as Sfx[]).map(async (k) => {
      try {
        // 단일 HTML 배포에서는 FILES 값이 data URI로 치환된다(fetch 가 그대로 처리한다)
        const p = FILES[k];
        const res = await fetch(p.startsWith('data:') ? p : `${base()}${p}`);
        if (!res.ok) return;
        const buf = await ctx!.decodeAudioData(await res.arrayBuffer());
        buffers.set(k, buf);
      } catch {
        /* 소리가 없어도 게임은 완전히 플레이 가능해야 한다(접근성 원칙) */
      }
    }),
  );
}

export function play(name: Sfx): void {
  if (!ctx || !store.load().settings.sound) return;
  const gap = MIN_GAP_MS[name];
  if (gap) {
    const now = performance.now();
    if (now - (lastPlayed.get(name) ?? -1e9) < gap) return;
    lastPlayed.set(name, now);
  }
  const buf = buffers.get(name);
  if (!buf) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = VOLUME[name];
    src.connect(g).connect(ctx.destination);
    src.start();
  } catch {
    /* 재생 실패는 무시 */
  }
}

/** 앱 시작 시 1회 호출 — 첫 포인터/키 입력에서 언락한다 */
export function installUnlockHooks(): void {
  const once = () => {
    unlock();
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
    window.removeEventListener('touchstart', once);
  };
  window.addEventListener('pointerdown', once, { once: false });
  window.addEventListener('keydown', once, { once: false });
  window.addEventListener('touchstart', once, { once: false });
}
