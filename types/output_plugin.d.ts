export interface IOutputPlugin {
  createOutputDestination(opts: any);
  getDestinationJsonSchema();
}

export interface IOutputPluginDest {
  _fileUploader(opts: any): Promise<boolean>;
  uploadMediaPlaylist(opts: any): Promise<boolean>;
  uploadMediaSegment(opts: any): Promise<boolean>;
}