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
    // 🔴 음악은 언락 전에 요청됐을 수 있다(메뉴 진입 시점 = 아직 사용자 제스처 없음).
    //    언락되는 순간 원하던 곡을 다시 건다.
    if (wantTrack) playBgm(wantTrack);
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

/**
 * 재생 옵션.
 * 🔴 **음정을 바꾸는 것만으로 소리가 6종에서 사실상 수십 종이 된다.** 새 오디오 파일을
 *    구하지 않고 콤보 상승감·보스 등장·패배를 표현하려고 둔다(진단: 콤보 시청각 상승감 없음, 영향 6/10).
 *    마리오의 연속 코인이 같은 원리다 — 같은 소리를 점점 높게.
 */
export interface PlayOpts {
  /** 재생 속도 = 음정. 1 이 원음. 높을수록 높은 소리 */
  rate?: number;
  /** 음량 배율(0~1). 원래 볼륨에 곱한다 */
  gain?: number;
  /** 연타 방지 간격을 무시한다 — 콤보처럼 **연속으로 들려야 의미가 있는** 소리에 쓴다 */
  force?: boolean;
}

export function play(name: Sfx, opts: PlayOpts = {}): void {
  if (!ctx || !store.load().settings.sound) return;
  const gap = MIN_GAP_MS[name];
  if (gap && !opts.force) {
    const now = performance.now();
    if (now - (lastPlayed.get(name) ?? -1e9) < gap) return;
    lastPlayed.set(name, now);
  }
  const buf = buffers.get(name);
  if (!buf) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // 0.5~2.0 밖으로 나가면 소리가 아니라 잡음이 된다
    if (opts.rate) src.playbackRate.value = Math.max(0.5, Math.min(2, opts.rate));
    const g = ctx.createGain();
    g.gain.value = VOLUME[name] * (opts.gain ?? 1);
    src.connect(g).connect(ctx.destination);
    src.start();
  } catch {
    /* 재생 실패는 무시 */
  }
}

/**
 * 콤보에 따라 올라가는 정답음. 반음씩 올라가다 한 옥타브에서 멈춘다.
 * 🔴 멈추는 게 중요하다 — 계속 올리면 20연속에서 삑 소리가 된다.
 */
export function playCorrect(combo: number): void {
  const step = Math.min(12, Math.max(0, combo - 1));   // 반음 단위, 최대 한 옥타브
  play('correct', { rate: Math.pow(2, step / 12), force: true });
}

/** 패배 — `wrong` 을 낮고 길게. 전용 파일 없이 '아쉬움'을 만든다 */
export function playLose(): void {
  play('wrong', { rate: 0.62, gain: 0.9, force: true });
}

/** 수문장 등장 — `summon` 을 아주 낮게. 큰 것이 왔다는 신호 */
export function playBossAppear(): void {
  play('summon', { rate: 0.55, gain: 1, force: true });
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

// ── 배경음악 ──────────────────────────────────────────────────────────────
/**
 * BGM — CC0(OpenGameArt) 루프 트랙.
 *
 * 🔴 **효과음과 따로 끈다.** 교실에서 30명이 동시에 하면 음악이 먼저 문제가 된다.
 *    소리를 통째로 끄게 만들면 정답/오답 피드백까지 사라져 학습 신호가 죽는다.
 * 🔴 **지연 로드**한다. 곡 하나가 300KB대라 첫 화면 로딩에 물리면 시작이 느려진다.
 *    필요한 씬에 들어갈 때 받아 오고, 받는 동안 게임은 그대로 돌아간다.
 * 🔴 파일에 페이드를 굽지 않았다(루프마다 소리가 꺼졌다 켜진다). 전환 페이드는 여기서 한다.
 */
export type Bgm = 'field' | 'battle' | 'boss';

const BGM_FILES: Record<Bgm, string> = {
  field: 'audio/bgm/field.ogg',
  battle: 'audio/bgm/battle.ogg',
  boss: 'audio/bgm/boss.ogg',
};

/** 효과음(정답·오답)이 묻히지 않도록 음악은 확실히 낮게 깐다 */
const BGM_VOLUME = 0.22;
const FADE_SEC = 0.9;

const bgmBuffers = new Map<Bgm, AudioBuffer>();
const bgmLoading = new Map<Bgm, Promise<AudioBuffer | null>>();
let bgmNode: { src: AudioBufferSourceNode; gain: GainNode; track: Bgm } | null = null;
let wantTrack: Bgm | null = null;

function loadBgm(track: Bgm): Promise<AudioBuffer | null> {
  const cached = bgmBuffers.get(track);
  if (cached) return Promise.resolve(cached);
  const inflight = bgmLoading.get(track);
  if (inflight) return inflight;

  const job = (async (): Promise<AudioBuffer | null> => {
    if (!ctx) return null;
    try {
      const p = BGM_FILES[track];
      const res = await fetch(p.startsWith('data:') ? p : `${base()}${p}`);
      if (!res.ok) return null;
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      bgmBuffers.set(track, buf);
      return buf;
    } catch {
      return null;   // 음악이 없어도 게임은 완전히 플레이 가능해야 한다
    } finally {
      bgmLoading.delete(track);
    }
  })();
  bgmLoading.set(track, job);
  return job;
}

function fadeOutAndStop(node: { src: AudioBufferSourceNode; gain: GainNode }): void {
  if (!ctx) return;
  const t = ctx.currentTime;
  try {
    node.gain.gain.cancelScheduledValues(t);
    node.gain.gain.setValueAtTime(node.gain.gain.value, t);
    node.gain.gain.linearRampToValueAtTime(0, t + FADE_SEC);
    node.src.stop(t + FADE_SEC + 0.05);
  } catch {
    try { node.src.stop(); } catch { /* 이미 멈춤 */ }
  }
}

/**
 * 씬에 맞는 음악으로 바꾼다. 같은 곡이면 아무 일도 하지 않는다(화면 전환마다 끊기면 안 된다).
 * `null`이면 음악을 끈다.
 */
export function playBgm(track: Bgm | null): void {
  wantTrack = track;
  if (!ctx) return;
  if (!store.load().settings.music || track === null) {
    if (bgmNode) { fadeOutAndStop(bgmNode); bgmNode = null; }
    return;
  }
  if (bgmNode?.track === track) return;

  void loadBgm(track).then((buf) => {
    // 로드가 끝났을 때 이미 다른 씬으로 갔거나 음악을 껐으면 재생하지 않는다
    if (!ctx || !buf || wantTrack !== track || !store.load().settings.music) return;
    if (bgmNode?.track === track) return;
    if (bgmNode) { fadeOutAndStop(bgmNode); bgmNode = null; }
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(BGM_VOLUME, t + FADE_SEC);
      src.connect(gain).connect(ctx.destination);
      src.start();
      bgmNode = { src, gain, track };
    } catch {
      /* 재생 실패는 무시 */
    }
  });
}

/** 설정에서 음악을 껐다 켤 때 — 현재 씬의 곡을 다시 반영한다 */
export function syncBgmSetting(): void {
  const want = wantTrack;
  if (!store.load().settings.music) {
    if (bgmNode) { fadeOutAndStop(bgmNode); bgmNode = null; }
    return;
  }
  if (want && !bgmNode) playBgm(want);
}
