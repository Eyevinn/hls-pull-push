import { IOutputPlugin, IOutputPluginDest } from "../types/output_plugin";
import { AuthType, createClient, WebDAVClient } from "webdav";
const fetch = require("node-fetch");

export interface IMediaPackageOutputOptions {
  ingestUrls: { url: string; username: string; password: string }[];
}

export interface IFileUploaderOptions {
  fileName: string;
  fileData: any;
}

export class MediaPackageOutput implements IOutputPlugin {
  createOutputDestination(opts: IMediaPackageOutputOptions) {
    // verify opts
    if (!opts.ingestUrls) {
      throw new Error("Payload Missing 'ingestUrls' parameter");
    } else {
      opts.ingestUrls.forEach((ingestUrl) => {
        try {
          let validUrl = new URL(ingestUrl.url);
          if (!ingestUrl.username || !ingestUrl.password) {
            throw new Error(
              "Payload parameter 'ingestUrls' missing 'username' or 'password' fields"
            );
          }
        } catch (err) {
          throw new Error("Payload parameter 'ingestUrls' contains an Invalid URL");
        }
      });
    }

    return new MediaPackageOutputDestination(opts);
  }
}

export class MediaPackageOutputDestination implements IOutputPluginDest {
  ingestUrls: { url: string; username: string; password: string }[];
  webDAVClients: WebDAVClient[];

  constructor(opts: IMediaPackageOutputOptions) {
    this.webDAVClients = [];
    this.ingestUrls = opts.ingestUrls;
    this.ingestUrls.forEach((ingestUrl) => {
      const client = createClient(ingestUrl.url.replace("/channel", ""), {
        username: ingestUrl.username,
        password: ingestUrl.password,
        authType: AuthType.Digest,
      });
      this.webDAVClients.push(client);
    });
  }

  async _fileUploader(opts: IFileUploaderOptions): Promise<boolean> {
    // For each client/ingestUrl
    for (let i = 0; i < this.webDAVClients.length; i++) {
      const client = this.webDAVClients[i];
      try {
        // Try Upload manifest
        let bool = await client.putFileContents(opts.fileName, opts.fileData, {
          overwrite: true,
        });
        // FOR DEBUGGING 
        if (typeof opts.fileData === "string") {
          console.log(opts.fileData);
        }
        console.log(
          `Upload Success: ${bool}. webDAV PUT '${opts.fileName}' to MediaPackage with username: ${this.ingestUrls[i].username}`
        );
        
        return bool;
      } catch (e) {
        console.error("(!): Problem Occured when putting files to destination", e);
        throw new Error(e);
      }
    }
  }

  async uploadMediaPlaylist(opts: IFileUploaderOptions): Promise<boolean> {
    const uploader = this._fileUploader.bind(this);
    try {
      console.log(`...\n...\n...I WANNA UPLOAD M3U8\n...\n`);
      let result = await uploader(opts);
      console.log(`Manifest (${opts.fileName}) uploaded...`);
      return result;
    } catch (err) {
      console.error(err);
      throw new Error("uploadMediaPlaylist Failed:" + err);
    }
  }

  async uploadMediaSegment(opts: any): Promise<boolean> {
    const uploader = this._fileUploader.bind(this);
    const fetchAndUpload = async (segURI, fileName): Promise<boolean> => {
      return new Promise((resolve, reject) => {
        fetch(segURI)
          .then((res) => res.buffer())
          .then(async (buffer) => {
            const uploaderOptions = {
              fileName: fileName,
              fileData: buffer,
            };
            let result = await uploader(uploaderOptions);
            console.log("Segment uploaded...");
            resolve(result);
          })
          .catch((err) => {
            reject(err);
          })
          .catch((err) => {
            reject(err);
          });
      });
    };
    try {
      const segURI = opts.segment_uri;
      const fileName = opts.file_name;
      let result = false;
      console.log("About to Fetch->Upload, ", fileName);
      result = await fetchAndUpload(segURI, fileName);
      return result;
    } catch (err) {
      console.error(err);
      throw new Error("uploadMediaSegment Failed:" + err);
    }
  }
}
