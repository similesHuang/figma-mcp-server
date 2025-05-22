import { getServerConfig } from "./config.js";
import { config } from "dotenv";
import { createHttpServer, createServer, createStdioServer } from "./server.js";
import { resolve } from "path";

config({path:resolve(process.cwd(),'.env')});

export const startServer  = async()=>{
  const isStdioMode = process.env.NODE_ENV === "cli" || process.argv.includes("--stdio");
  const config = getServerConfig(isStdioMode);
  const server = createServer(config.figmaApiKey);
  if(isStdioMode){
     createStdioServer(server);
  }else{
     console.log("Starting HTTP server on port", config.port);
     await createHttpServer(config.port, server);
  }
}

if (process.argv[1]) {
  startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}