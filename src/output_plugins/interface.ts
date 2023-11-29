import { ILogger } from '../logger';

export interface IOutputPlugin<TOutputPluginOpts> {
  createOutputDestination(opts: TOutputPluginOpts, logger: ILogger);
  getPayloadSchema();
}

export interface ILocalFileUpload {
  fileName: string;
  fileData: any;
}

export interface IRemoteFileUpload extends ILocalFileUpload {
  uri?: string;
}

export interface IRemoteFileDeletion {
  fileName: string;
}

export interface IOutputPluginDest {
  attachSessionId(id: string): void;
  uploadMediaPlaylist(opts: ILocalFileUpload): Promise<boolean>;
  uploadMediaSegment(opts: IRemoteFileUpload): Promise<boolean>;
  deleteMediaSegment?(opts: IRemoteFileDeletion): Promise<boolean>;
}
