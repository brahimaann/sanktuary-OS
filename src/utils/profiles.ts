import { useCallback, useEffect, useState } from 'react';
import { useApi } from './api';
import { useLiveEvent, useOnline } from './live';

export interface Profile {
  username: string;
  admin?: boolean;
  online?: boolean;
  lastSignIn?: number | null;
  displayName?: string;
  status?: string;
  role?: string;
  bio?: string;
  soundcloud?: string;
  instagram?: string;
  website?: string;
  avatar?: number;
}

export const displayName = (p?: Profile, fallback = '') => p?.displayName || p?.username || fallback;

/** Every member's profile, kept live: profile edits and who's online arrive over the live connection. */
export function useProfiles() {
  const api = useApi();
  const online = useOnline();
  const [list, setList] = useState<Profile[]>([]);
  const load = useCallback(() => { api('/api/profiles').then(setList, () => {}); }, [api]);
  useEffect(load, [load]);
  useLiveEvent('profile', (p: Profile) => setList((prev) => (prev.some((x) => x.username === p.username) ? prev.map((x) => (x.username === p.username ? { ...x, ...p } : x)) : [...prev, p])));
  const byName: Record<string, Profile> = Object.fromEntries(list.map((p) => [p.username, { ...p, online: online.includes(p.username) }]));
  return { profiles: Object.values(byName), byName, reload: load };
}
