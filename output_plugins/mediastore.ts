import { ILogger } from '../types';
import { ILocalFileUpload, IOutputPlugin, IOutputPluginDest, IRemoteFileDeletion, IRemoteFileUpload } from '../types/output_plugin';
import { DeleteObjectCommand, MediaStoreDataClient, PutObjectCommand } from '@aws-sdk/client-mediastore-data';
import fetch from "node-fetch";

const { AbortController } = require("abort-controller");

const DEFAULT_FAIL_TIMEOUT = 5 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1 * 1000;
const timer = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface IMediaStoreOutputOptions {
  dataEndpoint: string;
  folder?: string;
  timeoutMs?: number;
}

export interface ILocalFileUploadMediaStore extends ILocalFileUpload {
  folderName?: string;
  contentType: string;
}

export class MediaStoreOutput implements IOutputPlugin<IMediaStoreOutputOptions> {
  createOutputDestination(opts: IMediaStoreOutputOptions, logger: ILogger): IOutputPluginDest {
    return new MediaStoreOutputDestination(opts, logger);
  }

  getPayloadSchema() {
    const payloadSchema = {
      type: "object",
      description: "Neccessary configuration data for MediaStore output",
      properties: {
        container: {
          description: "Name of MediaStore container",
          type: "string",
        },
        folder: {
          description: "Name of Folder to Store files in, inside container",
          type: "string",
        },
        endpoint: {
          description: "Data endpoint for uploading",
          type: "string",
        }
      },
      example: {
        container: "MEDIA_STORE_CONTAINER_NAME",
        endpoint: "MEDIA_STORE_DATA_ENDPOINT"
      },
      required: ["container", "endpoint"],
    };
    return payloadSchema;    
  }
}

export class MediaStoreOutputDestination implements IOutputPluginDest {
  private logger: ILogger;
  private mediaStoreClient: MediaStoreDataClient;
  private folderName: string;
  private failTimeoutMs: number;
  private sessionId?: string;

  constructor(opts: IMediaStoreOutputOptions, logger: ILogger) {
    this.logger = logger;
    this.folderName = opts.folder || '';
    this.mediaStoreClient = new MediaStoreDataClient({ endpoint: opts.dataEndpoint });
    this.failTimeoutMs = opts.timeoutMs ? opts.timeoutMs : DEFAULT_FAIL_TIMEOUT;
  }

  attachSessionId(id: string) {
    this.sessionId = id;
  }

  async uploadMediaPlaylist(opts: ILocalFileUpload): Promise<boolean> {
    const fileUploaderInput: ILocalFileUploadMediaStore = {
      fileData: opts.fileData,
      fileName: opts.fileName,
      folderName: this.folderName,
      contentType: "application/vnd.apple.mpegurl",
    };    
    try {
      let result = await this._fileUploader(fileUploaderInput);
      if (!result) {
        this.logger.error(`(${this.sessionId}) [!]: Manifest (${opts.fileName}) Failed to upload!`);
      }
      return result;      
    } catch (err) {
      this.logger.error(err);
      throw new Error("uploadMediaPlaylist Failed:" + err);
    }
  }

  async uploadMediaSegment(opts: IRemoteFileUpload): Promise<boolean> {
    try {
      if (opts.uri) {
        const segURI = opts.uri;
        const fileName = opts.fileName;
        this.logger.verbose(`(${this.sessionId}) Going to Fetch->${segURI}, and Upload as->${fileName}`);
        const result = await this._fetchAndUpload(segURI, fileName, this.failTimeoutMs);
        return result;
      } else {
        throw new Error("plugin only supports fetching remote files");
      }
    } catch (err) {
      this.logger.error(err);
      throw new Error("uploadMediaSegment Failed:" + err);
    }
  }

  async deleteMediaSegment(opts: IRemoteFileDeletion): Promise<boolean> {
    try {
      if (opts.fileName) {
        const result = await this._deleteFile(opts.fileName);
        this.logger.verbose(
          `(${this.sessionId}) File Deletion '${opts.fileName}' ${result ? "successful" : "failed"}`
        );
        return result;
      } else {
        throw new Error("plugin requires 'fileName' option");
      }
    } catch (err) {
      this.logger.error(err);
      throw new Error("deleteMediaSegment Failed:" + err);
    }
  }  

  private async _fileUploader(opts: ILocalFileUploadMediaStore): Promise<boolean> {
    let result: boolean;
    try {
      const command = new PutObjectCommand({
        Body: opts.fileData,
        Path: `${opts.folderName}/${opts.fileName}`,
        ContentType: opts.contentType,
        StorageClass: 'TEMPORAL'
      });
      const response = await this.mediaStoreClient.send(command);
      this.logger.verbose(`[${this.sessionId}]: Uploaded file: ${opts.folderName}/${opts.fileName}`);
      result = true;
    } catch (err) {
      this.logger.error(
        `[${this.sessionId}]: [!] Problem occured when uploading file: '${opts.folderName}/${opts.fileName}' to destination: ` + err.$response.reason
      );
      result = false;
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
          const buffer = await response.buffer();
          // Determine content type based on file extension
          let contentType: string;
          if (fileName.match(/.ts$/)) {
            contentType = "video/MP2T";
          } else if (fileName.match(/.m4s$/)) {
            contentType = "video/iso.segment";
          } else if (fileName.match(/.mp4$/)) {
            contentType = "video/mp4";
          } else if (fileName.match(/.vtt$/)) {
            // Assume Subtitle file
            contentType = "text/vtt";
          } else {
            contentType = "application/octet-stream";
          }
          const fileUploaderInput: ILocalFileUploadMediaStore = {
            fileData: buffer,
            fileName: fileName,
            folderName: this.folderName,
            contentType: contentType,
          };
          clearTimeout(timeout);
          const result = await this._fileUploader(fileUploaderInput);
          return result;
        } else {
          this.logger.error(
            `(${this.sessionId}) Segment Unreachable! at ${segURI}. Returned code: ${
              response.status
            }. Retries left: [${MAX_RETRIES - retryCount + 1}]`
          );
          await timer(RETRY_DELAY);
        }
      } catch (err) {
        if (err.type === "aborted") {
          this.logger.error(
            `(${this.sessionId}) Request Timeout for fetching (${failTimeoutMs}ms) ${segURI} (${retryCount})`
          );
        } else {
          this.logger.error(err);
        }
        return false;
      } finally {
        clearTimeout(timeout);
      }
    }
    this.logger.error(`(${this.sessionId}) Segment: '${fileName}' Upload Failed!`);
    return false;
  }

  private async _deleteFile(fileName: string): Promise<boolean> {
    let result: boolean = false;
    try {
      const command = new DeleteObjectCommand({
        Path: `${this.folderName}/${fileName}`
      });
      const response = await this.mediaStoreClient.send(command);
      this.logger.verbose(`[${this.sessionId}]: Deleted file: ${fileName}`);
      result = true;
    } catch (err) {
      this.logger.error(
        `[${this.sessionId}]: [!] Problem occured when deleting file: '${fileName}': ` + err.$response.reason
      );
      result = false;
    }

    return result;
  }  
}