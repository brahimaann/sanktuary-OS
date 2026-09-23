import { useEffect, useRef, useState } from 'react';

/**
 * One live connection per browser tab (/api/live, server-sent events). Carries presence, chat, typing,
 * profile changes, comments and activity. Authenticated by the sk_session cookie that /api/me sets.
 */
type Handler = (data: any) => void;
const EVENTS = ['hello', 'presence', 'message', 'unmessage', 'typing', 'channel', 'profile', 'comment', 'uncomment', 'activity'];
const handlers = new Map<string, Set<Handler>>();
let source: EventSource | null = null;
let retry: ReturnType<typeof setTimeout> | undefined;
let online: string[] = [];
let me = '';

const dispatch = (event: string, data: any) => handlers.get(event)?.forEach((h) => h(data));

export function startLive() {
  if (source) return;
  source = new EventSource('/api/live');
  for (const event of EVENTS) {
    source.addEventListener(event, (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      if (event === 'hello') { me = data.you; online = data.online; dispatch('presence', data); }
      if (event === 'presence') online = data.online;
      dispatch(event, data);
    });
  }
  source.onerror = () => {
    if (source?.readyState !== EventSource.CLOSED) return; // the browser is already reconnecting
    source = null;
    retry = setTimeout(startLive, 5000);
  };
}

export function stopLive() {
  clearTimeout(retry);
  source?.close();
  source = null;
  online = [];
  me = '';
}

export const liveUser = () => me;

/** Runs handler for every `event` from the live connection while the component is mounted. */
export function useLiveEvent(event: string, handler: Handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const h: Handler = (d) => ref.current(d);
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(h);
    return () => { handlers.get(event)!.delete(h); };
  }, [event]);
}

/** Usernames currently online. */
export function useOnline() {
  const [list, setList] = useState(online);
  useLiveEvent('presence', (d) => setList(d.online));
  return list;
}
