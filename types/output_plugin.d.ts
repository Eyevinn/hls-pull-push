export interface IOutputPlugin {
  createOutputDestination(opts: any);
}

export interface IOutputPluginDest {
  _fileUploader(opts: any): Promise<boolean>;
  uploadMediaPlaylist(opts: any): Promise<boolean>;
  uploadMediaSegment(opts: any): Promise<boolean>;
}

// function registerPlugin(name: string; plugin: IOutputPlugin)

/*

class MediaPackageOutput implements IOutputPlugin {
  createOutputDestination(opts) {
    // verify opts
    return new MediaPackageOutputDestination(opts);
  }
}

class MediaPackageOutputDestination implements IOutputPluginDest {
  constructor(opts) {

  }
}

const mediaPackageOutput = new MediaPackageOutput();
hlsPullPush.registerPlugin("mediapackage", mediaPackageOutput);

...
const outputPlugin: IOutputPlugin = this.getPluginFor(request.body.plugin);
const outputDestination = outputPlugin.createOutputDestination(request.body.payload);
outputDestination.uploadMediaPlaylist();

*/