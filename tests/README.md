# Tests

`npm test` starts the real server on temporary data with a fake Clerk (users alice = admin, bob, carol)
and checks rights, path safety, safe file serving, private boards/channels, live updates and the activity feed.
Nothing touches your real `data/` folder, drives or Clerk account.
