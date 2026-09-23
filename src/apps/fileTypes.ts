type FileKind = 'image' | 'audio' | 'video' | 'pdf' | 'text' | 'other';

const KINDS: Record<string, FileKind> = {
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  svg: 'image',
  tif: 'image',
  tiff: 'image',
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  m4a: 'audio',
  aac: 'audio',
  ogg: 'audio',
  aif: 'audio',
  aiff: 'audio',
  mp4: 'video',
  m4v: 'video',
  mov: 'video',
  webm: 'video',
  pdf: 'pdf',
  txt: 'text',
  md: 'text',
  csv: 'text',
  json: 'text',
  lrc: 'text',
};

export const fileKind = (name: string): FileKind => KINDS[name.split('.').pop()?.toLowerCase() || ''] || 'other';

/** Thumbnails are generated server-side for these (see THUMBABLE in server/index.mjs). */
export const hasThumb = (name: string) => /\.(jpe?g|png|webp|gif|avif|tiff?)$/i.test(name);

const ICONS: Record<FileKind | 'folder', string> = {
  folder: 'folder',
  image: 'image-jpeg',
  audio: 'sound',
  video: 'video',
  pdf: 'document',
  text: 'notepad-file',
  other: 'document',
};

export const fileIcon = (name: string, isDir: boolean, size: 16 | 32 = 16) =>
  `/images/icons/${ICONS[isDir ? 'folder' : fileKind(name)]}-${size}x${size}.png`;

export const formatSize = (b: number) =>
  b < 1024
    ? `${b} bytes`
    : b < 1048576
      ? `${Math.ceil(b / 1024)} KB`
      : b < 1073741824
        ? `${(b / 1048576).toFixed(1)} MB`
        : `${(b / 1073741824).toFixed(2)} GB`;

/** Phones/tablets: open things with one tap instead of a double-click. */
export const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
