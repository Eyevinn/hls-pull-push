import { IOutputPlugin, IOutputPluginDest } from "../types/output_plugin";
import { AuthType, createClient, WebDAVClient } from "webdav";
import fetch from "node-fetch";
import Debug from "debug";

const debug = Debug("hls-pull-push-mediapackage");
const { AbortController } = require("abort-controller");

const DEFAULT_FAIL_TIMEOUT = 5 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1 * 1000;
const timer = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

interface IMediaPackageIngestUrl {
  url: string;
  username: string;
  password: string;
}

export interface IMediaPackageOutputOptions {
  ingestUrls: IMediaPackageIngestUrl[];
  timeoutMs?: number;
}

export interface IFileUploaderOptions {
  fileName: string;
  fileData: any;
}

export class MediaPackageOutput implements IOutputPlugin {
  createOutputDestination(opts: IMediaPackageOutputOptions): IOutputPluginDest {
    // verify opts
    if (!opts.ingestUrls) {
      throw new Error("Payload Missing 'ingestUrls' parameter");
    } else {
      opts.ingestUrls.forEach((ingestUrl) => {
        try {
          let validUrl = new URL(ingestUrl.url);
          if (!ingestUrl.username || !ingestUrl.password) {
            throw new Error("Payload parameter 'ingestUrls' missing 'username' or 'password' fields");
          }
        } catch (err) {
          throw new Error("Payload parameter 'ingestUrls' contains an Invalid URL");
        }
      });
    }

    return new MediaPackageOutputDestination(opts);
  }

  getPayloadSchema() {
    const payloadSchema = {
      type: "object",
      description: "Neccessary configuration data for MediaPackage output",
      properties: {
        ingestUrls: {
          description: "On success returns an array of active pull-push sessions",
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "url to ingest endpoint" },
              username: { type: "string", description: "webDAV credentials username" },
              password: { type: "string", description: "webDAV credentials password" },
            },
            example: {
              url: "https://xxxxx.mediapackage.xxxxx.amazonaws.com/in/v2/xxxxx/xxxxx/channel",
              username: "********************************",
              password: "********************************",
            },
            required: ["url", "username", "password"],
          },
        },
        timeoutMs: {
          description: "Timeout for fetching source segments",
          type: "number",
        },
      },
      required: ["ingestUrls"],
    };
    return payloadSchema;
  }
}

export class MediaPackageOutputDestination implements IOutputPluginDest {
  private ingestUrls: IMediaPackageIngestUrl[];
  private failTimeoutMs: number;
  webDAVClients: WebDAVClient[];

  constructor(opts: IMediaPackageOutputOptions) {
    this.webDAVClients = [];
    this.ingestUrls = opts.ingestUrls;
    this.ingestUrls.forEach((ingestUrl) => {
      const client = createClient(ingestUrl.url.replace("/channel", ""), {
        username: ingestUrl.username,
        password: ingestUrl.password,
        authType: AuthType.Digest,
      });
      this.webDAVClients.push(client);
    });
    this.failTimeoutMs = opts.timeoutMs ? opts.timeoutMs : DEFAULT_FAIL_TIMEOUT;
  }

  private async _fileUploader(opts: IFileUploaderOptions): Promise<boolean> {
    let result;
    // For each client/ingestUrl
    for (let i = 0; i < this.webDAVClients.length; i++) {
      const client = this.webDAVClients[i];
      try {
        // Try Upload manifest
        result = await client.putFileContents(opts.fileName, opts.fileData, {
          overwrite: true,
        });
        // Log Results
        if (!result) {
          this.logger(
            `Upload Failed! WebDAV Client [${i + 1}/${this.webDAVClients.length}] did not PUT '${
              opts.fileName
            }' to MediaPackage Channel with username: ${this.ingestUrls[i].username}`
          );
        } else {
          this.logger(
            `Upload Successful! WebDAV Client [${i + 1}/${this.webDAVClients.length}] PUT '${
              opts.fileName
            }' to MediaPackage Channel with username: ${this.ingestUrls[i].username}`
          );
        }
      } catch (e) {
        throw new Error(`[!]: Problem Occured when Putting Files to Destination: "${e.message}"`);
      }
    }

    return result;
  }

  private async _fetchAndUpload(segURI: string, fileName: string, failTimeoutMs: number): Promise<boolean> {
    let retryCount = 0;
    while (retryCount < MAX_RETRIES) {
      retryCount++;
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, failTimeoutMs);
      try {
        const response = await fetch(segURI, { signal: controller.signal });
        if (response.status >= 200 && response.status < 300) {
          let buffer = await response.buffer();
          const uploaderOptions = {
            fileName: fileName,
            fileData: buffer,
          };
          clearTimeout(timeout);
          let result = await this._fileUploader(uploaderOptions);
          return result;
        } else {
          console.error(
            `Segment Unreachable! at ${segURI}. Returned code: ${response.status}. Retries left: [${
              MAX_RETRIES - retryCount + 1
            }]`
          );
          await timer(RETRY_DELAY);
        }
      } catch (err) {
        if (err.type === "aborted") {
          console.error(`Request Timeout for fetching (${failTimeoutMs}ms) ${segURI} (${retryCount})`);
        } else {
          console.error(err);
        }
        return false;
      } finally {
        clearTimeout(timeout);
      }
    }
    console.error(`Segment: '${fileName}' Upload Failed!`);
    return false;
  }

  logger(logMessage: string) {
    debug(logMessage);
  }

  async uploadMediaPlaylist(opts: IFileUploaderOptions): Promise<boolean> {
    try {
      let result = await this._fileUploader(opts);
      if (!result) {
        this.logger(`[!]: Manifest (${opts.fileName}) Failed to upload!`);
      }
      return result;
    } catch (err) {
      console.error(err);
      throw new Error("uploadMediaPlaylist Failed:" + err);
    }
  }

  async uploadMediaSegment(opts: any): Promise<boolean> {
    try {
      const segURI = opts.segment_uri;
      const fileName = opts.file_name;
      let result = false;
      this.logger(`Going to Fetch->${segURI}, and Upload as->${fileName}`);
      result = await this._fetchAndUpload(segURI, fileName, this.failTimeoutMs);
      return result;
    } catch (err) {
      console.error(err);
      throw new Error("uploadMediaSegment Failed:" + err);
    }
  }
}
