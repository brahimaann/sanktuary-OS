import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from './api';

/**
 * Live connection to one board (moodboard canvas or planner): items, who else is here, a throttled
 * queue that saves changes and forwards them to everyone else, and undo/redo of your own changes.
 */
type Changes<T> = Record<string, T | null>;
interface BoardPeer {
  user: string;
  color: string;
  x?: number;
  y?: number;
}

export function useBoard<T extends { id: string }>(boardId: string) {
  const api = useApi();
  const [items, setItems] = useState<Record<string, T>>({});
  const [peers, setPeers] = useState<Record<string, BoardPeer>>({});
  const [status, setStatus] = useState('Connecting...');
  const me = useRef<{ conn: string; color: string; user: string } | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

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
      on('ops', ({ ops }) =>
        setItems((prev) => {
          const next = { ...prev };
          for (const op of ops) op.put ? (next[op.put.id] = op.put) : delete next[op.del];
          return next;
        }),
      );
      on('join', (p) => setPeers((prev) => ({ ...prev, [p.conn]: p })));
      on('leave', ({ conn }) =>
        setPeers((prev) => {
          const n = { ...prev };
          delete n[conn];
          return n;
        }),
      );
      on('cursor', (c) => setPeers((prev) => ({ ...prev, [c.conn]: { ...prev[c.conn], ...c } })));
      on('deleted', () => {
        setStatus('This board was deleted.');
        es?.close();
        alive = false;
      });
      es.onerror = () => {
        if (es?.readyState === EventSource.CLOSED && alive) {
          setStatus('Reconnecting...');
          retry = setTimeout(connect, 3000);
        }
      };
    };
    connect();
    return () => {
      alive = false;
      clearTimeout(retry);
      es?.close();
    };
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
    }).then(
      (r) => !r.ok && setStatus(`Not saved: ${r.status}`),
      () => setStatus('Not saved: offline'),
    );
  }, [boardId]);

  const send = useCallback(
    (changes: Changes<T>, immediate: boolean) => {
      setItems((prev) => {
        const next = { ...prev };
        for (const [id, it] of Object.entries(changes)) it ? (next[id] = it) : delete next[id];
        return next;
      });
      Object.assign(pending.current, changes);
      if (immediate) flush();
      else timer.current ??= setTimeout(flush, 60);
    },
    [flush],
  );

  // ── Undo / redo: each entry holds what the touched items looked like before ──
  const undoStack = useRef<Changes<T>[]>([]);
  const redoStack = useRef<Changes<T>[]>([]);
  const lastPush = useRef<{ key: string; at: number } | null>(null);
  const [, setHistoryVersion] = useState(0);
  const snapshot = (ids: string[]): Changes<T> => Object.fromEntries(ids.map((id) => [id, itemsRef.current[id] ?? null]));

  /** Records "before" as one undo step. Quick repeat edits to the same items (typing) merge into one step. */
  const remember = useCallback((before: Changes<T>) => {
    const key = Object.keys(before).sort().join(',');
    const now = Date.now();
    if (!(lastPush.current?.key === key && now - lastPush.current.at < 1000)) undoStack.current.push(before);
    lastPush.current = { key, at: now };
    undoStack.current = undoStack.current.slice(-100);
    redoStack.current = [];
    setHistoryVersion((v) => v + 1);
  }, []);

  /**
   * Apply changes locally now; send them within 60 ms (or right away). null deletes an item.
   * transient: part of a drag, recorded once at the end with remember().
   */
  const queue = useCallback(
    (changes: Changes<T>, immediate = false, transient = false) => {
      if (!transient) remember(snapshot(Object.keys(changes)));
      send(changes, immediate);
    },
    [send, remember],
  );

  const step = (from: typeof undoStack, to: typeof undoStack) => {
    const entry = from.current.pop();
    if (!entry) return;
    to.current.push(snapshot(Object.keys(entry)));
    lastPush.current = null;
    send(entry, true);
    setHistoryVersion((v) => v + 1);
  };
  const undo = useCallback(() => step(undoStack, redoStack), [send]); // eslint-disable-line react-hooks/exhaustive-deps
  const redo = useCallback(() => step(redoStack, undoStack), [send]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendCursor = useCallback(
    (pos: { x: number; y: number }) => {
      pendingCursor.current = pos;
      timer.current ??= setTimeout(flush, 100);
    },
    [flush],
  );

  return {
    items,
    peers,
    status,
    setStatus,
    me,
    queue,
    flush,
    sendCursor,
    undo,
    redo,
    remember,
    snapshot,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  };
}
