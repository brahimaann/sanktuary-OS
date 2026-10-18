# Tests

`npm test` starts the real server on temporary data with a fake Clerk (users alice = admin, bob, carol)
and checks rights, path safety, safe file serving, private boards/channels, live updates and the activity feed.
Nothing touches your real `data/` folder, drives or Clerk account.

To look at pages behind the sign-in (for Claude sessions too, no Clerk keys needed), `tests/signed-in.mjs` runs the
server on temporary data with a fake Clerk, the Vite dev server with `FAKE_CLERK=1` (which swaps `@clerk/react` for
`tests/fake-clerk.js`), and a headless browser signed in as `admin` or `member`:

```
NODE_PATH=$(npm root -g) node tests/signed-in.mjs member /welcome shot.png
```

It only works on the dev server with its own throwaway secret: a build that somehow included the fake would refuse to load, and the real site
rejects its cookies. The business portal still needs a real Clerk sign-in with two-step on.
