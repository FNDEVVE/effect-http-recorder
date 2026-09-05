import { Config, Effect, Exit, HashSet, Option, Ref, Scope, SynchronizedRef } from "effect"
import type { Interaction } from "../cassette/model.js"
import type * as CassetteService from "../cassette/store.js"
import type { CassetteNotFoundError, InvalidCassetteError } from "../cassette/store.js"

const isCI = Effect.gen(function* () {
  const value = yield* Config.string("CI").pipe(
    Config.option,
    Effect.orElseSucceed(() => Option.none()),
  )
  return Option.isSome(value) && value.value !== "" && value.value !== "false" && value.value !== "0"
})

export const resolveAutoMode = (
  cassette: CassetteService.Interface,
  name: string,
): Effect.Effect<"record" | "replay" | "passthrough", InvalidCassetteError> =>
  Effect.gen(function* () {
    if (yield* isCI) return "replay"
    return (yield* cassette.exists(name)) ? "replay" : "record"
  })

export interface ReplayState<T> {
  readonly claim: <E>(
    validate: (interaction: T | undefined, index: number, interactions: ReadonlyArray<T>) => Effect.Effect<void, E>,
  ) => Effect.Effect<{ readonly interaction: T; readonly index: number }, E>
}

export interface ReplayPoolState<T> {
  readonly claim: <E>(
    select: (interactions: ReadonlyArray<T>, used: HashSet.HashSet<number>) => Effect.Effect<number, E>,
  ) => Effect.Effect<{ readonly interaction: T; readonly index: number }, E>
}

export const makeReplayPoolState = <T>(
  cassette: CassetteService.Interface,
  name: string,
  project: (interactions: ReadonlyArray<Interaction>) => ReadonlyArray<T>,
): Effect.Effect<ReplayPoolState<T>, CassetteNotFoundError | InvalidCassetteError, Scope.Scope> =>
  Effect.gen(function* () {
    const interactions = project(yield* cassette.read(name))
    const claimed = yield* SynchronizedRef.make(HashSet.empty<number>())
    const attempted = yield* Ref.make(false)

    yield* Effect.addFinalizer((exit) =>
      Exit.isFailure(exit)
        ? Effect.void
        : Effect.gen(function* () {
            const used = yield* SynchronizedRef.get(claimed)
            if (HashSet.isEmpty(used) && (yield* Ref.get(attempted))) return yield* Effect.void
            if (HashSet.size(used) < interactions.length)
              return yield* Effect.die(
                new Error(
                  `Unused recorded interactions in ${name}: used ${HashSet.size(used)} of ${interactions.length}`,
                ),
              )
            return yield* Effect.void
          }),
    )

    return {
      claim: (select) =>
        Ref.set(attempted, true).pipe(
          Effect.andThen(
            SynchronizedRef.modifyEffect(claimed, (used) =>
              Effect.gen(function* () {
                const index = yield* select(interactions, used)
                const interaction = interactions[index]
                if (interaction === undefined || HashSet.has(used, index))
                  return yield* Effect.die("Replay selected an unavailable interaction")
                return [{ interaction, index }, HashSet.add(used, index)] as const
              }),
            ),
          ),
        ),
    }
  })

export const makeReplayState = <T>(
  cassette: CassetteService.Interface,
  name: string,
  project: (interactions: ReadonlyArray<Interaction>) => ReadonlyArray<T>,
): Effect.Effect<ReplayState<T>, CassetteNotFoundError | InvalidCassetteError, Scope.Scope> =>
  makeReplayPoolState(cassette, name, project).pipe(
    Effect.map((pool) => ({
      claim: (validate) =>
        pool.claim((interactions, used) => {
          const index = HashSet.size(used)
          return validate(interactions[index], index, interactions).pipe(Effect.as(index))
        }),
    })),
  )
