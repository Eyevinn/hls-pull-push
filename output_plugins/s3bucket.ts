import {
  ILocalFileUpload,
  IOutputPlugin,
  IOutputPluginDest,
  IRemoteFileDeletion,
  IRemoteFileUpload,
} from "../types/output_plugin";
import { ILogger } from "../types/index";
import fetch from "node-fetch";
import { AwsUploadModule } from "@eyevinn/iaf-plugin-aws-s3";
import { S3Client, S3 } from "@aws-sdk/client-s3";

const { AbortController } = require("abort-controller");
require("dotenv").config();

const DEFAULT_FAIL_TIMEOUT = 5 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAY = 1 * 1000;
const timer = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface IS3BucketOutputOptions {
  bucket: string;
  folder: string;
  timeoutMs?: number;
}

export interface ILocalFileUploadS3 extends ILocalFileUpload {
  contentType: string;
  folderName: string;
}

export class S3BucketOutput implements IOutputPlugin {
  createOutputDestination(opts: IS3BucketOutputOptions, logger: ILogger): IOutputPluginDest {
    // verify opts
    if (!opts.bucket || !opts.folder) {
      throw new Error("Payload Missing 'bucket' or 'folder' parameter");
    }
    return new S3BucketOutputDestination(opts, logger);
  }

  getPayloadSchema() {
    const payloadSchema = {
      type: "object",
      description: "Neccessary configuration data for S3 output",
      properties: {
        bucket: {
          description: "Name of Output S3 Bucket",
          type: "string",
        },
        folder: {
          description: "Name of Folder to Store files in, inside S3 Bucket",
          type: "string",
        },
        timeoutMs: {
          description: "Timeout for fetching source segments",
          type: "number",
        },
      },
      example: {
        bucket: "S3_BUCKET_NAME",
        folder: "S3_FOLDER_BUCKET_NAME",
        timeoutMs: 5000,
      },
      required: ["bucket", "folder"],
    };
    return payloadSchema;
  }
}

export class S3BucketOutputDestination implements IOutputPluginDest {
  private bucketName: string;
  private folderName: string;
  private failTimeoutMs: number;
  private logger: ILogger;
  private awsUploadModule: AwsUploadModule;
  private s3Client: any;
  private sessionId?: string;

  constructor(opts: IS3BucketOutputOptions, logger: ILogger) {
    this.bucketName = opts.bucket;
    this.folderName = opts.folder;
    this.failTimeoutMs = opts.timeoutMs ? opts.timeoutMs : DEFAULT_FAIL_TIMEOUT;
    this.logger = logger;
    this.awsUploadModule = new AwsUploadModule(opts.bucket, this.logger);
    this.s3Client = new S3({}) || new S3Client({});
    this.awsUploadModule.fileUploadedDelegate = (outputs) => {
      logger.info(`[${this.sessionId}]: Uploaded (${outputs["file"]}) to S3 Bucket (${this.bucketName})`);
    };
  }

  attachSessionId(id: string) {
    this.sessionId = id;
  }

  async uploadMediaPlaylist(opts: ILocalFileUpload): Promise<boolean> {
    const fileUploaderInput: ILocalFileUploadS3 = {
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
  // .-----------------.
  // | PRIVATE METHODS |
  // '-----------------'
  private async _fileUploader(opts: ILocalFileUploadS3): Promise<boolean> {
    let result: boolean;
    try {
      await this.awsUploadModule.uploader
        .upload(opts.fileData, opts.fileName, opts.folderName, opts.contentType)
        .then((res) => {
          this.awsUploadModule.fileUploadedDelegate(res);
          result = true;
        });
    } catch (err) {
      this.logger.error(
        `[${this.sessionId}]: [!] Problem occured when uploading file: '${opts.fileName}' to destination. Full Error: "${err}"`
      );
      result = false;
    }

    return result;
  }

  private async _deleteFile(fileName: string): Promise<boolean> {
    let result: boolean = false;
    const params = {
      Bucket: this.bucketName,
      Key: `${this.folderName}/${fileName}`,
    };
    return new Promise((resolve, rejects) => {
      this.s3Client.deleteObject(params, function (err: any, data: any) {
        if (err) {
          console.log(err, err.stack);
          rejects(result);
        }

        if (data && data["$metadata"]) {
          if (data["$metadata"].httpStatusCode && data["$metadata"].httpStatusCode === 204) {
            result = true;
          }
        }
        resolve(result);
      });
    });
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
          const fileUploaderInput: ILocalFileUploadS3 = {
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
}
