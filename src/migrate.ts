import { accessRejection } from "./access.ts";
import type { AccessJwtEnv } from "./access-jwt.ts";
import type { CredentialMigrationEnv } from "./migration.ts";

interface MigrationWorkerEnv extends CredentialMigrationEnv, AccessJwtEnv {
	ACCESS_LOCAL_DEV: string;
}

interface FetchHandler {
	fetch(
		request: Request,
		env: MigrationWorkerEnv,
		ctx: ExecutionContext,
	): Response | Promise<Response>;
}

interface MigrationDependencies {
	verify(token: string, env: AccessJwtEnv): Promise<unknown>;
	mcp: FetchHandler;
	admin: FetchHandler;
	migrate(env: CredentialMigrationEnv): Promise<{ count: number; verified: boolean }>;
}

export function createMigrationHandler(dependencies: MigrationDependencies) {
	return {
		async fetch(
			request: Request,
			env: MigrationWorkerEnv,
			ctx: ExecutionContext,
		): Promise<Response> {
			const rejection = await accessRejection(request, env, (token) =>
				dependencies.verify(token, env),
			);
			if (rejection) return rejection;

			const pathname = new URL(request.url).pathname;
			const handler =
				pathname === "/mcp" || pathname.startsWith("/mcp/")
					? dependencies.mcp
					: dependencies.admin;
			return handler.fetch(request, env, ctx);
		},

		scheduled(
			_controller: ScheduledController,
			env: MigrationWorkerEnv,
			ctx: ExecutionContext,
		): void {
			ctx.waitUntil(dependencies.migrate(env));
		},
	};
}
