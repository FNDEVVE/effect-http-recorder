import { Layer } from "effect";
import { Socket } from "effect/unstable/socket";
import type { SocketRecorderOptions } from "../api.js";
import * as CassetteService from "../cassette/store.js";
/**
 * Wraps a provided `Socket.Socket` with cassette recording and replay.
 *
 * Supply the ordinary URL-bound Effect socket layer beneath this decorator.
 * The cassette name identifies the connection during replay; recorder
 * configuration does not duplicate or validate the transport URL.
 *
 * A recording is committed only after the socket run completes successfully.
 * Replay releases server frames in order and waits at each recorded client
 * frame until the application writes a matching frame.
 */
export declare const layerSocket: (name: string, options?: SocketRecorderOptions) => Layer.Layer<Socket.Socket, CassetteService.CassetteNotFoundError | CassetteService.InvalidCassetteError, Socket.Socket>;
/** Decorates Effect's WebSocket constructor so dynamic connections are recorded and replayed. */
export declare const layerWebSocketConstructor: (name: string, options?: SocketRecorderOptions) => Layer.Layer<Socket.WebSocketConstructor, CassetteService.CassetteNotFoundError | CassetteService.InvalidCassetteError, Socket.WebSocketConstructor>;
