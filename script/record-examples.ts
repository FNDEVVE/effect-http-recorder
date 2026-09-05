#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, FileSystem, Path } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { projectDirectory, ToolingError } from "./pack.js"

const record = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const cwd = yield* projectDirectory
  yield* fs.remove(path.join(cwd, "examples", "recordings"), { recursive: true, force: true })
  const code = yield* spawner.exitCode(
    ChildProcess.make("bun", ["run", "test:examples"], {
      cwd,
      env: { RECORD_EXAMPLES: "true" },
      extendEnv: true,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
  )
  if (code !== 0) return yield* Effect.fail(new ToolingError({ message: `Example recording exited with code ${code}` }))
})

BunRuntime.runMain(record.pipe(Effect.provide(BunServices.layer)))
