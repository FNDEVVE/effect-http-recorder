import { Option } from "effect";
export declare const decodeJson: (input: unknown, options?: import("effect/SchemaAST").ParseOptions) => Option.Option<unknown>;
declare const isRecord: (value: unknown) => value is Record<string, unknown>;
export declare const canonicalizeJson: (value: unknown) => unknown;
export declare const safeText: (value: unknown, env: Record<string, string | undefined>) => string;
export declare const jsonBody: (body: string) => unknown;
export declare const isJsonRecord: typeof isRecord;
export {};
