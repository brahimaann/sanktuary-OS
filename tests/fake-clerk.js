// Stand-in for @clerk/react, swapped in by vite.config.ts only when the dev server runs with FAKE_CLERK=1
// (see tests/signed-in.mjs). Who you are comes from the sk_fake_user cookie; the server trusts the signed
// sk_session cookie the script mints with its own throwaway secret, so none of this works against the real site.
if (import.meta.env.PROD) throw new Error('fake Clerk must never be built into the site');

const username = document.cookie.match(/(?:^|; )sk_fake_user=([^;]+)/)?.[1] || null;
const user = username && { id: `user_${username}`, username, firstName: null, fullName: null };
const signOut = async () => {
  document.cookie = 'sk_fake_user=; Max-Age=0; Path=/';
  location.reload();
};

export const ClerkProvider = ({ children }) => children;
export const useAuth = () => ({ isLoaded: true, isSignedIn: !!user, userId: user?.id ?? null, getToken: async () => null });
export const useUser = () => ({ isLoaded: true, isSignedIn: !!user, user });
export const useClerk = () => ({ session: null, signOut, openUserProfile: () => alert('No account settings in fake sign-in') });
export const useSignIn = () => ({ signIn: {} });
