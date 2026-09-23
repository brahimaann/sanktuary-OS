import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/react';
import { stopLive } from './live';

export type Rights = 'none' | 'view' | 'upload' | 'edit';
export const RANK: Record<Rights, number> = { none: 0, view: 1, upload: 2, edit: 3 };

export interface SpaceInfo {
  id: string;
  name: string;
  rights: Rights;
  online: boolean;
  driveName: string | null;
  free: number | null;
  total: number | null;
  used?: number;
  quota?: number;
}

export interface Me {
  username: string;
  admin: boolean;
  spaces: SpaceInfo[];
}

/** fetch() with the Clerk session token; throws the server's message on errors. */
export function useApi() {
  const { getToken } = useAuth();
  return useCallback(
    async (url: string, init: RequestInit = {}) => {
      const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await getToken()}`, ...init.headers } });
      if (!res.ok) throw Object.assign(new Error((await res.text()) || `HTTP ${res.status}`), { status: res.status });
      return res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
    },
    [getToken],
  );
}

/** The signed-in member, their spaces and whether they're an admin. null while signed out/loading. */
export function useMe() {
  const { isSignedIn } = useAuth();
  const api = useApi();
  const [me, setMe] = useState<Me | null>(null);
  const reload = useCallback(() => {
    api('/api/me').then(setMe, () => setMe(null));
  }, [api]);
  useEffect(() => {
    if (isSignedIn) reload();
    else {
      setMe(null);
      if (isSignedIn === false) {
        stopLive();
        fetch('/api/logout', { method: 'POST' }).catch(() => {});
      }
    }
  }, [isSignedIn, reload]);
  return { me, reload };
}
