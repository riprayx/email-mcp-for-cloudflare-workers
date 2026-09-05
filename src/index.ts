import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { MyMCP } from "./mcp-agent";
import { handleAccessRequest, type McpOAuthEnv } from "./oauth/access-handler";

export { MyMCP } from "./mcp-agent";

export default new OAuthProvider<McpOAuthEnv>({
	apiRoute: "/mcp",
	apiHandler: MyMCP.serve("/mcp"),
	defaultHandler: { fetch: handleAccessRequest },
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
	scopesSupported: ["offline_access"],
	accessTokenTTL: 15 * 60,
	refreshTokenTTL: 90 * 24 * 60 * 60,
	clientRegistrationTTL: 90 * 24 * 60 * 60,
});