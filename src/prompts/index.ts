import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import systemDescription from "./system-description.js";
export default function registryPrompts(server: McpServer) {
  [systemDescription].forEach((registryFn) => {
    registryFn(server);
  });
}
