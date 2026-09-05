#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, FileSystem, Path } from "effect"
import { projectDirectory, ToolingError } from "./pack.js"

const check = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const cwd = yield* projectDirectory
  const violations: Array<string> = []
  const forbidden = /\bimport\s*\(/
  for (const root of ["src", "test", "examples", "script"]) {
    const directory = path.join(cwd, root)
    for (const entry of yield* fs.readDirectory(directory, { recursive: true })) {
      if (!/\.(?:tsx?|[cm]?js)$/.test(entry)) continue
      const file = path.join(directory, entry)
      if (forbidden.test(yield* fs.readFileString(file))) violations.push(path.relative(cwd, file))
    }
  }
  if (violations.length > 0)
    return yield* Effect.fail(
      new ToolingError({ message: `Dynamic import syntax is not allowed:\n${violations.join("\n")}` }),
    )
})

BunRuntime.runMain(check.pipe(Effect.provide(BunServices.layer)))
