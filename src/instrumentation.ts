import type { Instrumentation } from "next";

export function register() {
  // Provider-specific exporters can be attached here without changing domain code.
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String(error.digest)
      : undefined;

  console.error("next_request_error", {
    errorName: error instanceof Error ? error.name : "UnknownError",
    digest,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
  });
};
