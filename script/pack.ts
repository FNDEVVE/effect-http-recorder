#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Effect, FileSystem, Path, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

export class ToolingError extends Schema.TaggedError<ToolingError>()("ToolingError", {
  message: Schema.String,
}) {}

export const run = Effect.fn("Tooling.run")(function* (command: string, args: ReadonlyArray<string>, cwd: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const code = yield* spawner.exitCode(
    ChildProcess.make(command, args, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" }),
  )
  if (code !== 0)
    return yield* Effect.fail(new ToolingError({ message: `${command} ${args.join(" ")} exited with code ${code}` }))
})

export const projectDirectory = Effect.gen(function* () {
  const path = yield* Path.Path
  return yield* path.fromFileUrl(new URL("..", import.meta.url))
})

const PackOutput = Schema.fromJsonString(Schema.Tuple([Schema.Struct({ filename: Schema.String })]))

/** The archive belongs to the calling scope, including failed or interrupted consumers. */
export const pack = Effect.fn("Tooling.pack")(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "http-recorder-pack-" })
  const cwd = yield* projectDirectory
  const process = yield* spawner.spawn(
    ChildProcess.make("npm", ["pack", "--json", "--pack-destination", directory], { cwd, stderr: "inherit" }),
  )
  const output = yield* Stream.mkString(Stream.decodeText(process.stdout))
  const code = yield* process.exitCode
  if (code !== 0) return yield* Effect.fail(new ToolingError({ message: `npm pack exited with code ${code}` }))
  const [entry] = yield* Schema.decodeEffect(PackOutput)(output)
  if (path.basename(entry.filename) !== entry.filename) {
    return yield* Effect.fail(new ToolingError({ message: "npm pack returned an unsafe archive filename" }))
  }
  return path.join(directory, entry.filename)
})

if (import.meta.main) {
  BunRuntime.runMain(pack().pipe(Effect.flatMap(Effect.log), Effect.scoped, Effect.provide(BunServices.layer)))
}
