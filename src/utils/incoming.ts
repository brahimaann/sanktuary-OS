import { useEffect, useRef } from 'react';

// Files shared to Sanktuary from the phone's share menu. The service worker (public/sw.js) keeps them in the
// "sk-share" cache until they've been put somewhere; handOff() passes them to a window that is opening
// (a chat attaches them, a moodboard adds them) once it's ready.
const SHARE_CACHE = 'sk-share';

export interface Shared {
  files: File[];
  text: string;
}

export async function readShared(): Promise<Shared> {
  const out: Shared = { files: [], text: '' };
  if (!('caches' in window) || !(await caches.has(SHARE_CACHE))) return out;
  const cache = await caches.open(SHARE_CACHE);
  for (const req of await cache.keys()) {
    const r = await cache.match(req);
    if (!r) continue;
    if (new URL(req.url).pathname === '/shared/text') out.text = await r.text();
    else {
      const blob = await r.blob();
      out.files.push(new File([blob], decodeURIComponent(r.headers.get('x-name') || 'shared file'), { type: blob.type }));
    }
  }
  return out;
}

export const clearShared = () => ('caches' in window ? caches.delete(SHARE_CACHE) : Promise.resolve(false));

const pending = new Map<string, Shared>();
export function handOff(key: string, shared: Shared) {
  pending.set(key, shared);
  window.dispatchEvent(new CustomEvent('sk:incoming', { detail: key }));
}

/** Takes what was handed to `key` ("chat:<channel>", "canvas:<boardId>") once `ready`. */
export function useIncoming(key: string, ready: boolean, take: (s: Shared) => void) {
  const fn = useRef(take);
  fn.current = take;
  useEffect(() => {
    if (!ready) return;
    const check = () => {
      const s = pending.get(key);
      if (!s) return;
      pending.delete(key);
      fn.current(s);
    };
    check();
    window.addEventListener('sk:incoming', check);
    return () => window.removeEventListener('sk:incoming', check);
  }, [key, ready]);
}
