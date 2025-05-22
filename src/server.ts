import { FigmaService } from "./figmaService/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import registryTools from "./tools/index.js";
import registryPrompts from "./prompts/index.js";

import { randomUUID } from "node:crypto";
import Koa, { Context } from "koa";
import Router from "@koa/router";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import bodyParser from "koa-bodyparser";
import { Server } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// 初始化McpServer
export const createServer = (figmaApiKey: string) => {
  const server = new McpServer({
    name: "Figma MCP Server",
    version: "0.1.0",
  });
  const figmaService = new FigmaService(figmaApiKey);
  registryTools(server, figmaService);
  registryPrompts(server);
  return server;
};

// stdio传输
export const createStdioServer = async (mcpServer: McpServer) => {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
};

// 支持http、sse传输
let httpServer: Server | null = null;

// 存储活跃连接的传输对象
const transports: {
  streamable: Record<string, StreamableHTTPServerTransport>;
  sse: Record<string, SSEServerTransport>;
} = {
  streamable: {},
  sse: {},
};

export const createHttpServer =async (port: number, mcpServer: McpServer) => {
  const app = new Koa();
  const router = new Router();

  // StreamableHttp传输
  router.post("/mcp", bodyParser(), async (ctx: Context) => {
    console.log("收到StreamableHTTP request");
    const sessionId = ctx.request.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;
    if (sessionId && transports.streamable[sessionId]) {
      console.log("Reusing existing StreamableHTTP transport for sessionId", sessionId);
    } else if (!sessionId && isInitializeRequest(ctx.request.body)) {
      console.log("New initialization request for StreamableHTTP sessionId", sessionId);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          transports.streamable[sessionId] = transport;
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          delete transports.streamable[transport.sessionId];
        }
      };
      await mcpServer.connect(transport);
    } else {
      console.log("无效的请求", ctx.request.body);
      ctx.status = 400;
      ctx.body = {
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      };
      return;
    }

    let progressInterval: NodeJS.Timeout | null = null;
    const body = ctx.request.body as { params?: { _meta?: { progressToken?: string } } };
    const progressToken = body?.params?._meta?.progressToken;
    let progress = 0;
    if (progressToken) {
      console.log(
        `Setting up progress notifications for token ${progressToken} on session ${sessionId}`,
      );
      progressInterval = setInterval(async () => {
        console.log("Sending progress notification", progress);
        await mcpServer.server.notification({
          method: "notifications/progress",
          params: {
            progress,
            progressToken,
          },
        });
        progress++;
      }, 1000);
    }

    console.log("Handling StreamableHTTP request");
    await transport.handleRequest(ctx.req, ctx.res, ctx.request.body);

    if (progressInterval) {
      clearInterval(progressInterval);
    }
    console.log("StreamableHTTP request handled");
    ctx.respond = false; // 让底层的transport处理响应
  });

  // 处理GET和DELETE请求的会话
  const handleSessionRequest = async (ctx: Context) => {
    const sessionId = ctx.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.streamable[sessionId]) {
      ctx.status = 400;
      ctx.body = "Invalid or missing session ID";
      return;
    }

    console.log(`Received session request for session ${sessionId}`);

    try {
      const transport = transports.streamable[sessionId];
      await transport.handleRequest(ctx.req, ctx.res);
      ctx.respond = false; // 让底层的transport处理响应
    } catch (error) {
      console.error("Error handling session request:", error);
      if (!ctx.headerSent) {
        ctx.status = 500;
        ctx.body = "Error processing session request";
      }
    }
  };

  router.get("/mcp", handleSessionRequest);
  router.delete("/mcp", handleSessionRequest);

  // SSE连接端点
  router.get("/sse", async (ctx: Context) => {
    console.log("Establishing new SSE connection");
    const transport = new SSEServerTransport("/messages", ctx.res);
    console.log(`New SSE connection established for sessionId ${transport.sessionId}`);

    transports.sse[transport.sessionId] = transport;
    ctx.res.on("close", () => {
      delete transports.sse[transport.sessionId];
    });

    await mcpServer.connect(transport);
    ctx.respond = false; // 让底层的transport处理响应
  });

  // SSE消息端点
  router.post("/messages", async (ctx: Context) => {
    const sessionId = ctx.query.sessionId as string;
    const transport = transports.sse[sessionId];
    if (transport) {
      console.log(`Received SSE message for sessionId ${sessionId}`);
      await transport.handlePostMessage(ctx.req, ctx.res);
      ctx.respond = false; // 让底层的transport处理响应
    } else {
      ctx.status = 400;
      ctx.body = `No transport found for sessionId ${sessionId}`;
    }
  });

  app.use(router.routes());
  // 启动服务器
  httpServer = app.listen(port, () => {
    console.log(`HTTP server listening on port ${port}`);
    console.log(`SSE endpoint available at http://localhost:${port}/sse`);
    console.log(`Message endpoint available at http://localhost:${port}/messages`);
    console.log(`StreamableHTTP endpoint available at http://localhost:${port}/mcp`);
  });

  // 处理进程终止信号
  process.on("SIGINT", async () => {
    console.log("Shutting down server...");

    // 关闭所有活跃的传输连接，清理资源
    await closeTransports(transports.sse);
    await closeTransports(transports.streamable);

    httpServer.close();
    console.log("Server shutdown complete");
    process.exit(0);
  });

  return httpServer;
};

async function closeTransports(
  transports: Record<string, SSEServerTransport | StreamableHTTPServerTransport>,
) {
  for (const sessionId in transports) {
    try {
      await transports[sessionId]?.close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
  }
}

export async function stopHttpServer(): Promise<void> {
  if (!httpServer) {
    throw new Error("HTTP server is not running");
  }

  return new Promise((resolve, reject) => {
    httpServer!.close((err: Error | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      httpServer = null;
      const closing = Object.values(transports.sse).map((transport) => {
        return transport.close();
      });
      Promise.all(closing).then(() => {
        resolve();
      });
    });
  });
}
