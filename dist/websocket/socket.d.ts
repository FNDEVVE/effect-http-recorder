import { Effect } from "effect";
import { Socket } from "effect/unstable/socket";
import type { SocketRecorderOptions } from "../api.js";
import * as CassetteService from "../cassette/store.js";
import type { Redactor } from "../redaction/redactor.js";
export interface WebSocketRecorderOptions extends SocketRecorderOptions {
    readonly compareClientMessagesAsJson?: boolean;
}
export declare const makeRecordingSocket: (upstream: Socket.Socket, cassette: CassetteService.Interface, name: string, options: WebSocketRecorderOptions, redactor: Redactor) => Effect.Effect<Socket.Socket, never, never>;
export declare const makeReplaySocket: (cassette: CassetteService.Interface, name: string, options: WebSocketRecorderOptions, redactor: Redactor, secrets: Record<string, string>) => Effect.Effect<Socket.Socket, CassetteService.CassetteNotFoundError | CassetteService.InvalidCassetteError, import("effect/Scope").Scope>;
