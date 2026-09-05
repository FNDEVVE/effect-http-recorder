import { NodeFileSystem, NodePath } from "@effect/platform-node-shared"
import {
  Context,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Match,
  Option,
  Path,
  PlatformError,
  Schema,
  Semaphore,
} from "effect"
import { configuredSecrets, secretFindings, SecretFindingSchema, type SecretFinding } from "../redaction/secrets.js"
import {
  CassetteSchema,
  encodeCassette,
  getRecordedAt,
  MissingRecordedAtError,
  type Cassette,
  type CassetteMetadata,
  type Interaction,
} from "./model.js"

export { MissingRecordedAtError } from "./model.js"

export class CassetteNotFoundError extends Schema.TaggedError<CassetteNotFoundError>()("CassetteNotFoundError", {
  cassetteName: Schema.String,
}) {
  override get message() {
    return `Cassette "${this.cassetteName}" not found`
  }
}

export class InvalidCassetteError extends Schema.TaggedError<InvalidCassetteError>()("InvalidCassetteError", {
  cassetteName: Schema.String,
  description: Schema.String,
}) {
  override get message() {
    return `Cassette "${this.cassetteName}" is invalid: ${this.description}`
  }
}

export class UnsafeCassetteError extends Schema.TaggedError<UnsafeCassetteError>()("UnsafeCassetteError", {
  cassetteName: Schema.String,
  findings: Schema.Array(SecretFindingSchema),
}) {
  override get message() {
    return `Refusing to write cassette "${this.cassetteName}" because it contains possible secrets: ${this.findings
      .map((finding) => `${finding.path} (${finding.reason})`)
      .join(", ")}`
  }
}

export interface Interface {
  readonly read: (
    name: string,
  ) => Effect.Effect<ReadonlyArray<Interaction>, CassetteNotFoundError | InvalidCassetteError>
  readonly readCassette: (name: string) => Effect.Effect<Cassette, CassetteNotFoundError | InvalidCassetteError>
  readonly recordedAt: (
    name: string,
  ) => Effect.Effect<DateTime.Utc, CassetteNotFoundError | InvalidCassetteError | MissingRecordedAtError>
  readonly append: (
    name: string,
    interaction: Interaction,
    metadata?: CassetteMetadata,
  ) => Effect.Effect<void, UnsafeCassetteError | InvalidCassetteError>
  readonly exists: (name: string) => Effect.Effect<boolean, InvalidCassetteError>
  readonly remove: (name: string) => Effect.Effect<void, InvalidCassetteError>
  readonly list: () => Effect.Effect<ReadonlyArray<string>, InvalidCassetteError>
}

export class Service extends Context.Service<Service, Interface>()("effect-http-recorder/Cassette") {}

const invalidCassette = (name: string, error: unknown) =>
  new InvalidCassetteError({
    cassetteName: name,
    description: error instanceof Error ? error.message : String(error),
  })

const validateCassetteName = Effect.fn("Cassette.validateName")(function* (name: string) {
  if (
    !name ||
    name.includes("\0") ||
    name.startsWith("/") ||
    name.startsWith("\\") ||
    /^[a-zA-Z]:/.test(name) ||
    name.split(/[\\/]/).includes("..")
  ) {
    return yield* Effect.fail(invalidCassette(name, `Invalid cassette name "${name}"`))
  }
})

const cassettePath = Effect.fn("Cassette.path")(function* (path: Path.Path, directory: string, name: string) {
  yield* validateCassetteName(name)
  const target = path.resolve(directory, `${name}.json`)
  const relative = path.relative(directory, target)
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return yield* Effect.fail(invalidCassette(name, `Invalid cassette name "${name}"`))
  }
  return target
})

const parseCassette = Schema.decodeUnknownEffect(Schema.fromJsonString(CassetteSchema))
const formatCassette = (cassette: Cassette) =>
  encodeCassette(cassette).pipe(Effect.map((encoded) => `${JSON.stringify(encoded, null, 2)}\n`))
