#!/usr/bin/env bun
import { $ } from "bun"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = fileURLToPath(new URL("..", import.meta.url))

export const pack = async () => {
  process.chdir(dir)
  const output = await $`npm pack --json`.text()
  const result: unknown = JSON.parse(output)
  if (!Array.isArray(result) || result.length !== 1) throw new Error("npm pack returned an unexpected result")
  const entry: unknown = result[0]
  if (typeof entry !== "object" || entry === null || !("filename" in entry) || typeof entry.filename !== "string")
    throw new Error("npm pack did not return an archive filename")
  return path.join(dir, entry.filename)
}

export const withPackedArchive = async <A>(use: (archive: string) => Promise<A>) => {
  const archive = await pack()
  try {
    return await use(archive)
  } finally {
    const file = Bun.file(archive)
    if (await file.exists()) await file.delete()
  }
}

if (import.meta.main) await pack()
