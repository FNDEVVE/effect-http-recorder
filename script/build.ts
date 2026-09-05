#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, FileSystem, Path } from "effect"
import { projectDirectory, run, ToolingError } from "./pack.js"

const build = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const cwd = yield* projectDirectory
  const outdir = path.join(cwd, "dist")
  yield* fs.remove(outdir, { recursive: true, force: true })
  yield* run(path.join(cwd, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.build.json"], cwd)

  const result = yield* Effect.tryPromise({
    try: () =>
      Bun.build({
        entrypoints: [path.join(cwd, "src", "index.ts")],
        outdir,
        target: "node",
        format: "esm",
        packages: "external",
      }),
    catch: (cause) => new ToolingError({ message: `Bundler failed: ${String(cause)}` }),
  })
  if (!result.success) return yield* Effect.fail(new ToolingError({ message: result.logs.join("\n") }))
  // Preserve the entire declaration graph: public helpers reference cassette and transport types.
})

BunRuntime.runMain(build.pipe(Effect.provide(BunServices.layer)))
