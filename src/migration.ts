import { migrateAccountStoreEncryption, type SecretTextBinding } from "./mail/account-store.ts";

export const CREDENTIAL_MIGRATION_STATUS_KEY = "mail/migrations/credential-v2";

export interface CredentialMigrationEnv {
	EMAIL_KV: KVNamespace;
	CREDENTIAL_ENCRYPTION_KEY: string;
	NEXT_CREDENTIAL_ENCRYPTION_KEY: SecretTextBinding;
}

interface MigrationResult {
	count: number;
	verified: boolean;
}

interface MigrationDependencies {
	migrate: (
		kv: KVNamespace,
		oldEncryptionKey: string,
		newEncryptionKey: SecretTextBinding,
	) => Promise<MigrationResult>;
	now: () => number;
}

const defaultDependencies: MigrationDependencies = {
	migrate: migrateAccountStoreEncryption,
	now: Date.now,
};

export async function runCredentialMigration(
	env: CredentialMigrationEnv,
	dependencies: MigrationDependencies = defaultDependencies,
): Promise<MigrationResult> {
	const result = await dependencies.migrate(
		env.EMAIL_KV,
		env.CREDENTIAL_ENCRYPTION_KEY,
		env.NEXT_CREDENTIAL_ENCRYPTION_KEY,
	);
	if (!result.verified) throw new Error("Account encryption migration verification failed");

	await env.EMAIL_KV.put(
		CREDENTIAL_MIGRATION_STATUS_KEY,
		JSON.stringify({
			completedAt: new Date(dependencies.now()).toISOString(),
			count: result.count,
			verified: true,
		}),
	);
	return result;
}
