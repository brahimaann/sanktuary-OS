import fsIndex from './filesystem-index.json';

export interface VFSNode {
  name: string;
  type: 'file' | 'dir';
  content?: string;
  children?: { [name: string]: VFSNode };
  updatedAt: number;
}

const IDB_NAME = 'hq_os_vfs_db';
const STORE_NAME = 'files';

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported'));
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'path' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persistFile(path: string, content: string): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ path, content, updatedAt: Date.now() });
  } catch (_) {}
}

async function deletePersistedFile(path: string): Promise<void> {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(path);
  } catch (_) {}
}

async function loadPersistedFiles(): Promise<{ path: string; content: string }[]> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export class MemoryFileSystem {
  private root: VFSNode;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.root = {
      name: 'root',
      type: 'dir',
      children: {
        'C:': {
          name: 'C:',
          type: 'dir',
          children: {},
          updatedAt: Date.now(),
        },
      },
      updatedAt: Date.now(),
    };
    this.bootstrap();
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notify() {
    this.listeners.forEach((cb) => cb());
  }

  private normalizePath(path: string): string[] {
    let clean = path.replace(/\\/g, '/');
    if (!clean.toUpperCase().startsWith('C:')) {
      clean = 'C:/' + clean.replace(/^\/+/, '');
    }
    return clean.split('/').filter(Boolean);
  }

  private getNode(parts: string[]): VFSNode | null {
    let current: VFSNode = this.root;
    for (const part of parts) {
      // Match case-insensitively or exactly
      const currentChildren = current.children;
      if (!currentChildren) return null;
      
      const matchedKey = Object.keys(currentChildren).find(
        (key) => key.toLowerCase() === part.toLowerCase()
      );
      if (!matchedKey) return null;
      current = currentChildren[matchedKey];
    }
    return current;
  }

  exists(path: string): boolean {
    return this.getNode(this.normalizePath(path)) !== null;
  }

  stat(path: string): { isDirectory: boolean; isFile: boolean } | null {
    const parts = this.normalizePath(path);
    const node = this.getNode(parts);
    if (!node) return null;
    return {
      isDirectory: node.type === 'dir',
      isFile: node.type === 'file',
    };
  }

  readdir(path: string): VFSNode[] {
    const parts = this.normalizePath(path);
    const node = this.getNode(parts);
    if (!node) throw new Error(`Directory not found: ${path}`);
    if (node.type !== 'dir' || !node.children) throw new Error(`Path is not a directory: ${path}`);
    return Object.values(node.children);
  }

  readFile(path: string): string {
    const parts = this.normalizePath(path);
    const node = this.getNode(parts);
    if (!node) throw new Error(`File not found: ${path}`);
    if (node.type !== 'file') throw new Error(`Path is not a file: ${path}`);
    return node.content || '';
  }

  writeFile(path: string, content: string, shouldPersist: boolean = true): void {
    const parts = this.normalizePath(path);
    if (parts.length === 0) return;

    const fileName = parts[parts.length - 1];
    const parentParts = parts.slice(0, -1);
    
    let parent = this.getNode(parentParts);
    if (!parent) {
      this.mkdir(parentParts.join('/'));
      parent = this.getNode(parentParts);
    }

    if (!parent || parent.type !== 'dir' || !parent.children) {
      throw new Error(`Invalid parent directory for file: ${path}`);
    }

    // Check if the file already exists case-insensitively to overwrite it under the same name/casing
    const matchedKey = Object.keys(parent.children).find(
      (key) => key.toLowerCase() === fileName.toLowerCase()
    );
    const actualFileName = matchedKey || fileName;

    parent.children[actualFileName] = {
      name: actualFileName,
      type: 'file',
      content,
      updatedAt: Date.now(),
    };
    if (shouldPersist) {
      persistFile(path, content);
    }
    this.notify();
  }

  mkdir(path: string): void {
    const parts = this.normalizePath(path);
    let current = this.root.children!['C:'];

    for (const part of parts) {
      if (part.toUpperCase() === 'C:') continue;

      if (!current.children) {
        current.children = {};
      }

      // Check if this folder already exists case-insensitively
      const matchedKey = Object.keys(current.children).find(
        (key) => key.toLowerCase() === part.toLowerCase()
      );

      if (matchedKey) {
        current = current.children[matchedKey];
      } else {
        current.children[part] = {
          name: part,
          type: 'dir',
          children: {},
          updatedAt: Date.now(),
        };
        current = current.children[part];
      }
    }
    this.notify();
  }

  rename(oldPath: string, newPath: string): void {
    const oldParts = this.normalizePath(oldPath);
    const newParts = this.normalizePath(newPath);

    if (oldParts.length === 0 || newParts.length === 0) return;

    // Use case-insensitive resolution for source node
    const oldNode = this.getNode(oldParts);
    if (!oldNode) throw new Error(`Source not found: ${oldPath}`);

    const targetFileName = newParts[newParts.length - 1];
    const targetParentParts = newParts.slice(0, -1);
    let targetParent = this.getNode(targetParentParts);
    if (!targetParent) {
      this.mkdir(targetParentParts.join('/'));
      targetParent = this.getNode(targetParentParts);
    }

    if (!targetParent || targetParent.type !== 'dir' || !targetParent.children) {
      throw new Error(`Invalid destination directory: ${newPath}`);
    }

    // Resolve case-insensitive source file name from its parent
    const sourceFileName = oldParts[oldParts.length - 1];
    const sourceParentParts = oldParts.slice(0, -1);
    const sourceParent = this.getNode(sourceParentParts);
    
    let actualSourceFileName = sourceFileName;
    if (sourceParent && sourceParent.children) {
      const matchedSourceKey = Object.keys(sourceParent.children).find(
        (key) => key.toLowerCase() === sourceFileName.toLowerCase()
      );
      if (matchedSourceKey) {
        actualSourceFileName = matchedSourceKey;
      }
    }

    // Resolve target file name case-insensitively if it already exists
    const matchedTargetKey = Object.keys(targetParent.children).find(
      (key) => key.toLowerCase() === targetFileName.toLowerCase()
    );
    const actualTargetFileName = matchedTargetKey || targetFileName;

    // Remove from old parent
    if (sourceParent && sourceParent.children && sourceParent.children[actualSourceFileName]) {
      delete sourceParent.children[actualSourceFileName];
    }

    // Add to new parent
    targetParent.children[actualTargetFileName] = {
      ...oldNode,
      name: actualTargetFileName,
      updatedAt: Date.now(),
    };

    this.notify();
  }

  unlink(path: string): void {
    const parts = this.normalizePath(path);
    if (parts.length === 0) return;

    const fileName = parts[parts.length - 1];
    const parent = this.getNode(parts.slice(0, -1));

    if (parent && parent.children) {
      const matchedKey = Object.keys(parent.children).find(
        (key) => key.toLowerCase() === fileName.toLowerCase()
      );
      if (matchedKey && parent.children[matchedKey]) {
        delete parent.children[matchedKey];
        deletePersistedFile(path);
        this.notify();
        return;
      }
    }
    throw new Error(`File not found: ${path}`);
  }

  rmdir(path: string): void {
    const parts = this.normalizePath(path);
    if (parts.length === 0) return;

    const dirName = parts[parts.length - 1];
    const parent = this.getNode(parts.slice(0, -1));

    if (parent && parent.children) {
      const matchedKey = Object.keys(parent.children).find(
        (key) => key.toLowerCase() === dirName.toLowerCase()
      );
      if (matchedKey && parent.children[matchedKey]) {
        const dirNode = parent.children[matchedKey];
        if (dirNode.type !== 'dir') throw new Error(`Path is a file: ${path}`);
        if (dirNode.children && Object.keys(dirNode.children).length > 0) {
          throw new Error(`Directory not empty: ${path}`);
        }
        delete parent.children[matchedKey];
        this.notify();
        return;
      }
    }
    throw new Error(`Directory not found: ${path}`);
  }

  private bootstrap() {
    const cDrive = this.root.children!['C:'];
    cDrive.children = {};

    // Create standard root folders
    this.mkdir('C:/Windows/System');
    this.mkdir('C:/Program Files');
    this.mkdir('C:/Desktop');
    this.mkdir('C:/My Documents');
    this.mkdir('C:/Recycled');
    this.mkdir('C:/Sanktuary Net');

    // Parse the site source files into C:/Program Files/Source Code
    this.mkdir('C:/Program Files/Source Code');
    const progFiles = cDrive.children['Program Files'];
    const sourceCodeFolder = progFiles.children!['Source Code'];

    // Build the memory tree recursively from the JSON index
    const parseIndexNode = (sourceObj: any, targetNode: VFSNode, currentPath: string) => {
      if (!sourceObj) return;
      targetNode.children = targetNode.children || {};

      for (const [key, val] of Object.entries(sourceObj)) {
        if (val === null) {
          // File
          targetNode.children[key] = {
            name: key,
            type: 'file',
            content: `[This is the content of ${currentPath}/${key}]`,
            updatedAt: Date.now(),
          };
        } else {
          // Directory
          const subDir: VFSNode = {
            name: key,
            type: 'dir',
            children: {},
            updatedAt: Date.now(),
          };
          targetNode.children[key] = subDir;
          parseIndexNode(val, subDir, `${currentPath}/${key}`);
        }
      }
    };

    parseIndexNode(fsIndex, sourceCodeFolder, 'C:/Program Files/Source Code');

    // Populate notes and files on Desktop and in Recycled folder
    this.writeFile(
      'C:/Desktop/NOTES.txt',
      `Research outline for Ppls Library entries:\n\n` +
      `- Cross-reference Somerset v Stewart (1772) with regional courts in Jamaica.\n` +
      `- Add primary documents on the Manden Charter's ecological articles.\n` +
      `- Trace the 1945 Manchester Congress back to earlier pan-African conferences.\n\n` +
      `also — new burna boy album is insane. track 7 especially. need to connect that rhythm pattern back to the yoruba talking drum lineage for the piece im writing.`
    );
    this.writeFile(
      'C:/Recycled/Wakanda_draft.txt',
      `Title: Speculative Sovereignty: Wakanda and the African Imagination\n` +
      `Draft Status: SCRAPPED (Do not publish)\n\n` +
      `Note: I'm deleting this draft. While Black Panther's Wakanda has captured global attention, analyzing a fictional narrative in a library dedicated to material decolonization feels counterproductive. We need to focus on real historical precedents of self-determination, like King Piye, the Kingdom of Kush, and Thomas Sankara's Burkina Faso. Speculative fiction is a powerful cultural tool, but it shouldn't replace or overshadow the actual, documented, and hard-fought struggles of real societies.`
    );
    this.writeFile(
      'C:/My Documents/readme.txt',
      `Welcome to My Documents.\n\nYou can edit files in Notepad and save them directly back to the virtual disk.`
    );

    // Add classic system configuration files in root C:
    this.writeFile('C:/autoexec.bat', '@ECHO OFF\nPROMPT $P$G\nPATH C:\\WINDOWS;C:\\WINDOWS\\COMMAND\nSET TEMP=C:\\WINDOWS\\TEMP\nLH MSCDEX.EXE /D:mscd001\nLH SMARTDRV.EXE\necho Windows 98 is now loading...');
    this.writeFile('C:/config.sys', 'DEVICE=C:\\WINDOWS\\HIMEM.SYS\nDEVICE=C:\\WINDOWS\\EMM386.EXE NOEMS\nBUFFERS=15,0\nFILES=30\nDOS=HIGH,UMB\nLASTDRIVE=Z');

    // Restore any user-created or edited files from persistent storage
    loadPersistedFiles().then((savedFiles) => {
      if (savedFiles && savedFiles.length > 0) {
        savedFiles.forEach((file) => {
          this.writeFile(file.path, file.content, false);
        });
        this.notify();
      }
    });
  }
}

export const vfs = new MemoryFileSystem();
export default vfs;
