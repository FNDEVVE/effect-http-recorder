import { Effect } from "effect";
import type * as CassetteService from "../cassette/store.js";
import type { Redactor } from "../redaction/redactor.js";
export declare const makeRecordingWebSocketConstructor: (upstream: (url: string, protocols?: string | Array<string> | undefined) => globalThis.WebSocket, cassette: CassetteService.Interface, name: string, metadata: Readonly<Record<string, import("../api.js").JsonValue>> | undefined, redactor: Redactor) => Effect.Effect<(url: string, protocols?: string | Array<string>) => globalThis.WebSocket, never, import("effect/Scope").Scope>;
export declare const makeReplayWebSocketConstructor: (cassette: CassetteService.Interface, name: string, redactor: Redactor, secrets: Record<string, string>) => Effect.Effect<(url: string, protocols?: string | Array<string>) => globalThis.WebSocket, CassetteService.CassetteNotFoundError | CassetteService.InvalidCassetteError, import("effect/Scope").Scope>;
