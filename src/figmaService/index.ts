import fs from "fs";
import type {
  GetImagesResponse,
  GetFileResponse,
  GetFileNodesResponse,
  GetImageFillsResponse,
} from "@figma/rest-api-spec";
import yaml from "js-yaml";
import { FetchImageFillParams, FetchImageParams, FigmaError, SimplifiedDesign } from "./types.js";
import { downloadFigmaImage } from "@/utils/common.js";
import { parseFigmaResponse } from "./simpleNodeRes.js";

export class FigmaService {
  private readonly apiKey: string;
  private readonly baseUrl = "https://api.figma.com/v1";
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(endpoint: string): Promise<T> {
    if (typeof fetch !== "function") {
      throw new Error(
        "The MCP server is being run in a Node.js environment where `fetch` is not available. You won't be able to access any data related to the Figma file.\n\nAs the coding AI assistant, PLEASE ABORT THE CURRENT REQUEST. No alternate approaches will work. Help the user fix this issue so you can proceed by letting them know that they need to run the MCP server with Node.js version 18 or higher.",
      );
    }
    try {
      console.log(`Calling ${this.baseUrl}${endpoint}`);
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        headers: {
          "X-Figma-Token": this.apiKey,
        },
      });

      if (!response.ok) {
        throw {
          status: response.status,
          err: response.statusText || "Unknown error",
        } as FigmaError;
      }

      return await response.json();
    } catch (error) {
      if ((error as FigmaError).status) {
        throw error;
      }
      if (error instanceof Error) {
        throw new Error(`Failed to make request to Figma API: ${error.message}`);
      }
      throw new Error(`Failed to make request to Figma API: ${error}`);
    }
  }

  getImageFills = async (
    fileKey: string,
    nodes: FetchImageFillParams[],
    localPath: string,
  ): Promise<string[]> => {
    if (nodes.length === 0) return [];

    let promises: Promise<string>[] = [];
    const endpoint = `/files/${fileKey}/images`;
    const file = await this.request<GetImageFillsResponse>(endpoint);
    const { images = {} } = file.meta;
    promises = nodes.map(async ({ imageRef, fileName }) => {
      const imageUrl = images[imageRef];
      if (!imageUrl) {
        return "";
      }
      return downloadFigmaImage(fileName, localPath, imageUrl);
    });
    return Promise.all(promises);
  };

  getImages = async (
    fileKey: string,
    nodes: FetchImageParams[],
    localPath: string,
  ): Promise<(string | false)[]> => {
    const pngIds = nodes.filter(({ fileType }) => fileType === "png").map(({ nodeId }) => nodeId);
    const pngFiles =
      pngIds.length > 0
        ? this.request<GetImagesResponse>(
            `/images/${fileKey}?ids=${pngIds.join(",")}&scale=2&format=png`,
          ).then(({ images = {} }) => images)
        : ({} as GetImagesResponse["images"]);

    const svgIds = nodes.filter(({ fileType }) => fileType === "svg").map(({ nodeId }) => nodeId);
    const svgFiles =
      svgIds.length > 0
        ? this.request<GetImagesResponse>(
            `/images/${fileKey}?ids=${svgIds.join(",")}&format=svg`,
          ).then(({ images = {} }) => images)
        : ({} as GetImagesResponse["images"]);

    const files = await Promise.all([pngFiles, svgFiles]).then(([f, l]) => ({ ...f, ...l }));

    const downloads = nodes
      .map(({ nodeId, fileName }) => {
        const imageUrl = files[nodeId];
        if (imageUrl) {
          return downloadFigmaImage(fileName, localPath, imageUrl);
        }
        return false;
      })
      .filter((url) => !!url);

    return Promise.all(downloads);
  };

  getFile = async (fileKey: string, depth?: number | null): Promise<SimplifiedDesign> => {
    try {
      const endpoint = `/files/${fileKey}${depth ? `?depth=${depth}` : ""}`;
      console.log(`Retrieving Figma file: ${fileKey} (depth: ${depth ?? "default"})`);
      const response = await this.request<GetFileResponse>(endpoint);
      console.log("Got response");
      const simplifiedResponse = parseFigmaResponse(response);
      writeLogs("figma-raw.yml", response);
      writeLogs("figma-simplified.yml", simplifiedResponse);
      return simplifiedResponse;
    } catch (e) {
      console.error("Failed to get file:", e);
      throw e;
    }
  };

  getNode = async (
    fileKey: string,
    nodeId: string,
    depth?: number | null,
  ): Promise<SimplifiedDesign> => {
    const endpoint = `/files/${fileKey}/nodes?ids=${nodeId}${depth ? `&depth=${depth}` : ""}`;
    const response = await this.request<GetFileNodesResponse>(endpoint);
    console.log("Got response from getNode, now parsing.");
    writeLogs("figma-raw.yml", response);
    const simplifiedResponse = parseFigmaResponse(response);
    writeLogs("figma-simplified.yml", simplifiedResponse);
    return simplifiedResponse;
  };
}

const writeLogs = (name: string, value: any) => {
  try {
    if (process.env.NODE_ENV !== "development") return;

    const logsDir = "logs";

    try {
      fs.accessSync(process.cwd(), fs.constants.W_OK);
    } catch (error) {
      console.log("Failed to write logs:", error);
      return;
    }

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir);
    }
    fs.writeFileSync(`${logsDir}/${name}`, yaml.dump(value));
  } catch (error) {
    console.debug("Failed to write logs:", error);
  }
};
