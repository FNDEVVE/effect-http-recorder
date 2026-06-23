#!/usr/bin/env bun
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pack } from "./pack.js"

const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json()
if (
  typeof pkg !== "object" ||
  pkg === null ||
  !("name" in pkg) ||
  typeof pkg.name !== "string" ||
  !("peerDependencies" in pkg) ||
  typeof pkg.peerDependencies !== "object" ||
  pkg.peerDependencies === null ||
  !("effect" in pkg.peerDependencies) ||
  typeof pkg.peerDependencies.effect !== "string" ||
  !("devDependencies" in pkg) ||
  typeof pkg.devDependencies !== "object" ||
  pkg.devDependencies === null ||
  !("typescript" in pkg.devDependencies) ||
  typeof pkg.devDependencies.typescript !== "string"
)
  throw new Error("Invalid package metadata")

const run = async (command: ReadonlyArray<string>, cwd: string) => {
  const process = Bun.spawn(command, {
    cwd,
    env: globalThis.process.env,
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await process.exited
  if (exitCode !== 0) throw new Error(`${command.join(" ")} exited with code ${exitCode}`)
}

export const verifyPackage = async (archive: string) => {
  const directory = await mkdtemp(path.join(tmpdir(), "http-recorder-consumer-"))
  try {
    await writeFile(
      path.join(directory, "package.json"),
      JSON.stringify({
        name: "http-recorder-consumer",
        private: true,
        type: "module",
      }),
    )
    await writeFile(
      path.join(directory, "consumer.ts"),
      `import { HttpRecorder } from ${JSON.stringify(pkg.name)}
import { NodeSocket } from "@effect/platform-node"
import { Layer } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Socket } from "effect/unstable/socket"

const options: HttpRecorder.RecorderOptions = { match: () => true, redact: { jsonFields: ["access_token"] } }
const socketOptions: HttpRecorder.SocketRecorderOptions = { redact: { jsonFields: ["access_token"] } }
HttpRecorder.http("consumer", options) satisfies Layer.Layer<HttpClient.HttpClient>
HttpRecorder.socket("consumer/socket", socketOptions).pipe(
  Layer.provide(NodeSocket.layerWebSocket("wss://example.test")),
) satisfies Layer.Layer<Socket.Socket>
// @ts-expect-error HTTP request matching does not apply to WebSocket frames.
HttpRecorder.socket("consumer/socket", { match: () => true })
`,
    )
    await writeFile(
      path.join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          // Required by effect@4.0.0-beta.83: its declarations currently contain unresolved internal symbols.
          skipLibCheck: true,
          lib: ["ES2022", "DOM", "ESNext.Disposable"],
        },
        include: ["consumer.ts"],
      }),
    )

    await run(
      [
        "npm",
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        archive,
        `typescript@${pkg.devDependencies.typescript}`,
        `effect@${pkg.peerDependencies.effect}`,
      ],
      directory,
    )
    await run(
      [
        "node",
        "--input-type=module",
        "-e",
        `import(${JSON.stringify(pkg.name)}).then((module) => { const root = Object.keys(module).sort(); const namespace = Object.keys(module.HttpRecorder).sort(); if (JSON.stringify(root) !== JSON.stringify(["HttpRecorder"])) throw new Error(\`Unexpected root exports: \${root}\`); if (JSON.stringify(namespace) !== JSON.stringify(["http", "socket"])) throw new Error(\`Unexpected namespace exports: \${namespace}\`) })`,
      ],
      directory,
    )
    await run([path.join(directory, "node_modules", ".bin", "tsc"), "--noEmit"], directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const archive = await pack()
  try {
    await verifyPackage(archive)
  } finally {
    await Bun.file(archive).delete()
  }
}
