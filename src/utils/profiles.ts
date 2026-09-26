import { useCallback, useEffect, useState } from 'react';
import { useApi } from './api';
import { useLiveEvent, useOnline } from './live';

// Where artists keep their work (same keys as PROFILE_LINKS in server/index.mjs): a full link, or a bare
// handle where there's a prefix
export const PROFILE_LINKS = [
  ['spotify', 'Spotify', '', 'https://open.spotify.com/artist/...'],
  ['appleMusic', 'Apple Music', '', 'https://music.apple.com/...'],
  ['youtube', 'YouTube', 'https://youtube.com/@', '@channel or link'],
  ['soundcloud', 'SoundCloud', 'https://soundcloud.com/', 'name or link'],
  ['bandcamp', 'Bandcamp', '', 'https://name.bandcamp.com'],
  ['audiomack', 'Audiomack', 'https://audiomack.com/', 'name or link'],
  ['bandlab', 'BandLab', 'https://bandlab.com/', 'name or link'],
  ['tiktok', 'TikTok', 'https://tiktok.com/@', '@handle'],
  ['instagram', 'Instagram', 'https://instagram.com/', '@handle'],
  ['x', 'X (Twitter)', 'https://x.com/', '@handle'],
  ['website', 'Website', '', 'https://...'],
] as const;
export type LinkKey = (typeof PROFILE_LINKS)[number][0];

/** A profile link as an https address (a pasted http(s) link as is; never any other scheme). */
export const linkFor = (k: LinkKey, v: string) => {
  const prefix = PROFILE_LINKS.find(([key]) => key === k)?.[2];
  return /^https?:\/\//i.test(v) ? v : prefix ? prefix + v.replace(/^@/, '') : `https://${v}`;
};

export interface Profile extends Partial<Record<LinkKey, string>> {
  username: string;
  admin?: boolean;
  online?: boolean;
  lastSignIn?: number | null;
  displayName?: string;
  status?: string;
  role?: string;
  bio?: string;
  avatar?: number;
  listed?: boolean;
}

export const displayName = (p?: Profile, fallback = '') => p?.displayName || p?.username || fallback;

/** Every member's profile, kept live: profile edits and who's online arrive over the live connection. */
export function useProfiles() {
  const api = useApi();
  const online = useOnline();
  const [list, setList] = useState<Profile[]>([]);
  const load = useCallback(() => {
    api('/api/profiles').then(setList, () => {});
  }, [api]);
  useEffect(load, [load]);
  useLiveEvent('profile', (p: Profile) =>
    setList((prev) =>
      prev.some((x) => x.username === p.username) ? prev.map((x) => (x.username === p.username ? { ...x, ...p } : x)) : [...prev, p],
    ),
  );
  const byName: Record<string, Profile> = Object.fromEntries(list.map((p) => [p.username, { ...p, online: online.includes(p.username) }]));
  return { profiles: Object.values(byName), byName, reload: load };
}
