import { HashSet } from "effect";
import type { RequestMatcher, RequestSnapshot } from "../api.js";
import type { HttpInteraction } from "./model.js";
export type { RequestMatcher } from "../api.js";
export declare const canonicalSnapshot: (snapshot: RequestSnapshot) => string;
export declare const defaultMatcher: RequestMatcher;
export declare const requestDiff: (expected: RequestSnapshot, received: RequestSnapshot, env: Record<string, string | undefined>) => ReadonlyArray<string>;
export declare const selectFirstMatching: (interactions: ReadonlyArray<HttpInteraction>, incoming: RequestSnapshot, match: RequestMatcher, used: HashSet.HashSet<number>, env: Record<string, string | undefined>) => {
    readonly _tag: "Matched";
    readonly index: number;
} | {
    readonly _tag: "Unmatched";
    readonly detail: string;
};
export * as HttpMatching from "./matching.js";
