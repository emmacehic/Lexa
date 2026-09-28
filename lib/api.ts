import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { HttpError } from "./authz";
import { SetupError } from "./env";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** what the operator has to do, when the failure is a configuration one */
    hint?: string;
    detail?: unknown;
  };
}

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

/**
 * Every route handler wraps its body in this. Failures come back with a code
 * the client can branch on and a message written for a person to read — never
 * "something went wrong" (§13).
 */
export async function handle(
  fn: () => Promise<Response>,
): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json<ApiErrorBody>(
        { error: { code: error.code, message: error.message, detail: error.detail } },
        { status: error.status },
      );
    }
    if (error instanceof SetupError) {
      return NextResponse.json<ApiErrorBody>(
        {
          error: {
            code: "setup-incomplete",
            message: error.message,
            hint: error.hint,
            detail: error.variables,
          },
        },
        { status: 503 },
      );
    }
    if (error instanceof ZodError) {
      return NextResponse.json<ApiErrorBody>(
        {
          error: {
            code: "invalid-request",
            message: "The request did not match what this endpoint accepts.",
            detail: error.issues,
          },
        },
        { status: 400 },
      );
    }
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    console.error("[api]", error);
    return NextResponse.json<ApiErrorBody>(
      { error: { code: "server-error", message } },
      { status: 500 },
    );
  }
}

export async function parseBody<T>(
  request: Request,
  schema: { parse: (v: unknown) => T },
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, "invalid-json", "The request body was not valid JSON.");
  }
  return schema.parse(raw);
}
