#!/usr/bin/env node
// Refuses to build a production deploy against a development Clerk instance.
//
// What this is for
// ----------------
// app/ClerkClientProvider.tsx reads VITE_CLERK_PUBLISHABLE_KEY through import.meta.env, which Vite
// resolves at BUILD time and writes into the client bundle as a literal. So whoever runs the build
// decides which Clerk instance the public site talks to, and the value comes from .env.local, which
// is gitignored and holds a developer's own pk_test_ key.
//
// .github/workflows/deploy.yml supplies the production key from a repository secret, which is why
// deploys are supposed to go through CI. Nothing said so, and nothing stopped a local one: running
// `npm run deploy` by hand produced a perfectly healthy-looking deploy - every page 200, the API
// answering, the prerender correct - in which sign-in pointed at a Clerk development instance
// (*.clerk.accounts.dev) and no real account existed. The site looked fine to every check except
// trying to log in.
//
// A deploy that is wrong in a way no page can show you is exactly what a preflight check is for.

const key = (process.env.VITE_CLERK_PUBLISHABLE_KEY || "").trim();

// The production key is a repository secret, so in CI this passes and nothing changes.
if (key.startsWith("pk_live_")) process.exit(0);

const problem = !key
  ? "VITE_CLERK_PUBLISHABLE_KEY is not set, so the built bundle would carry no Clerk key at all\n  and sign-in would silently disappear from the deployed site."
  : key.startsWith("pk_test_")
    ? `VITE_CLERK_PUBLISHABLE_KEY is a development key (${key.slice(0, 16)}…).\n  It almost certainly came from .env.local. Deploying it points radar.cheap's sign-in at a\n  Clerk development instance where none of your users have accounts.`
    : `VITE_CLERK_PUBLISHABLE_KEY is not a Clerk publishable key (${key.slice(0, 16)}…).`;

console.error(`
Refusing to build a production deploy.

  ${problem}

Deploys go through CI, which supplies the production key from a repository secret:

  git push origin main          # the workflow deploys on push
  gh workflow run deploy.yml    # or run it by hand

To build locally on purpose - to check that a build succeeds, not to ship it - use:

  npm run build

If you really do intend to deploy from this machine, set the production key for that one command
rather than putting it in .env.local, where it would silently become the default for every build.
`);
process.exit(1);
