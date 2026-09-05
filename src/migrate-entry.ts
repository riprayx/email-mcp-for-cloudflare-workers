import app from "./app";
import { verifyAccessJwt } from "./access-jwt.ts";
import { MyMCP } from "./mcp-agent";
import { createMigrationHandler } from "./migrate.ts";
import { runCredentialMigration } from "./migration.ts";

export { MyMCP } from "./mcp-agent";

export default createMigrationHandler({
	verify: verifyAccessJwt,
	mcp: MyMCP.serve("/mcp"),
	admin: app,
	migrate: runCredentialMigration,
});
