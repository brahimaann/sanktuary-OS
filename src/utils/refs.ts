import { useWindowManager } from '../wm/manager';
import { fileIcon } from '../apps/fileTypes';

/** A link to something in Sanktuary: a team file or folder, a moodboard, or a plan. */
export interface Ref {
  kind: 'file' | 'folder' | 'board' | 'plan' | 'attachment'; // attachment: a file uploaded straight into a chat
  title: string;
  app?: string; // space id (file/folder)
  dir?: string[]; // parent folders (file/folder)
  name?: string; // file/folder name
  boardId?: string; // board/plan
  url?: string; // attachment
  image?: boolean; // attachment: show it inline
}

export const DRAG_FILE = 'application/x-sk-file'; // dragged out of a team files window
export const DRAG_BOARD = 'application/x-sk-board'; // dragged out of the Moodboards/Planner list

/** Reads a Sanktuary ref from a drop, if there is one. */
export function refFromDrop(dt: DataTransfer): Ref | null {
  const f = dt.getData(DRAG_FILE);
  if (f) {
    const { app, dir, name, isDir } = JSON.parse(f);
    return { kind: isDir ? 'folder' : 'file', title: name, app, dir, name };
  }
  const b = dt.getData(DRAG_BOARD);
  if (b) {
    const { boardId, name, kind } = JSON.parse(b);
    return { kind: kind === 'kanban' ? 'plan' : 'board', title: name, boardId };
  }
  return null;
}

export const refIcon = (r: Ref) =>
  r.kind === 'folder'
    ? '/images/icons/folder-16x16.png'
    : r.kind === 'board'
      ? '/images/icons/paint-16x16.png'
      : r.kind === 'plan'
        ? '/images/icons/task-16x16.png'
        : fileIcon(r.name || r.title || '', false);

/** Opens a ref in the right window. */
export function useOpenRef() {
  const { openWindow } = useWindowManager();
  return (r: Ref) => {
    if (r.kind === 'attachment' && r.url) {
      window.open(r.url, '_blank', 'noopener');
    } else if (r.kind === 'file' && r.app && r.name) {
      openWindow({
        id: `preview-${r.app}-${[...(r.dir || []), r.name].join('/')}`,
        title: r.name,
        icon: fileIcon(r.name, false),
        appType: 'file-preview',
        appProps: { app: r.app, dir: r.dir || [], name: r.name, siblings: [r.name] },
        width: 720,
        height: 520,
      });
    } else if (r.kind === 'folder' && r.app) {
      const path = [...(r.dir || []), ...(r.name ? [r.name] : [])];
      openWindow({
        id: `space-${r.app}-${path.join('/')}`,
        title: r.name || r.title,
        icon: '/images/icons/folder-16x16.png',
        appType: 'team-files',
        appProps: { app: r.app, initialPath: path },
      });
    } else if (r.kind === 'board' && r.boardId) {
      openWindow({
        id: `canvas-${r.boardId}`,
        title: r.title,
        icon: '/images/icons/paint-16x16.png',
        appType: 'canvas',
        appProps: { boardId: r.boardId },
        width: 1000,
        height: 680,
      });
    } else if (r.kind === 'plan' && r.boardId) {
      openWindow({
        id: `planner-${r.boardId}`,
        title: r.title,
        icon: '/images/icons/task-16x16.png',
        appType: 'planner',
        appProps: { boardId: r.boardId },
        width: 1000,
        height: 640,
      });
    }
  };
}
