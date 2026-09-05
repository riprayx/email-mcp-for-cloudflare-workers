import assert from "node:assert/strict";
import test from "node:test";
import { handleAccessRequest, type McpOAuthEnv } from "../src/oauth/access-handler.ts";

function executionContext(): ExecutionContext {
	return {} as ExecutionContext;
}

test("async OAuth errors are converted to protocol responses", async () => {
	const form = new URLSearchParams({
		csrf_token: "form-token",
		state: "unused",
	});
	const request = new Request("https://worker.example/authorize", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: form,
	});

	const response = await handleAccessRequest(request, {} as McpOAuthEnv, executionContext());

	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), {
		error: "invalid_request",
		error_description: "Missing CSRF token cookie",
	});
});