#!/usr/bin/env bun
import { Glob } from "bun"

const files = await Array.fromAsync(
  new Glob("{src,test,examples,script}/**/*.{ts,tsx,js,mjs,cjs}").scan({ absolute: true }),
)
const forbidden = ["import", "("].join("")
const violations = (
  await Promise.all(files.map(async (file) => ((await Bun.file(file).text()).includes(forbidden) ? [file] : [])))
).flat()

if (violations.length > 0) throw new Error(`Dynamic import syntax is not allowed:\n${violations.join("\n")}`)
