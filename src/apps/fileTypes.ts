// Camera RAW: the server previews the JPEG inside (see RAW_PHOTO in server/index.mjs)
const RAW = 'cr2 cr3 nef nrw arw srf sr2 dng raf orf rw2 pef srw 3fr erf kdc iiq';
const isRaw = (name: string) => RAW.split(' ').includes(name.split('.').pop()?.toLowerCase() || '');

type FileKind = 'image' | 'audio' | 'video' | 'pdf' | 'doc' | 'sheet' | 'text' | 'other';

const EXTENSIONS: Record<Exclude<FileKind, 'other'>, string> = {
  image: `jpg jpeg png gif webp avif svg tif tiff psd ${RAW}`,
  audio: 'mp3 wav flac m4a aac ogg aif aiff',
  video: 'mp4 m4v mov webm',
  pdf: 'pdf',
  doc: 'docx',
  sheet: 'xlsx xls ods csv',
  text: 'txt md json lrc srt vtt log xml html htm css js jsx ts tsx py yml yaml ini cfg toml sh bat ps1',
};
const KINDS = Object.fromEntries(Object.entries(EXTENSIONS).flatMap(([kind, exts]) => exts.split(' ').map((ext) => [ext, kind]))) as Record<
  string,
  FileKind
>;

export const fileKind = (name: string): FileKind => KINDS[name.split('.').pop()?.toLowerCase() || ''] || 'other';

/** Browsers can't show these, so the server converts them (?preview) — see thumb() in server/index.mjs. */
export const needsConversion = (name: string) => /\.(psd|tiff?)$/i.test(name) || isRaw(name);

/**
 * Play / show the server's lighter copy (?preview) instead of the original: a 256 kbps MP3 for WAV/AIFF/FLAC
 * (~1/5 the size) and a 2400 px WebP for photos and artwork. Download always gets the original.
 */
export const lightAudio = (name: string) => /\.(wav|aiff?|flac)$/i.test(name);
export const lightImage = (name: string) => /\.(jpe?g|png|webp|avif|tiff?|psd)$/i.test(name) || isRaw(name);

/** Thumbnails are generated server-side for these (see THUMBABLE in server/index.mjs). */
export const hasThumb = (name: string) => /\.(jpe?g|png|webp|gif|avif|tiff?|psd)$/i.test(name) || isRaw(name);

const ICONS: Record<FileKind | 'folder', string> = {
  folder: 'folder',
  image: 'image-jpeg',
  audio: 'sound',
  video: 'video',
  pdf: 'document',
  doc: 'doc',
  sheet: 'document',
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