const buildCassette = (
  name: string,
  interactions: ReadonlyArray<Interaction>,
  metadata: CassetteMetadata | undefined,
  recordedAt: string,
): Cassette => ({
  version: 1,
  metadata: { ...metadata, name, recordedAt },
  interactions,
})
const validateRecordedAt = (name: string, cassette: Cassette) =>
  getRecordedAt(cassette).pipe(Effect.mapError((error) => invalidCassette(name, error)))
const cassetteRecordedAt = Effect.fn("Cassette.timestamp")(function* (name: string, cassette: Cassette) {
  const at = yield* validateRecordedAt(name, cassette)
  return yield* Option.match(at, {
    onNone: () => Effect.fail(new MissingRecordedAtError({ cassetteName: name })),
    onSome: Effect.succeed,
  })
})
const catchMissingOrInvalid = (name: string) => (error: PlatformError.PlatformError) =>
  Match.value(error.reason).pipe(
    Match.tag("NotFound", () => Effect.fail(new CassetteNotFoundError({ cassetteName: name }))),
    Match.orElse(() => Effect.fail(invalidCassette(name, error))),
  )
const ignoreMissing = (name: string) => (error: PlatformError.PlatformError) =>
  Match.value(error.reason).pipe(
    Match.tag("NotFound", () => Effect.void),
    Match.orElse(() => Effect.fail(invalidCassette(name, error))),
  )
const failIfUnsafe = (name: string, findings: ReadonlyArray<SecretFinding>) =>
  findings.length === 0 ? Effect.void : Effect.fail(new UnsafeCassetteError({ cassetteName: name, findings }))

interface Recording {
  readonly interactions: ReadonlyArray<Interaction>
  readonly findings: ReadonlyArray<SecretFinding>
  readonly recordedAt: string
}

