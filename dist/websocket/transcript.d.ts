import { Effect } from "effect";
import { Socket } from "effect/unstable/socket";
import type { Redactor } from "../redaction/redactor.js";
import type { WebSocketEvent, WebSocketInteraction } from "./model.js";
export type Frame = string | Uint8Array;
export declare const socketReadError: (cause: unknown) => Socket.SocketError;
export declare const socketWriteError: (cause: unknown) => Socket.SocketError;
export declare const encodeEvent: (direction: "client" | "server", message: Frame) => WebSocketEvent;
export declare const decodeEvent: (event: WebSocketEvent) => Frame;
export declare const redactEvent: (event: WebSocketEvent, redactor: Redactor) => WebSocketEvent;
export interface ReplayTranscript {
    readonly read: Effect.Effect<Frame | undefined, Socket.SocketError>;
    readonly awaitWriteReady: Effect.Effect<void>;
    readonly write: (message: Frame | Socket.CloseEvent) => Effect.Effect<void, Socket.SocketError>;
}
export declare const makeReplayTranscript: (interaction: WebSocketInteraction, options: {
    readonly redactor: Redactor;
    readonly compareClientMessagesAsJson: boolean;
    readonly secrets: Record<string, string>;
}) => Effect.Effect<ReplayTranscript, never, never>;
