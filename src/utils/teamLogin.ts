import { useRef } from 'react';
import { useSignIn } from '@clerk/react';

type CodeKind = 'email_code' | 'phone_code' | 'totp';
export interface LoginResult { error?: string; needCode?: string }

/**
 * Nickname + access code sign-in against Clerk, used by the boot terminal and team windows.
 * On a new device Clerk may ask for one more step (device trust / two-step): login() then returns
 * needCode with a prompt, and verify(code) finishes the sign-in.
 */
export function useTeamLogin() {
  const { signIn } = useSignIn();
  const kind = useRef<CodeKind | null>(null);

  const finish = async (): Promise<string | null> => {
    if (signIn.status !== 'complete') return `Sign-in isn't complete yet (${signIn.status}).`;
    const done = await signIn.finalize();
    return done.error ? done.error.longMessage || done.error.message : null;
  };

  const login = async (nickname: string, password: string): Promise<LoginResult> => {
    kind.current = null;
    const { error } = await signIn.password({ identifier: nickname, password });
    if (error) return { error: error.longMessage || error.message };
    if (signIn.status === 'complete') {
      const err = await finish();
      return err ? { error: err } : {};
    }
    if (signIn.status !== 'needs_client_trust' && signIn.status !== 'needs_second_factor') {
      return { error: `Clerk needs another step (${signIn.status}). Ask an admin.` };
    }
    const factors = signIn.supportedSecondFactors || [];
    const find = (s: CodeKind) => factors.find((f) => f.strategy === s) as { safeIdentifier?: string } | undefined;
    if (find('email_code')) {
      const r = await signIn.mfa.sendEmailCode();
      if (r.error) return { error: r.error.longMessage || r.error.message };
      kind.current = 'email_code';
      return { needCode: `New device check: we emailed a code to ${find('email_code')?.safeIdentifier || 'your email'}.` };
    }
    if (find('phone_code')) {
      const r = await signIn.mfa.sendPhoneCode();
      if (r.error) return { error: r.error.longMessage || r.error.message };
      kind.current = 'phone_code';
      return { needCode: `New device check: we texted a code to ${find('phone_code')?.safeIdentifier || 'your phone'}.` };
    }
    if (find('totp')) {
      kind.current = 'totp';
      return { needCode: 'Enter the 6-digit code from your authenticator app.' };
    }
    return { error: 'This account has no email or phone to confirm a new device. Ask an admin to add an email in Clerk.' };
  };

  const verify = async (code: string): Promise<string | null> => {
    const c = code.trim();
    const r = kind.current === 'phone_code' ? await signIn.mfa.verifyPhoneCode({ code: c })
      : kind.current === 'totp' ? await signIn.mfa.verifyTOTP({ code: c })
      : await signIn.mfa.verifyEmailCode({ code: c });
    if (r.error) return r.error.longMessage || r.error.message;
    return finish();
  };

  return { login, verify };
}
