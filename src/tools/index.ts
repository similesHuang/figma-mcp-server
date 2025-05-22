import type { FigmaService } from "@/figmaService/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import getFigmaData from "./get-figma-data.js";
import downloadFigmaImages from "./download-figma-imags.js";
export default function registryTools(server: McpServer, figmaService: FigmaService) {
  [getFigmaData, downloadFigmaImages].forEach((registryFn) => {
    registryFn(server, figmaService);
  });
}
