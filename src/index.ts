import { accessRejection } from "./access";
import { verifyAccessJwt } from "./access-jwt";
import app from "./app";
import type { MailEnv } from "./mail/types";
import { MyMCP } from "./mcp-agent";

export { MyMCP } from "./mcp-agent";

const mcpHandler = MyMCP.serve("/mcp");

export default {
	async fetch(request: Request, env: MailEnv, ctx: ExecutionContext): Promise<Response> {
		const rejection = await accessRejection(request, env, (token) =>
			verifyAccessJwt(token, env),
		);
		if (rejection) return rejection;

		const pathname = new URL(request.url).pathname;
		return pathname === "/mcp" || pathname.startsWith("/mcp/")
			? mcpHandler.fetch(request, env, ctx)
			: app.fetch(request, env, ctx);
	},
} satisfies ExportedHandler<MailEnv>;
