import { useSignIn } from '@clerk/react';

/**
 * Nickname + password sign-in against Clerk, used by the boot terminal and team file windows.
 * Resolves to null on success, or an error message.
 */
export function useTeamLogin() {
  const { signIn } = useSignIn();

  return async (nickname: string, password: string): Promise<string | null> => {
    const { error } = await signIn.password({ identifier: nickname, password });
    if (error) return error.longMessage || error.message;
    if (signIn.status !== 'complete') return 'Extra verification required. Ask an admin.';
    const done = await signIn.finalize();
    return done.error ? done.error.message : null;
  };
}
