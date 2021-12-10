import { IOutputPlugin, IOutputPluginDest } from "../types/output_plugin";
import { AuthType, createClient, WebDAVClient } from "webdav";
import winston from "winston";
const debug = require("debug")("hls-pull-push-mediapackage");
const fetch = require("node-fetch");
const { AbortController } = require("abort-controller");

const FAIL_TIMEOUT = 5 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1 * 1000;
const timer = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface IMediaPackageOutputOptions {
  ingestUrls: { url: string; username: string; password: string }[];
}

export interface IFileUploaderOptions {
  fileName: string;
  fileData: any;
}

export class MediaPackageOutput implements IOutputPlugin {
  createOutputDestination(opts: IMediaPackageOutputOptions) {
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
      description: "Neccessary configuration data associated with chosen Output Plugin type",
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
      },
      required: ["ingestUrls"],
    };
    return payloadSchema;
  }
}

export class MediaPackageOutputDestination implements IOutputPluginDest {
  ingestUrls: { url: string; username: string; password: string }[];
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
  }

  logger(logMessage: string) {
    debug(logMessage);
  }

  async _fileUploader(opts: IFileUploaderOptions): Promise<boolean> {
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

  async uploadMediaPlaylist(opts: IFileUploaderOptions): Promise<boolean> {
    const uploader = this._fileUploader.bind(this);
    try {
      let result = await uploader(opts);
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
    const uploader = this._fileUploader.bind(this);
    const fetchAndUpload = async (segURI, fileName): Promise<boolean> => {
      let RETRY_COUNT = 0;
      while (RETRY_COUNT < MAX_RETRIES) {
        RETRY_COUNT++;
        const controller = new AbortController();
        const timeout = setTimeout(() => {
          console.error(`Request Timeout for ${segURI}`);
          controller.abort();
        }, FAIL_TIMEOUT);
        try {
          const response = await fetch(segURI, { signal: controller.signal });
          if (response.status >= 200 && response.status < 300) {
            let buffer = await response.buffer();
            const uploaderOptions = {
              fileName: fileName,
              fileData: buffer,
            };
            let result = await uploader(uploaderOptions);
            return result;
          } else {
            console.error(
              `Segment Unreachable! at ${segURI}. Returned code: ${response.status}. Retries left: [${
                MAX_RETRIES - RETRY_COUNT + 1
              }]`
            );
            await timer(RETRY_DELAY);
          }
        } catch (err) {
          console.error(err);
          return false;
        } finally {
          clearTimeout(timeout);
        }
      }
      console.error(`Segment: '${fileName}' Upload Failed!`);
      return false;
    };
    try {
      const segURI = opts.segment_uri;
      const fileName = opts.file_name;
      let result = false;
      this.logger(`Going to Fetch->${segURI}, and Upload as->${fileName}`);
      result = await fetchAndUpload(segURI, fileName);
      return result;
    } catch (err) {
      console.error(err);
      throw new Error("uploadMediaSegment Failed:" + err);
    }
  }
}