export const fileSystem = (
  options: { readonly directory?: string } = {},
): Layer.Layer<Service, never, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = path.resolve(options.directory ?? "test/fixtures/recordings")
      const recorded = new Map<string, Recording>()
      const lock = yield* Semaphore.make(1)
      const pathFor = (name: string) => cassettePath(path, directory, name)

      const walk = Effect.fn("Cassette.walk")(function* (
        current: string,
      ): Effect.fn.Return<ReadonlyArray<string>, PlatformError.PlatformError> {
        const entries = yield* fs.readDirectory(current)
        const nested = yield* Effect.forEach(entries, (entry) => {
          const full = path.join(current, entry)
          return fs
            .stat(full)
            .pipe(Effect.flatMap((stat) => (stat.type === "Directory" ? walk(full) : Effect.succeed([full]))))
        })
        return nested.flat()
      })
      const readCassette = Effect.fn("Cassette.readCassette")(function* (name: string) {
        const target = yield* pathFor(name)
        const raw = yield* fs.readFileString(target).pipe(Effect.catchTag("PlatformError", catchMissingOrInvalid(name)))
        const cassette = yield* parseCassette(raw).pipe(Effect.mapError((error) => invalidCassette(name, error)))
        yield* validateRecordedAt(name, cassette)
        return cassette
      })

      return Service.of({
        read: Effect.fn("Cassette.read")(function* (name: string) {
          return (yield* readCassette(name)).interactions
        }),
        readCassette,
        recordedAt: Effect.fn("Cassette.recordedAt")(function* (name: string) {
          return yield* cassetteRecordedAt(name, yield* readCassette(name))
        }),
        append: Effect.fn("Cassette.append")(function* (
          name: string,
          interaction: Interaction,
          metadata?: CassetteMetadata,
        ) {
          yield* lock.withPermit(
            Effect.gen(function* () {
              const target = yield* pathFor(name)
              const entry = recorded.get(target)
              const secrets = yield* configuredSecrets.pipe(Effect.mapError((error) => invalidCassette(name, error)))
              const interactions = [...(entry?.interactions ?? []), interaction]
              const interactionFindings = [...(entry?.findings ?? []), ...secretFindings(interaction, secrets)]
              const recordedAt = entry?.recordedAt ?? DateTime.formatIso(yield* DateTime.now)
              const cassette = buildCassette(name, interactions, metadata, recordedAt)
              yield* failIfUnsafe(name, [...interactionFindings, ...secretFindings(cassette.metadata ?? {}, secrets)])
              const formatted = yield* formatCassette(cassette).pipe(
                Effect.mapError((error) => invalidCassette(name, error)),
              )
              yield* fs
                .makeDirectory(path.dirname(target), { recursive: true })
                .pipe(Effect.mapError((error) => invalidCassette(name, error)))
              // A sibling temporary file keeps replacement atomic on the target filesystem.
              yield* Effect.acquireUseRelease(
                Effect.succeed(`${target}.${crypto.randomUUID()}.tmp`),
                (temporary) =>
                  fs.writeFileString(temporary, formatted).pipe(
                    Effect.flatMap(() =>
                      Effect.gen(function* () {
                        yield* fs.rename(temporary, target)
                        recorded.set(target, { interactions, findings: interactionFindings, recordedAt })
                      }).pipe(Effect.uninterruptible),
                    ),
                    Effect.mapError((error) => invalidCassette(name, error)),
                  ),
                (temporary) =>
                  fs
                    .remove(temporary, { force: true })
                    .pipe(Effect.catch((error) => Effect.logWarning("Unable to remove temporary cassette", error))),
              )
            }),
          )
        }),
        exists: Effect.fn("Cassette.exists")(function* (name: string) {
          const target = yield* pathFor(name)
          return yield* fs.access(target).pipe(
            Effect.as(true),
            Effect.catchTag("PlatformError", (error) =>
              Match.value(error.reason).pipe(
                Match.tag("NotFound", () => Effect.succeed(false)),
                Match.orElse(() => Effect.fail(invalidCassette(name, error))),
              ),
            ),
          )
        }),
        remove: Effect.fn("Cassette.remove")(function* (name: string) {
          yield* lock.withPermit(
            Effect.gen(function* () {
              const target = yield* pathFor(name)
              yield* Effect.gen(function* () {
                yield* fs.remove(target).pipe(Effect.catchTag("PlatformError", ignoreMissing(name)))
                recorded.delete(target)
              }).pipe(Effect.uninterruptible)
            }),
          )
        }),
        list: Effect.fn("Cassette.list")(function* () {
          // Only a missing root means an empty store; nested IO failures remain visible.
          const present = yield* fs.access(directory).pipe(
            Effect.as(true),
            Effect.catchTag("PlatformError", (error) =>
              Match.value(error.reason).pipe(
                Match.tag("NotFound", () => Effect.succeed(false)),
                Match.orElse(() => Effect.fail(invalidCassette(directory, error))),
              ),
            ),
          )
          if (!present) return []
          const files = yield* walk(directory).pipe(Effect.mapError((error) => invalidCassette(directory, error)))
          return files
            .filter((file) => file.endsWith(".json"))
            .map((file) =>
              path
                .relative(directory, file)
                .replace(/\\/g, "/")
                .replace(/\.json$/, ""),
            )
            .toSorted()
        }),
      })
    }),
  )

