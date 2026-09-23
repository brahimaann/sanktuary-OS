import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from './api';

/**
 * Live connection to one board (moodboard canvas or planner): items, who else is here, and a
 * throttled queue that saves changes and forwards them to everyone else on the board.
 */
export interface BoardPeer { user: string; color: string; x?: number; y?: number }

export function useBoard<T extends { id: string }>(boardId: string) {
  const api = useApi();
  const [items, setItems] = useState<Record<string, T>>({});
  const [peers, setPeers] = useState<Record<string, BoardPeer>>({});
  const [status, setStatus] = useState('Connecting...');
  const me = useRef<{ conn: string; color: string; user: string } | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let alive = true;
    const on = (event: string, fn: (d: any) => void) => es!.addEventListener(event, (e) => fn(JSON.parse((e as MessageEvent).data)));
    const connect = async () => {
      await api('/api/me').catch(() => {}); // refreshes the sk_session cookie EventSource authenticates with
      if (!alive) return;
      es = new EventSource(`/api/boards/${boardId}/live`);
      on('init', (d) => {
        me.current = d.you;
        setItems(Object.fromEntries(d.items.map((i: T) => [i.id, i])));
        setPeers(Object.fromEntries(d.peers.map((p: BoardPeer & { conn: string }) => [p.conn, p])));
        setStatus('');
      });
      on('ops', ({ ops }) => setItems((prev) => {
        const next = { ...prev };
        for (const op of ops) op.put ? (next[op.put.id] = op.put) : delete next[op.del];
        return next;
      }));
      on('join', (p) => setPeers((prev) => ({ ...prev, [p.conn]: p })));
      on('leave', ({ conn }) => setPeers((prev) => { const n = { ...prev }; delete n[conn]; return n; }));
      on('cursor', (c) => setPeers((prev) => ({ ...prev, [c.conn]: { ...prev[c.conn], ...c } })));
      on('deleted', () => { setStatus('This board was deleted.'); es?.close(); alive = false; });
      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED && alive) {
          setStatus('Reconnecting...');
          retry = setTimeout(connect, 3000);
        }
      };
    };
    connect();
    return () => { alive = false; clearTimeout(retry); es?.close(); };
  }, [boardId, api]);

  const pending = useRef<Record<string, T | null>>({});
  const pendingCursor = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    timer.current = null;
    const ops = Object.entries(pending.current).map(([id, it]) => (it ? { put: it } : { del: id }));
    const cursor = pendingCursor.current;
    pending.current = {};
    pendingCursor.current = null;
    if (!me.current || (!ops.length && !cursor)) return;
    fetch(`/api/boards/${boardId}/ops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conn: me.current.conn, ops, cursor }),
    }).then((r) => !r.ok && setStatus(`Not saved: ${r.status}`), () => setStatus('Not saved: offline'));
  }, [boardId]);

  /** Apply changes locally now; send them within 60 ms (or right away). null deletes an item. */
  const queue = useCallback((changes: Record<string, T | null>, immediate = false) => {
    setItems((prev) => {
      const next = { ...prev };
      for (const [id, it] of Object.entries(changes)) it ? (next[id] = it) : delete next[id];
      return next;
    });
    Object.assign(pending.current, changes);
    if (immediate) flush();
    else timer.current ??= setTimeout(flush, 60);
  }, [flush]);

  const sendCursor = useCallback((pos: { x: number; y: number }) => {
    pendingCursor.current = pos;
    timer.current ??= setTimeout(flush, 100);
  }, [flush]);

  return { items, peers, status, setStatus, me, queue, flush, sendCursor };
}
