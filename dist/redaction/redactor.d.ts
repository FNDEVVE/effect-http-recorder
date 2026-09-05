import type { RequestSnapshot, ResponseSnapshot } from "../http/model.js";
import type { RedactOptions } from "../api.js";
export type { RedactOptions } from "../api.js";
export declare const REDACTED = "[REDACTED]";
export declare const redactUrl: (raw: string, query?: ReadonlyArray<string>, transform?: (url: string) => string) => string;
export declare const redactHeaders: (headers: Record<string, string>, allow: ReadonlyArray<string>, redact?: ReadonlyArray<string>) => {
    [k: string]: string;
};
export interface Redactor {
    readonly request: (snapshot: RequestSnapshot) => RequestSnapshot;
    readonly response: (snapshot: ResponseSnapshot) => ResponseSnapshot;
}
export declare const compose: (...redactors: ReadonlyArray<Partial<Redactor>>) => Redactor;
export declare const make: (options?: RedactOptions) => Redactor;
