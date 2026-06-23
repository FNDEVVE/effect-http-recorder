#!/usr/bin/env bun
import { $ } from "bun"
import { fileURLToPath } from "node:url"
import { pack } from "./pack.js"
import { verifyPackage } from "./verify-package.js"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const published = async (name: string, version: string) => {
  const result = await $`npm view ${name}@${version} version`.quiet().nothrow()
  if (result.exitCode === 0) return true
  const stderr = result.stderr.toString()
  if (stderr.includes("E404")) return false
  throw new Error(`Failed to check whether ${name}@${version} is published:\n${stderr}`)
}

// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- package.json is validated by the package schema and build checks.
const pkg = JSON.parse(await Bun.file("package.json").text()) as {
  readonly name: string
  readonly version: string
}
if (pkg.version === "0.0.0") throw new Error("Version the HTTP recorder before publishing")
if (!(await Bun.file("CHANGELOG.md").text()).includes(`## ${pkg.version}`))
  throw new Error(`CHANGELOG.md has no entry for ${pkg.version}`)

if (await published(pkg.name, pkg.version)) {
  console.log(`already published ${pkg.name}@${pkg.version}`)
} else {
  const archive = await pack()
  try {
    await verifyPackage(archive)
    await $`npm publish ${archive}`
  } finally {
    await Bun.file(archive).delete()
  }
}
