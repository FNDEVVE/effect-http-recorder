#!/usr/bin/env bun
import { $ } from "bun"
import { fileURLToPath } from "node:url"
import { withPackedArchive } from "./pack.js"
import { verifyPackage } from "./verify-package.js"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

await withPackedArchive(async (archive) => {
  await verifyPackage(archive)
  if (process.env.GITHUB_ACTIONS === "true") return await $`npm publish ${archive} --tag beta --provenance`
  await $`npm publish ${archive} --tag beta --provenance=false`
})
