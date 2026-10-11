import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
// fileURLToPath, not URL.pathname: the repository path contains a space, which pathname percent-
// encodes, so the child process was handed a path that does not exist and every case failed alike.
// Two of these tests then passed for the wrong reason, which is worse than failing.
import { fileURLToPath } from "node:url";

// The check that stands between a local build and a production deploy pointed at a developer's
// own Clerk instance. It exists because that deploy already happened once and nothing caught it:
// every page returned 200, the API answered, the prerender was correct, and sign-in silently
// pointed at a Clerk development instance (*.clerk.accounts.dev) where none of the real accounts
// exist.

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const script = fileURLToPath(new URL("../scripts/check-deploy-env.mjs", import.meta.url));

const run = (key) => {
  try {
    execFileSync(process.execPath, [script], {
      env: { ...process.env, VITE_CLERK_PUBLISHABLE_KEY: key },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return 0;
  } catch (error) {
    return error.status ?? 1;
  }
};

test("the deploy script checks the environment before it builds anything", () => {
  // Order matters: a check that runs after the build has already written the wrong key into dist.
  assert.ok(
    pkg.scripts.deploy.startsWith("node scripts/check-deploy-env.mjs &&"),
    `deploy must begin with the check, got: ${pkg.scripts.deploy}`,
  );
  // And the rest of the chain has to stay intact — prerender especially. Skipping it reverts deal
  // pages to per-request rendering, where they 503.
  assert.match(pkg.scripts.deploy, /npm run build/);
  assert.match(pkg.scripts.deploy, /npm run prerender/);
});

test("a development key is refused", () => {
  assert.equal(run("pk_test_cHJpbWUtbXV0dC02NDY0LmNsZXJrLmFjY291bnRzLmRldiQ"), 1);
});

test("a missing key is refused, not treated as fine", () => {
  // No key builds a bundle with no Clerk at all, so sign-in vanishes from the deployed site
  // without any page failing — the same shape of invisible breakage.
  assert.equal(run(""), 1);
});

test("the production key passes, so CI is unaffected", () => {
  assert.equal(run("pk_live_Y2xlcmsucmFkYXIuY2hlYXAk"), 0);
});
