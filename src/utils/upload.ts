// Uploads files into a team space from anywhere in the app (Tracks drops, the New... window, Share to Sanktuary),
// the same way Team Files does: 32 MB chunks (Cloudflare caps a request at 100 MB), a few at once, each chunk
// retried on a dropped connection. The server never overwrites: a clashing name becomes "name (2).ext".
// Phones send 8 MB chunks, so a connection dropped on mobile data resends 8 MB, not 32.
const CHUNK = (matchMedia('(pointer: coarse)').matches ? 8 : 32) * 1024 * 1024;
const PARALLEL = 3;

// A phone stops uploading when its screen locks, so keep the screen on while anything is uploading
let busy = 0;
let lock: { release(): Promise<void> } | null = null;
const holdScreen = async () => {
  try {
    if (!lock && document.visibilityState === 'visible')
      lock =
        (await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<typeof lock> } }).wakeLock?.request('screen')) ??
        null;
  } catch {
    // not supported, or refused (low battery): the upload still waits out a lock below
  }
};
document.addEventListener('visibilitychange', () => {
  if (busy && document.visibilityState === 'visible') {
    lock = null; // the browser drops the lock when the page is hidden
    void holdScreen();
  }
});

/** Resolves once the page is on screen and online again (a locked phone or a dead signal pauses the upload). */
const backOnline = () =>
  new Promise<void>((resolve) => {
    const check = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      document.removeEventListener('visibilitychange', check);
      removeEventListener('online', check);
      resolve();
    };
    document.addEventListener('visibilitychange', check);
    addEventListener('online', check);
    check();
  });

async function pool<T>(items: T[], n: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    }),
  );
}

const sendChunk = (target: string, token: string, body: Blob, onProgress: (loaded: number) => void) =>
  new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', target);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (ev) => onProgress(ev.loaded);
    xhr.onload = () =>
      xhr.status < 300
        ? resolve(xhr.responseText)
        : reject(Object.assign(new Error(xhr.responseText || `HTTP ${xhr.status}`), { status: xhr.status }));
    xhr.onerror = () => reject(Object.assign(new Error('Network error'), { status: 0 }));
    xhr.send(body);
  });

export interface UploadItem {
  file: File | Blob;
  name: string;
  sub?: string[]; // subfolders under the destination (a dropped folder keeps its layout)
  replace?: boolean; // write over the file at this exact name (the old one is kept as a version) instead of saving beside it
  query?: string; // more of the upload URL, e.g. a project check-in's stage=...&project=...
}

/**
 * Uploads items into space/dir. onProgress gets (bytes sent, total bytes, files finished). Throws the server's message on refusal.
 * Returns the name each file was saved under, in order (the server renames a clash to "name (2).ext").
 */
export async function uploadFiles(
  getToken: () => Promise<string | null>,
  space: string,
  dir: string[],
  items: UploadItem[],
  onProgress?: (sent: number, total: number, filesDone: number) => void,
) {
  const total = items.reduce((n, u) => n + u.file.size, 0) || 1;
  const sent = new Map<string, number>();
  const saved = items.map((u) => u.name);
  let filesDone = 0;
  const report = () =>
    onProgress?.(
      [...sent.values()].reduce((a, b) => a + b, 0),
      total,
      filesDone,
    );
  busy++;
  void holdScreen();
  try {
    await pool([...items.keys()], PARALLEL, async (i) => {
      const { file, name, sub = [], replace, query } = items[i];
      const id = crypto.randomUUID();
      const chunks = Math.max(1, Math.ceil(file.size / CHUNK));
      const at = `/api/files/${space}/${[...dir, ...sub, name].map(encodeURIComponent).join('/')}`;
      const base = `${at}?upload=${id}&chunks=${chunks}&size=${file.size}&chunkSize=${CHUNK}${replace ? '&replace=1' : ''}${query ? '&' + query : ''}`;
      let finished = false;
      await pool([...Array(chunks).keys()], PARALLEL, async (c) => {
        for (let attempt = 0; ; attempt++) {
          try {
            const reply = await sendChunk(`${base}&chunk=${c}`, (await getToken()) || '', file.slice(c * CHUNK, (c + 1) * CHUNK), (n) => {
              sent.set(`${id}:${c}`, n);
              report();
            });
            const done = /^{/.test(reply) && JSON.parse(reply).name; // only the chunk that completes the file names it
            if (done) [saved[i], finished] = [done, true];
            return;
          } catch (err) {
            const status = (err as { status?: number }).status ?? 0;
            sent.set(`${id}:${c}`, 0);
            // Dropped while the screen was locked or the signal was gone: wait for it to come back, without using up a retry
            if (status === 0 && (document.visibilityState !== 'visible' || !navigator.onLine)) {
              await backOnline();
              attempt--;
              continue;
            }
            if (attempt >= 4 || (status !== 0 && status !== 429 && status < 500)) throw err;
            await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          }
        }
      });
      if (!finished) throw new Error(`${name} didn't finish saving on the server. Try it again.`);
      filesDone++;
      report();
    });
  } finally {
    if (!--busy) void lock?.release().catch(() => {});
    if (!busy) lock = null;
  }
  return saved;
}

/** Everything dropped (files and whole folders, with their subfolders), as upload items. */
export async function droppedItems(dt: DataTransfer): Promise<UploadItem[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return [...dt.files].map((file) => ({ file, name: file.name }));
  const out: UploadItem[] = [];
  const walk = async (e: FileSystemEntry, sub: string[]): Promise<void> => {
    if (e.isFile) {
      const file = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      out.push({ file, name: file.name, sub });
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child, [...sub, e.name]);
      }
    }
  };
  for (const e of entries) await walk(e, []);
  return out.filter((u) => !/^(\.|desktop\.ini$|thumbs\.db$)/i.test(u.name));
}
