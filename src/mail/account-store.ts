import { decrypt, encrypt } from "../crypto.ts";
import { preserveAccountMetadata, type MailAccount } from "./types.ts";

export const ACCOUNT_STORAGE_KEY_V1 = "mail/accounts/v1";
export const ACCOUNT_STORAGE_KEY_V2 = "mail/accounts/v2";

export interface SecretTextBinding {
	get(): Promise<string>;
}

export type EncryptionKeySource = string | SecretTextBinding;

async function resolveEncryptionKey(source: EncryptionKeySource): Promise<string> {
	const value = typeof source === "string" ? source : await source.get();
	if (!value?.trim()) throw new Error("CREDENTIAL_ENCRYPTION_KEY is not configured");
	return value;
}

async function readAccounts(
	kv: KVNamespace,
	storageKey: string,
	encryptionKey: string,
): Promise<MailAccount[]> {
	const encoded = await kv.get(storageKey, "arrayBuffer");
	if (!encoded) return [];
	const plaintext = await decrypt(encoded, encryptionKey);
	const parsed = JSON.parse(new TextDecoder().decode(plaintext));
	if (!Array.isArray(parsed)) throw new Error("Stored account data is invalid");
	return parsed as MailAccount[];
}

async function writeAccounts(
	kv: KVNamespace,
	storageKey: string,
	encryptionKey: string,
	accounts: MailAccount[],
): Promise<void> {
	const plaintext = new TextEncoder().encode(JSON.stringify(accounts));
	await kv.put(storageKey, await encrypt(plaintext, encryptionKey));
}

export async function migrateAccountStoreEncryption(
	kv: KVNamespace,
	oldEncryptionKey: EncryptionKeySource,
	newEncryptionKey: EncryptionKeySource,
): Promise<{ count: number; verified: boolean }> {
	const [oldKey, newKey] = await Promise.all([
		resolveEncryptionKey(oldEncryptionKey),
		resolveEncryptionKey(newEncryptionKey),
	]);
	const accounts = await readAccounts(kv, ACCOUNT_STORAGE_KEY_V1, oldKey);
	await writeAccounts(kv, ACCOUNT_STORAGE_KEY_V2, newKey, accounts);

	const verifiedAccounts = await readAccounts(kv, ACCOUNT_STORAGE_KEY_V2, newKey);
	const verified = JSON.stringify(verifiedAccounts) === JSON.stringify(accounts);
	if (!verified) throw new Error("Account encryption migration verification failed");
	return { count: accounts.length, verified };
}

export class AccountStore {
	private kv: KVNamespace;
	private encryptionKey: EncryptionKeySource;
	private storageKey: string;

	constructor(kv: KVNamespace, encryptionKey: EncryptionKeySource) {
		this.kv = kv;
		this.encryptionKey = encryptionKey;
		this.storageKey =
			typeof encryptionKey === "string" ? ACCOUNT_STORAGE_KEY_V1 : ACCOUNT_STORAGE_KEY_V2;
	}

	async list(): Promise<MailAccount[]> {
		return readAccounts(
			this.kv,
			this.storageKey,
			await resolveEncryptionKey(this.encryptionKey),
		);
	}

	async get(id?: string): Promise<MailAccount> {
		const accounts = await this.list();
		if (id) {
			const account = accounts.find((candidate) => candidate.id === id);
			if (!account) throw new Error(`Account ${id} not found`);
			return account;
		}
		if (accounts.length === 1) return accounts[0];
		if (accounts.length === 0) throw new Error("No email accounts configured");
		throw new Error("Multiple accounts configured; accountId is required");
	}

	async add(account: Omit<MailAccount, "id">): Promise<MailAccount> {
		const accounts = await this.list();
		const created = { ...account, id: crypto.randomUUID() };
		accounts.push(created);
		await this.save(accounts);
		return created;
	}

	async update(account: MailAccount): Promise<void> {
		const accounts = await this.list();
		const index = accounts.findIndex((candidate) => candidate.id === account.id);
		if (index < 0) throw new Error(`Account ${account.id} not found`);
		accounts[index] = preserveAccountMetadata(accounts[index], account);
		await this.save(accounts);
	}

	async remove(id: string): Promise<void> {
		const accounts = await this.list();
		const remaining = accounts.filter((account) => account.id !== id);
		if (remaining.length === accounts.length) throw new Error(`Account ${id} not found`);
		await this.save(remaining);
	}

	private async save(accounts: MailAccount[]): Promise<void> {
		await writeAccounts(
			this.kv,
			this.storageKey,
			await resolveEncryptionKey(this.encryptionKey),
			accounts,
		);
	}
}
