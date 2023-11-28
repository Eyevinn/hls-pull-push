import {
  ILocalFileUpload,
  IOutputPlugin,
  IOutputPluginDest,
  IRemoteFileDeletion,
  IRemoteFileUpload,
} from "../types/output_plugin";
import { ILogger } from "../types/index";

require("dotenv").config();

export interface IVoidOutputOptions {
  void?: string; 
}

export class VoidOutput implements IOutputPlugin<IVoidOutputOptions> {
  createOutputDestination(opts: IVoidOutputOptions, logger: ILogger): IOutputPluginDest {
    return new VoidOutputDestination(opts, logger);
  }

  getPayloadSchema() {
    return {};
  }
}

export class VoidOutputDestination implements IOutputPluginDest {
  private logger: ILogger;
  private sessionId?: string;

  constructor(opts: any, logger: ILogger) {
    this.logger = logger;
  }

  attachSessionId(id: string) {
    this.sessionId = id;
  }

  uploadMediaPlaylist(opts: ILocalFileUpload): Promise<boolean> {
    this.logger.info(`[${this.sessionId}] uploadMediaPlaylist ${JSON.stringify(opts)}`);
    return Promise.resolve(true);
  }

  uploadMediaSegment(opts: IRemoteFileUpload): Promise<boolean> {
    this.logger.info(`${this.sessionId}] uploadMediaSegment ${JSON.stringify(opts)}`);
    return Promise.resolve(true);
  }

  deleteMediaSegment(opts: IRemoteFileDeletion): Promise<boolean> {
    this.logger.info(`${this.sessionId}] deleteMediaSegment ${JSON.stringify(opts)}`);
    return Promise.resolve(true);
  }
}
