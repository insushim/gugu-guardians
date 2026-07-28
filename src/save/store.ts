import { migrate, SAVE_KEY, SAVE_VERSION, defaultSave, type SaveData } from './schema';

/**
 * 저장소 — 로그인 없이 **기기 로컬에만** 저장한다.
 * 서버로 아무것도 보내지 않으므로 학생 개인정보 수집이 없다.
 * (⚠️ "개인정보 수집 0"이라는 표현은 쓰지 않는다 — 호스팅 플랫폼의 기본 접속 로그는 존재한다.
 *   우리가 수집·저장하는 식별정보가 없다는 뜻이다.)
 */

let cache: SaveData | null = null;

function storage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    // 프라이빗 모드 등에서 접근만 되고 쓰기가 막히는 경우를 걸러낸다
    const probe = '__gugu_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function load(): SaveData {
  if (cache) return cache;
  const s = storage();
  if (!s) { cache = defaultSave(); return cache; }
  const raw = s.getItem(SAVE_KEY);
  if (!raw) { cache = defaultSave(); return cache; }
  let parsed: unknown = null;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  cache = migrate(parsed);
  return cache;
}

export function save(data: SaveData): void {
  cache = data;
  const s = storage();
  if (!s) return;
  try {
    s.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, data }));
  } catch {
    /* 용량 초과 등 — 진행은 계속된다(저장만 실패) */
  }
}

export function update(fn: (d: SaveData) => void): SaveData {
  const d = load();
  fn(d);
  save(d);
  return d;
}

export function reset(): SaveData {
  const d = defaultSave();
  save(d);
  return d;
}
