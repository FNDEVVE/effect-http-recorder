#!/usr/bin/env bun
import { $ } from "bun"
import { fileURLToPath } from "node:url"
import { withPackedArchive } from "./pack.js"
import { verifyPackage } from "./verify-package.js"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

await withPackedArchive(async (archive) => {
  await verifyPackage(archive)
  await $`npm publish ${archive}`
})
