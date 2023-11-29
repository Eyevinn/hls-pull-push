import {
  ILocalFileUpload,
  IOutputPlugin,
  IOutputPluginDest,
  IRemoteFileUpload
} from './interface';
import { AuthType, createClient, WebDAVClient } from 'webdav';
import fetch from 'node-fetch';
import { AbortController } from 'abort-controller';
import { ILogger } from '../logger';

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

export class MediaPackageOutput
  implements IOutputPlugin<IMediaPackageOutputOptions>
{
  createOutputDestination(
    opts: IMediaPackageOutputOptions,
    logger: ILogger
  ): IOutputPluginDest {
    // verify opts
    if (!opts.ingestUrls) {
      throw new Error("Payload Missing 'ingestUrls' parameter");
    } else {
      opts.ingestUrls.forEach((ingestUrl) => {
        try {
          const validUrl = new URL(ingestUrl.url);
          if (!ingestUrl.username || !ingestUrl.password) {
            throw new Error(
              "Payload parameter 'ingestUrls' missing 'username' or 'password' fields"
            );
          }
        } catch (err) {
          throw new Error(
            "Payload parameter 'ingestUrls' contains an Invalid URL"
          );
        }
      });
    }

    return new MediaPackageOutputDestination(opts, logger);
  }

  getPayloadSchema() {
    const payloadSchema = {
      type: 'object',
      description: 'Neccessary configuration data for MediaPackage output',
      properties: {
        ingestUrls: {
          description:
            'On success returns an array of active pull-push sessions',
          type: 'array',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'url to ingest endpoint' },
              username: {
                type: 'string',
                description: 'webDAV credentials username'
              },
              password: {
                type: 'string',
                description: 'webDAV credentials password'
              }
            },
            example: {
              url: 'https://xxxxx.mediapackage.xxxxx.amazonaws.com/in/v2/xxxxx/xxxxx/channel',
              username: '********************************',
              password: '********************************'
            },
            required: ['url', 'username', 'password']
          }
        },
        timeoutMs: {
          description: 'Timeout for fetching source segments',
          type: 'number',
          example: 5000
        }
      },
      required: ['ingestUrls']
    };
    return payloadSchema;
  }
}

export class MediaPackageOutputDestination implements IOutputPluginDest {
  private ingestUrls: IMediaPackageIngestUrl[];
  private failTimeoutMs: number;
  private logger: ILogger;
  webDAVClients: WebDAVClient[];
  private sessionId?: string;

  constructor(opts: IMediaPackageOutputOptions, logger: ILogger) {
    this.webDAVClients = [];
    this.ingestUrls = opts.ingestUrls;
    this.ingestUrls.forEach((ingestUrl) => {
      const client = createClient(ingestUrl.url.replace('/channel', ''), {
        username: ingestUrl.username,
        password: ingestUrl.password,
        authType: AuthType.Digest
      });
      this.webDAVClients.push(client);
    });
    this.failTimeoutMs = opts.timeoutMs ? opts.timeoutMs : DEFAULT_FAIL_TIMEOUT;
    this.logger = logger;
  }

  private async _fileUploader(opts: ILocalFileUpload): Promise<boolean> {
    let result;
    // For each client/ingestUrl
    for (let i = 0; i < this.webDAVClients.length; i++) {
      const client = this.webDAVClients[i];
      try {
        // Try Upload manifest
        result = await client.putFileContents(opts.fileName, opts.fileData, {
          overwrite: true
        });
        // Log Results
        if (!result) {
          this.logger.error(
            `(${this.sessionId}) Upload Failed! WebDAV Client [${i + 1}/${
              this.webDAVClients.length
            }] did not PUT '${
              opts.fileName
            }' to MediaPackage Channel with username: ${
              this.ingestUrls[i].username
            }`
          );
        } else {
          this.logger.verbose(
            `(${this.sessionId}) Upload Successful! WebDAV Client [${i + 1}/${
              this.webDAVClients.length
            }] PUT '${opts.fileName}' to MediaPackage Channel with username: ${
              this.ingestUrls[i].username
            }`
          );
        }
      } catch (e) {
        throw new Error(
          `[!]: Problem Occured when Putting Files to Destination: "${e.message}"`
        );
      }
    }

    return result;
  }

  private async _fetchAndUpload(
    segURI: string,
    fileName: string,
    failTimeoutMs: number
  ): Promise<boolean> {
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
          const uploaderOptions = {
            fileName: fileName,
            fileData: buffer
          };
          clearTimeout(timeout);
          const result = await this._fileUploader(uploaderOptions);
          return result;
        } else {
          this.logger.error(
            `(${
              this.sessionId
            }) Segment Unreachable! at ${segURI}. Returned code: ${
              response.status
            }. Retries left: [${MAX_RETRIES - retryCount + 1}]`
          );
          await timer(RETRY_DELAY);
        }
      } catch (err) {
        if (err.type === 'aborted') {
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
    this.logger.error(
      `(${this.sessionId}) Segment: '${fileName}' Upload Failed!`
    );
    return false;
  }

  attachSessionId(id: string) {
    this.sessionId = id;
  }

  async uploadMediaPlaylist(opts: ILocalFileUpload): Promise<boolean> {
    try {
      const result = await this._fileUploader(opts);
      if (!result) {
        this.logger.error(
          `(${this.sessionId}) [!]: Manifest (${opts.fileName}) Failed to upload!`
        );
      }
      return result;
    } catch (err) {
      this.logger.error(err);
      throw new Error('uploadMediaPlaylist Failed:' + err);
    }
  }

  async uploadMediaSegment(opts: IRemoteFileUpload): Promise<boolean> {
    try {
      if (opts.uri) {
        const segURI = opts.uri;
        const fileName = opts.fileName;
        let result = false;
        this.logger.verbose(
          `(${this.sessionId}) Going to Fetch->${segURI}, and Upload as->${fileName}`
        );
        result = await this._fetchAndUpload(
          segURI,
          fileName,
          this.failTimeoutMs
        );
        return result;
      } else {
        throw new Error('plugin only supports fetching remote files');
      }
    } catch (err) {
      this.logger.error(err);
      throw new Error('uploadMediaSegment Failed:' + err);
    }
  }
}