export const memory = (initial: Record<string, ReadonlyArray<Interaction>> = {}): Layer.Layer<Service> =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const stored = new Map<string, Cassette>(
        Object.entries(initial).map(([name, interactions]) => [
          name,
          { version: 1, metadata: { name }, interactions: [...interactions] },
        ]),
      )
      const recorded = new Map<string, Recording>()
      const lock = yield* Semaphore.make(1)
      const readCassette = Effect.fn("Cassette.memory.readCassette")(function* (name: string) {
        yield* validateCassetteName(name)
        const cassette = stored.get(name)
        if (!cassette) return yield* Effect.fail(new CassetteNotFoundError({ cassetteName: name }))
        yield* validateRecordedAt(name, cassette)
        return cassette
      })
      return Service.of({
        read: Effect.fn("Cassette.memory.read")(function* (name: string) {
          return (yield* readCassette(name)).interactions
        }),
        readCassette,
        recordedAt: Effect.fn("Cassette.memory.recordedAt")(function* (name: string) {
          return yield* cassetteRecordedAt(name, yield* readCassette(name))
        }),
        append: Effect.fn("Cassette.memory.append")(function* (
          name: string,
          interaction: Interaction,
          metadata?: CassetteMetadata,
        ) {
          yield* lock.withPermit(
            Effect.gen(function* () {
              yield* validateCassetteName(name)
              const entry = recorded.get(name)
              const previous = stored.get(name)
              const secrets = yield* configuredSecrets.pipe(Effect.mapError((error) => invalidCassette(name, error)))
              const interactions = [...(previous?.interactions ?? []), interaction]
              const findings = [
                ...(entry?.findings ?? secretFindings(previous?.interactions ?? [], secrets)),
                ...secretFindings(interaction, secrets),
              ]
              const recordedAt = entry?.recordedAt ?? DateTime.formatIso(yield* DateTime.now)
              const cassette = buildCassette(name, interactions, metadata, recordedAt)
              yield* failIfUnsafe(name, [...findings, ...secretFindings(cassette.metadata ?? {}, secrets)])
              // Keep in-memory storage subject to the same schema boundary as filesystem storage.
              yield* encodeCassette(cassette).pipe(Effect.mapError((error) => invalidCassette(name, error)))
              stored.set(name, cassette)
              recorded.set(name, { interactions, findings, recordedAt })
            }),
          )
        }),
        exists: Effect.fn("Cassette.memory.exists")(function* (name: string) {
          yield* validateCassetteName(name)
          return stored.has(name)
        }),
        remove: Effect.fn("Cassette.memory.remove")(function* (name: string) {
          yield* lock.withPermit(
            Effect.gen(function* () {
              yield* validateCassetteName(name)
              stored.delete(name)
              recorded.delete(name)
            }),
          )
        }),
        list: Effect.fn("Cassette.memory.list")(() => Effect.sync(() => Array.from(stored.keys()).toSorted())),
      })
    }),
  )

const nodeFileSystem = Layer.provide(fileSystem(), Layer.merge(NodeFileSystem.layer, NodePath.layer))

/** An explicit directory overrides contextual storage; otherwise use the service or the default filesystem. */
const withCassette = <A, E>(
  options: { readonly directory?: string } | undefined,
  use: (service: Interface) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    if (options?.directory === undefined) {
      const service = yield* Effect.serviceOption(Service)
      if (Option.isSome(service)) return yield* use(service.value)
    }
    const layer =
      options?.directory === undefined
        ? nodeFileSystem
        : fileSystem(options).pipe(Layer.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
    return yield* Effect.flatMap(Service, use).pipe(Effect.provide(layer))
  })

export const recordedAt = Effect.fn("Cassette.recordedAt")(function* (
  name: string,
  options?: { readonly directory?: string },
) {
  return yield* withCassette(options, (service) => service.recordedAt(name))
})
export const readCassette = Effect.fn("Cassette.readCassette")(function* (
  name: string,
  options?: { readonly directory?: string },
) {
  return yield* withCassette(options, (service) => service.readCassette(name))
})
export const hasCassette = Effect.fn("Cassette.hasCassette")(function* (
  name: string,
  options?: { readonly directory?: string },
) {
  return yield* withCassette(options, (service) => service.exists(name))
})
export const removeCassette = Effect.fn("Cassette.removeCassette")(function* (
  name: string,
  options?: { readonly directory?: string },
) {
  return yield* withCassette(options, (service) => service.remove(name))
})
