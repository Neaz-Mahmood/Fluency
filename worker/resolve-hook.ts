// Lets plain Node load the app's lib/ code: it maps the `@/` alias from tsconfig.json to the
// project root and adds the `.ts` extension that Next.js lets imports leave out.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    let url: URL | null = null;
    if (specifier.startsWith("@/")) url = new URL(specifier.slice(2), root);
    else if (
      specifier.startsWith(".") &&
      context.parentURL?.startsWith(root.href) &&
      !context.parentURL.includes("/node_modules/")
    )
      url = new URL(specifier, context.parentURL);
    if (url && !/\.[cm]?[jt]sx?$/.test(url.pathname)) {
      const path = fileURLToPath(url);
      const file = [`${path}.ts`, `${path}/index.ts`].find((candidate) => existsSync(candidate));
      if (file) return nextResolve(pathToFileURL(file).href, context);
    }
    return nextResolve(url?.href ?? specifier, context);
  },
});
