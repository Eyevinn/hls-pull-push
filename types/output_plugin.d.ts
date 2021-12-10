export interface IOutputPlugin {
  createOutputDestination(opts: any);
  getPayloadSchema();
}

export type Logger = (logMessage: string) => void;

export interface ILocalFileUpload {
  fileName: string;
  fileData: any;
}

export interface IRemoteFileUpload extends ILocalFileUpload {
  uri?: string;
}

export interface IOutputPluginDest {
  logger: Logger;
  uploadMediaPlaylist(opts: ILocalFileUpload): Promise<boolean>;
  uploadMediaSegment(opts: IRemoteFileUpload): Promise<boolean>;
}
