#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun"
import { Config, Effect } from "effect"
import { pack, projectDirectory, run } from "./pack.js"
import { verifyPackage } from "./verify-package.js"

const publish = Effect.gen(function* () {
  const archive = yield* pack()
  yield* verifyPackage(archive)
  const ci = yield* Config.boolean("GITHUB_ACTIONS").pipe(Config.withDefault(false))
  yield* run(
    "npm",
    ["publish", archive, "--tag", "beta", ci ? "--provenance" : "--provenance=false"],
    yield* projectDirectory,
  )
})

BunRuntime.runMain(publish.pipe(Effect.scoped, Effect.provide(BunServices.layer)))
