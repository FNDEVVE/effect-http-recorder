import { Effect, HashSet, Scope } from "effect";
import type { Interaction } from "../cassette/model.js";
import type * as CassetteService from "../cassette/store.js";
import type { CassetteNotFoundError, InvalidCassetteError } from "../cassette/store.js";
export declare const resolveAutoMode: (cassette: CassetteService.Interface, name: string) => Effect.Effect<"record" | "replay" | "passthrough", InvalidCassetteError>;
export interface ReplayState<T> {
    readonly claim: <E>(validate: (interaction: T | undefined, index: number, interactions: ReadonlyArray<T>) => Effect.Effect<void, E>) => Effect.Effect<{
        readonly interaction: T;
        readonly index: number;
    }, E>;
}
export interface ReplayPoolState<T> {
    readonly claim: <E>(select: (interactions: ReadonlyArray<T>, used: HashSet.HashSet<number>) => Effect.Effect<number, E>) => Effect.Effect<{
        readonly interaction: T;
        readonly index: number;
    }, E>;
}
export declare const makeReplayPoolState: <T>(cassette: CassetteService.Interface, name: string, project: (interactions: ReadonlyArray<Interaction>) => ReadonlyArray<T>) => Effect.Effect<ReplayPoolState<T>, CassetteNotFoundError | InvalidCassetteError, Scope.Scope>;
export declare const makeReplayState: <T>(cassette: CassetteService.Interface, name: string, project: (interactions: ReadonlyArray<Interaction>) => ReadonlyArray<T>) => Effect.Effect<ReplayState<T>, CassetteNotFoundError | InvalidCassetteError, Scope.Scope>;
