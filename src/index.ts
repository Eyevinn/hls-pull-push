import fastify, { FastifyInstance, FastifyRequest } from "fastify";
import { Schemas } from "../util/schemas";
import { Session } from "../util/session";
import { IOutputPlugin, IOutputPluginDest } from "../types/output_plugin";
import uuid from "uuid/v4";
export { MediaPackageOutput } from "../output_plugins/mediapackage";

export interface IDestPayload {
  destination: string;
  username: string;
  password: string;
}

export class HLSPullPush {
  private server: FastifyInstance;
  PLUGINS: Object;
  PAYLOAD_SCHEMAS: any[];
  SESSIONS: {[sessionId: string]: Session};

  constructor() {
    this.SESSIONS = {}; // in memory store
    this.PLUGINS = {};
    this.PAYLOAD_SCHEMAS = [];

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

    const apiFetcher = function (fastify, opts, done) {
      fastify.post(
        "/fetcher",
        { schema: Schemas("POST/fetcher", opts.instance.PAYLOAD_SCHEMAS) },
        async (request, reply) => {
          try {
            //console.log(`[${this.instanceId}]: I got a POST request`);
            const requestBody: any = request.body;
            if (
              !requestBody ||
              !requestBody.name ||
              !requestBody.url ||
              !requestBody.output ||
              !requestBody.payload
            ) {
              return reply.code(404).send("Missing request body keys");
            }
            // Check if string is valid url
            const url = new URL(requestBody.url);
            // Get Plugin from register if valid
            const requestedPlugin: IOutputPlugin = opts.instance.getPluginFor(requestBody.output);
            if (!requestedPlugin) {
              return reply.code(404).send({ message: `Unsupported Plugin Type '${requestBody.output}'` });
            }

            // Generate instance of plugin destination if valid
            let outputDest: IOutputPluginDest;
            try {
              outputDest = requestedPlugin.createOutputDestination(requestBody.payload);
            } catch (err) {
              console.error(err);
              reply.code(404).send(JSON.stringify(err));
            }

            const sessionId = opts.instance.startFetcher({
              name: requestBody.name,
              url: url.href,
              destPlugin: outputDest,
              destPluginOpts: requestBody.output,
              concurrency: requestBody["concurrency"] ? requestBody["concurrency"] : null,
              windowSize: requestBody["windowSize"] ? requestBody["windowSize"] : null,
            });

            reply.code(200).send({
              message: "Created a Fetcher and started pulling from HLS Live Stream",
              fetcherId: sessionId,
              requestData: request.body,
            });
          } catch (err) {
            reply.code(500).send(err.message);
          }
        }
      );
      fastify.get("/fetcher", { schema: Schemas("GET/fetcher") }, async (request, reply) => {
        try {
          let activeFetchersList = opts.instance.getActiveFetchers();
          reply.code(200).send(activeFetchersList);
        } catch (err) {
          reply.code(500).send(err.message);
        }
      });
      fastify.delete(
        "/fetcher/:fetcherId",
        { schema: Schemas("DELETE/fetcher/:fetcherId") },
        async (request, reply) => {
          const requestParams: any = request.params;
          const fetcherId = requestParams.fetcherId;
          try {
            if (!opts.instance.isValidFetcher(fetcherId)) {
              console.log("Nothing found under specified fetcher id: " + fetcherId);
              return reply.code(404).send({
                message: `Fetcher with ID: '${fetcherId}' was not found`,
              });
            }
            await opts.instance.stopFetcher(fetcherId);
            return reply.code(204).send({ message: "Deleted Fetcher Session" });
          } catch (err) {
            reply.code(500).send(err.message);
          }
        }
      );
      done();
    };
    this.server.register(apiFetcher, { instance: this, prefix: "/api/v1" });
  }

  startFetcher({ 
    name, 
    url, 
    destPlugin, 
    destPluginOpts, 
    concurrency, 
    windowSize 
  }: { 
    name: string; 
    url: string; 
    destPlugin: IOutputPluginDest; 
    destPluginOpts: any; 
    concurrency?: number; 
    windowSize?: number 
  }): string {

    // Create new session and add to local store
    const session = new Session({ name, url, plugin: destPlugin, dest: destPluginOpts, concurrency, windowSize });

    // Store Hls recorder in dictionary in-memory
    this.SESSIONS[session.sessionId] = session;

    console.log(`New Fetcher Session Created, id:[${session.sessionId}]`);
    return session.sessionId;
  }

  async stopFetcher(fetcherId: string) {
    let session = this.SESSIONS[fetcherId];
    console.log("SESSION:", session.toJSON());

    // Stop recording
    if (session.isActive()) {
      await session.StopHLSRecorder();
    }
    // Delete Session from store
    console.log(`Deleting Fetcher Session [ ${fetcherId} ] from Session Storage`);
    delete this.SESSIONS[fetcherId];
  }
  
  isValidFetcher(fetcherId: string): boolean {
    return (this.SESSIONS[fetcherId] ? true : false);
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
    let pluginPayloadSchema: any = plugin.getPayloadSchema();
    this.PAYLOAD_SCHEMAS.push(pluginPayloadSchema);
    console.log(`Registered output plugin '${name}'`);
  }

  getPluginFor(name: string): IOutputPlugin {
    try {
      const result = this.PLUGINS[name];
      if (!result) {
        console.log(
          `Requested Plugin:'${name}' Not Found Amongst Registered Plugins: [${Object.keys(this.PLUGINS)}]`
        );
        return null;
      }
      return result;
    } catch (err) {
      console.error(err);
    }  
  }

  listen(port) {
    this.server.listen(port, "0.0.0.0", (err, address) => {
      if (err) {
        throw err;
      }
      console.log(`HLSPullPush Service listening at ${address}`);
    });
  }
}