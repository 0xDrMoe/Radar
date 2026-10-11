import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig, type Plugin } from "vite";
import { PUBLIC_CSS_ID, scanPublicSource, stripOperatorOnly } from "./scripts/public-css.mjs";

// Keep Wrangler and Miniflare state project-local. These are non-secret tool
// settings; application environment belongs in ignored `.env*` files.
process.env.WRANGLER_WRITE_LOGS ??= "false";
process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

// `import "./globals.css?public"` (app/PublicShell.tsx) is globals.css without the rules no public
// page can match; scripts/public-css.mjs says how that is decided and why nothing else would do.
//
// A plain transform, so it runs where Vite puts user plugins: after vite:css has compiled the sheet
// (Tailwind's utilities and preflight included) and before vite:css-post turns it into a module and
// the chunk's CSS is concatenated, minified and hashed. So the public file's name changes whenever
// its content does, and the operator shell's plain imports never pass through here.
//
// Build only. What gets removed depends on every public source file, so under the dev server it
// would go stale the moment a component gained a class - which is what the dev server is for.
// There `?public` is simply the whole sheet, and the public pages keep every rule they had.
function publicStylesheets(): Plugin {
  let root = process.cwd();
  let inventory: ReturnType<typeof scanPublicSource> | undefined;
  return {
    name: "radar:public-stylesheets",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    transform: {
      filter: { id: PUBLIC_CSS_ID },
      async handler(css, id) {
        // One scan per build, shared by every environment that compiles a public sheet.
        inventory ??= scanPublicSource(root);
        return { code: stripOperatorOnly(css, await inventory, { from: id }).css, map: null };
      },
    },
  };
}

export default defineConfig({
  server: isCodexSeatbeltSandbox
    ? { watch: { useFsEvents: false, usePolling: true } }
    : undefined,
  // next-intl/use-intl create a React context that crosses the RSC/SSR/client boundary
  // (NextIntlClientProvider is set up in the RSC environment, read from client components).
  // Left to Vite's default dependency optimization, each environment can end up with its own
  // pre-bundled copy of the module — two different Context objects — so a client component's
  // useTranslations()/useRouter() throws "No intl context found" even though the provider is a
  // real ancestor. Excluding both from optimization keeps a single shared module instance.
  optimizeDeps: { exclude: ["next-intl", "use-intl"] },
  plugins: [
    vinext(),
    publicStylesheets(),
    cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    }),
  ],
});
