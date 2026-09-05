import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	buildCloudflareConfigs,
	writeCloudflareConfigs,
} from "../scripts/generate-cloudflare-config.mjs";

const emailNamespaceId = "a".repeat(32);
const oauthNamespaceId = "b".repeat(32);
const secretsStoreId = "c".repeat(32);
const credentialSecretName = "email-mcp-credential-encryption-key-v2";
const environment = {
	EMAIL_KV_NAMESPACE_ID: emailNamespaceId,
	OAUTH_KV_NAMESPACE_ID: oauthNamespaceId,
	SECRETS_STORE_ID: secretsStoreId,
};

const credentialBinding = {
	binding: "CREDENTIAL_ENCRYPTION_KEY",
	store_id: secretsStoreId,
	secret_name: credentialSecretName,
};

test("MCP, admin, and migration configs have separate security boundaries", () => {
	const configs = buildCloudflareConfigs(environment);

	assert.equal(configs.mcp.name, "email-mcp-server");
	assert.equal(configs.mcp.main, "src/index.ts");
	assert.equal(configs.mcp.keep_vars, true);
	assert.equal("vars" in configs.mcp, false);
	assert.deepEqual(configs.mcp.kv_namespaces, [
		{ binding: "EMAIL_KV", id: emailNamespaceId },
		{ binding: "OAUTH_KV", id: oauthNamespaceId },
	]);
	assert.deepEqual(configs.mcp.secrets_store_secrets, [credentialBinding]);
	assert.deepEqual(configs.mcp.durable_objects.bindings, [
		{ name: "MCP_OBJECT", class_name: "MyMCP" },
	]);
	assert.deepEqual(configs.mcp.secrets.required, [
		"OUTLOOK_CLIENT_SECRET",
		"ACCESS_CLIENT_ID",
		"ACCESS_CLIENT_SECRET",
		"ACCESS_TOKEN_URL",
		"ACCESS_AUTHORIZATION_URL",
		"ACCESS_JWKS_URL",
		"COOKIE_ENCRYPTION_KEY",
		"ALLOWED_EMAIL",
	]);

	assert.equal(configs.admin.name, "email-mcp-admin");
	assert.equal(configs.admin.main, "src/admin.ts");
	assert.equal(configs.admin.keep_vars, true);
	assert.equal("vars" in configs.admin, false);
	assert.deepEqual(configs.admin.kv_namespaces, [{ binding: "EMAIL_KV", id: emailNamespaceId }]);
	assert.deepEqual(configs.admin.secrets_store_secrets, [credentialBinding]);
	assert.equal("durable_objects" in configs.admin, false);
	assert.deepEqual(configs.admin.secrets.required, [
		"OUTLOOK_CLIENT_SECRET",
		"TEAM_DOMAIN",
		"POLICY_AUD",
	]);

	assert.equal(configs.migration.name, "email-mcp-server");
	assert.equal(configs.migration.main, "src/migrate-entry.ts");
	assert.equal(configs.migration.keep_vars, true);
	assert.deepEqual(configs.migration.kv_namespaces, [
		{ binding: "EMAIL_KV", id: emailNamespaceId },
	]);
	assert.deepEqual(configs.migration.secrets_store_secrets, [
		{
			binding: "NEXT_CREDENTIAL_ENCRYPTION_KEY",
			store_id: secretsStoreId,
			secret_name: credentialSecretName,
		},
	]);
	assert.deepEqual(configs.migration.triggers, { crons: ["* * * * *"] });
	assert.deepEqual(configs.migration.secrets.required, [
		"CREDENTIAL_ENCRYPTION_KEY",
		"OUTLOOK_CLIENT_SECRET",
		"TEAM_DOMAIN",
		"POLICY_AUD",
	]);
});

test("split Cloudflare config rejects missing or malformed resource IDs", () => {
	assert.throws(
		() => buildCloudflareConfigs({}),
		/EMAIL_KV_NAMESPACE_ID must be configured as a Cloudflare build secret/,
	);
	assert.throws(
		() =>
			buildCloudflareConfigs({
				EMAIL_KV_NAMESPACE_ID: emailNamespaceId,
				OAUTH_KV_NAMESPACE_ID: oauthNamespaceId,
			}),
		/SECRETS_STORE_ID must be configured as a Cloudflare build secret/,
	);
	assert.throws(
		() =>
			buildCloudflareConfigs({
				EMAIL_KV_NAMESPACE_ID: emailNamespaceId,
				OAUTH_KV_NAMESPACE_ID: oauthNamespaceId,
				SECRETS_STORE_ID: "replace-with-an-id",
			}),
		/SECRETS_STORE_ID must be a 32-character hexadecimal resource ID/,
	);
});

test("all generated Cloudflare configs are private JSON", async (context) => {
	const directory = await mkdtemp(join(tmpdir(), "email-mcp-config-"));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const mcpPath = join(directory, "wrangler.mcp.generated.json");
	const adminPath = join(directory, "wrangler.admin.generated.json");
	const migrationPath = join(directory, "wrangler.migration.generated.json");
	await writeCloudflareConfigs(environment, { mcpPath, adminPath, migrationPath });

	for (const outputPath of [mcpPath, adminPath, migrationPath]) {
		const config = JSON.parse(await readFile(outputPath, "utf8"));
		const mode = (await stat(outputPath)).mode & 0o777;
		assert.equal(config.keep_vars, true);
		assert.equal("vars" in config, false);
		assert.equal(mode, 0o600);
	}
});
