#!/usr/bin/env bun
import { fileURLToPath } from "node:url"
import { withPackedArchive } from "./pack.js"
import { verifyPackage } from "./verify-package.js"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

await withPackedArchive(async (archive) => {
  await verifyPackage(archive)
  const provenance = process.env.GITHUB_ACTIONS === "true" ? "--provenance" : "--provenance=false"
  const publish = Bun.spawn(["npm", "publish", archive, "--tag", "beta", provenance], {
    cwd: dir,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await publish.exited
  if (exitCode !== 0) throw new Error(`npm publish exited with code ${exitCode}`)
})
