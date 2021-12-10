import { ILogger } from "../src/logger";

export interface IOutputPlugin {
  createOutputDestination(opts: any, logger: ILogger);
  getPayloadSchema();
}

export interface ILocalFileUpload {
  fileName: string;
  fileData: any;
}

export interface IRemoteFileUpload extends ILocalFileUpload {
  uri?: string;
}

export interface IOutputPluginDest {
  uploadMediaPlaylist(opts: ILocalFileUpload): Promise<boolean>;
  uploadMediaSegment(opts: IRemoteFileUpload): Promise<boolean>;
}
