import fastify, { FastifyInstance } from "fastify";
import { Session } from "../util/session";
import { IOutputPlugin, IOutputPluginDest } from "../types/output_plugin";
import { ILogger } from "../types/index";
import { AbstractLogger } from "./logger";
import uuid from "uuid/v4";
export { MediaPackageOutput } from "../output_plugins/mediapackage";
export { S3BucketOutput } from "../output_plugins/s3bucket";

import api from "./api";

export interface IDestPayload {
  destination: string;
  username: string;
  password: string;
}

export class HLSPullPush {
  private server: FastifyInstance;
  private PLUGINS: { [name: string]: IOutputPlugin };
  private SESSIONS: { [sessionId: string]: Session };
  private logger: ILogger;

  constructor(logger?: ILogger) {
    this.SESSIONS = {}; // in memory store
    this.PLUGINS = {};
    this.logger = logger || new AbstractLogger();

    this.server = fastify({ ignoreTrailingSlash: true });
    this.server.register(require("fastify-swagger"), {
      routePrefix: "/api/docs",
      swagger: {
        info: {
          title: "Pull Push Service API",
          description: "Service that pulls from HLS live stream and pushes to Plugin Destination",
          version: "0.1.0",
        },
        tags: [{ name: "fetcher", description: "Fetcher related end-points" }],
      },
      exposeRoute: true,
    });
    this.server.register(require("fastify-cors"), {});
    this.server.get("/", async () => {
      return "OK\n";
    });
  }

  startFetcher({
    name,
    url,
    destPlugin,
    destPluginName,
    concurrency,
    windowSize,
  }: {
    name: string;
    url: string;
    destPlugin: IOutputPluginDest;
    destPluginName: string;
    concurrency?: number;
    windowSize?: number;
  }): string {
    // Create new session and add to local store
    const session = new Session({
      name,
      url,
      plugin: destPlugin,
      dest: destPluginName,
      concurrency,
      windowSize,
    });

    // Store Hls recorder in dictionary in-memory
    this.SESSIONS[session.sessionId] = session;

    this.logger.info(`New Fetcher Session Created, id:[${session.sessionId}]`);
    return session.sessionId;
  }

  async stopFetcher(fetcherId: string) {
    let session = this.SESSIONS[fetcherId];

    // Stop recording
    if (session.isActive()) {
      await session.StopHLSRecorder();
    }
    // Delete Session from store
    this.logger.info(`Deleting Fetcher Session [ ${fetcherId} ] from Session Storage`);
    delete this.SESSIONS[fetcherId];
  }

  isValidFetcher(fetcherId: string): boolean {
    return this.SESSIONS[fetcherId] ? true : false;
  }

  getActiveFetchers() {
    // Remove any inactive sessions
    Object.keys(this.SESSIONS).map((sessionId) => {
      if (this.SESSIONS[sessionId].isActive() === false) {
        delete this.SESSIONS[sessionId];
      }
    });
    return Object.keys(this.SESSIONS).map((sessionId) => this.SESSIONS[sessionId].toJSON());
  }

  registerPlugin(name: string, plugin: IOutputPlugin): void {
    if (!this.PLUGINS[name]) {
      this.PLUGINS[name] = plugin;
    }
    this.logger.info(`Registered output plugin '${name}'`);
  }

  getPluginFor(name: string): IOutputPlugin {
    try {
      const result = this.PLUGINS[name];
      if (!result) {
        this.logger.info(
          `Requested Plugin:'${name}' Not Found Amongst Registered Plugins: [${Object.keys(this.PLUGINS)}]`
        );
        return null;
      }
      return result;
    } catch (err) {
      console.error(err);
    }
  }

  getRegisteredPlugins(): IOutputPlugin[] {
    return Object.keys(this.PLUGINS).map((name) => this.PLUGINS[name]);
  }

  getLogger(): ILogger {
    return this.logger;
  }

  listen(port) {
    this.server.register(api, { instance: this, prefix: "/api/v1" });
    this.server.listen(port, "0.0.0.0", (err, address) => {
      if (err) {
        throw err;
      }
      this.logger.info(`HLSPullPush Service listening at ${address}`);
    });
  }
}
