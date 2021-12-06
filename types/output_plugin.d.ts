export interface IOutputPlugin {
  createOutputDestination(opts: any);
  getDestinationJsonSchema();
}

export type Logger = (logMessage: string) => void;

export interface IOutputPluginDest {
  logger: Logger;
  _fileUploader(opts: any): Promise<boolean>;
  uploadMediaPlaylist(opts: any): Promise<boolean>;
  uploadMediaSegment(opts: any): Promise<boolean>;
}
