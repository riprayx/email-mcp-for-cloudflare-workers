import { writeFile } from "node:fs/promises";

export const generatedMcpConfigPath = "wrangler.mcp.generated.json";
export const generatedAdminConfigPath = "wrangler.admin.generated.json";
export const generatedMigrationConfigPath = "wrangler.migration.generated.json";
export const credentialEncryptionSecretName = "email-mcp-credential-encryption-key-v2";

const sharedConfig = {
	$schema: "node_modules/wrangler/config-schema.json",
	compatibility_date: "2026-06-14",
	compatibility_flags: ["nodejs_compat"],
	keep_vars: true,
	observability: {
		enabled: true,
	},
};

const durableObjectConfig = {
	migrations: [
		{
			tag: "v1",
			new_sqlite_classes: ["MyMCP"],
		},
	],
	durable_objects: {
		bindings: [
			{
				name: "MCP_OBJECT",
				class_name: "MyMCP",
			},
		],
	},
};

function namespaceId(environment, name) {
	const value = environment[name]?.trim();
	if (!value) throw new Error(`${name} must be configured as a Cloudflare build secret`);
	if (!/^[a-f0-9]{32}$/i.test(value))
		throw new Error(`${name} must be a 32-character hexadecimal namespace ID`);
	return value;
}

function resourceId(environment, name) {
	const value = environment[name]?.trim();
	if (!value) throw new Error(`${name} must be configured as a Cloudflare build secret`);
	if (!/^[a-f0-9]{32}$/i.test(value))
		throw new Error(`${name} must be a 32-character hexadecimal resource ID`);
	return value;
}

function credentialEncryptionBinding(secretsStoreId, binding = "CREDENTIAL_ENCRYPTION_KEY") {
	return {
		binding,
		store_id: secretsStoreId,
		secret_name: credentialEncryptionSecretName,
	};
}

export function buildCloudflareConfigs(environment = process.env) {
	const emailKvNamespaceId = namespaceId(environment, "EMAIL_KV_NAMESPACE_ID");
	const oauthKvNamespaceId = namespaceId(environment, "OAUTH_KV_NAMESPACE_ID");
	const secretsStoreId = resourceId(environment, "SECRETS_STORE_ID");

	const mcp = {
		...sharedConfig,
		...durableObjectConfig,
		name: "email-mcp-server",
		main: "src/index.ts",
		secrets: {
			required: [
				"OUTLOOK_CLIENT_SECRET",
				"ACCESS_CLIENT_ID",
				"ACCESS_CLIENT_SECRET",
				"ACCESS_TOKEN_URL",
				"ACCESS_AUTHORIZATION_URL",
				"ACCESS_JWKS_URL",
				"COOKIE_ENCRYPTION_KEY",
				"ALLOWED_EMAIL",
			],
		},
		secrets_store_secrets: [credentialEncryptionBinding(secretsStoreId)],
		kv_namespaces: [
			{ binding: "EMAIL_KV", id: emailKvNamespaceId },
			{ binding: "OAUTH_KV", id: oauthKvNamespaceId },
		],
	};

	const admin = {
		...sharedConfig,
		name: "email-mcp-admin",
		main: "src/admin.ts",
		secrets: {
			required: ["OUTLOOK_CLIENT_SECRET", "TEAM_DOMAIN", "POLICY_AUD"],
		},
		secrets_store_secrets: [credentialEncryptionBinding(secretsStoreId)],
		kv_namespaces: [{ binding: "EMAIL_KV", id: emailKvNamespaceId }],
	};

	const migration = {
		...sharedConfig,
		...durableObjectConfig,
		name: "email-mcp-server",
		main: "src/migrate-entry.ts",
		secrets: {
			required: [
				"CREDENTIAL_ENCRYPTION_KEY",
				"OUTLOOK_CLIENT_SECRET",
				"TEAM_DOMAIN",
				"POLICY_AUD",
			],
		},
		secrets_store_secrets: [
			credentialEncryptionBinding(secretsStoreId, "NEXT_CREDENTIAL_ENCRYPTION_KEY"),
		],
		kv_namespaces: [{ binding: "EMAIL_KV", id: emailKvNamespaceId }],
		triggers: {
			crons: ["* * * * *"],
		},
	};

	return { mcp, admin, migration };
}

export async function writeCloudflareConfigs(
	environment = process.env,
	paths = {
		mcpPath: generatedMcpConfigPath,
		adminPath: generatedAdminConfigPath,
		migrationPath: generatedMigrationConfigPath,
	},
) {
	const configs = buildCloudflareConfigs(environment);
	await Promise.all([
		writeFile(paths.mcpPath, `${JSON.stringify(configs.mcp, null, 2)}\n`, { mode: 0o600 }),
		writeFile(paths.adminPath, `${JSON.stringify(configs.admin, null, 2)}\n`, { mode: 0o600 }),
		writeFile(paths.migrationPath, `${JSON.stringify(configs.migration, null, 2)}\n`, {
			mode: 0o600,
		}),
	]);
	return paths;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
	const paths = await writeCloudflareConfigs();
	console.log(
		`Generated private Cloudflare deployment configurations at ${paths.mcpPath}, ${paths.adminPath}, and ${paths.migrationPath}`,
	);
}
