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

// One object each, like Clerk's: a new getToken every render would re-run every effect that depends on it
const auth = { isLoaded: true, isSignedIn: !!user, userId: user?.id ?? null, getToken: async () => null };
const userState = { isLoaded: true, isSignedIn: !!user, user };
const clerk = { session: null, signOut, openUserProfile: () => alert('No account settings in fake sign-in') };
const signInState = { signIn: {} };

export const ClerkProvider = ({ children }) => children;
export const useAuth = () => auth;
export const useUser = () => userState;
export const useClerk = () => clerk;
export const useSignIn = () => signInState;
