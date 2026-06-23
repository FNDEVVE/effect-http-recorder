#!/usr/bin/env bun
import { $ } from "bun"
import { cp, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = fileURLToPath(new URL("..", import.meta.url))

export const pack = async () => {
  process.chdir(dir)
  await $`bun run build`
  const directory = await mkdtemp(path.join(tmpdir(), "effect-http-recorder-pack-"))
  // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- package.json is validated by the package schema and build checks.
  const pkg = JSON.parse(await Bun.file("package.json").text()) as {
    readonly name: string
    readonly version: string
    exports: Record<string, string | { readonly import: string; readonly types: string }>
  }

  for (const [key, value] of Object.entries(pkg.exports)) {
    if (typeof value !== "string") continue
    const file = value.replace("./src/", "./dist/").replace(/\.ts$/, "")
    pkg.exports[key] = { import: `${file}.js`, types: `${file}.d.ts` }
  }

  try {
    await Promise.all([
      Bun.write(path.join(directory, "package.json"), JSON.stringify(pkg, null, 2)),
      cp("dist", path.join(directory, "dist"), { recursive: true }),
      ...["README.md", "CHANGELOG.md", "LICENSE"].map((file) => cp(file, path.join(directory, file))),
    ])
    await $`bun pm pack`.cwd(directory)
    const archive = path.join(dir, `${pkg.name}-${pkg.version}.tgz`)
    await cp(path.join(directory, `${pkg.name}-${pkg.version}.tgz`), archive)
    return archive
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

if (import.meta.main) await pack()
