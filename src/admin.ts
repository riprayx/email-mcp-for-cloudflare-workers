import { accessRejection } from "./access";
import { verifyAccessJwt } from "./access-jwt";
import app from "./app";
import type { MailEnv } from "./mail/types";

export default {
	async fetch(request: Request, env: MailEnv, ctx: ExecutionContext): Promise<Response> {
		const pathname = new URL(request.url).pathname;
		if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
			return new Response("Not Found", { status: 404 });
		}

		const rejection = await accessRejection(request, env, (token) =>
			verifyAccessJwt(token, env),
		);
		if (rejection) return rejection;
		return app.fetch(request, env, ctx);
	},
} satisfies ExportedHandler<MailEnv>;
