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

  constructor() {
    const SESSIONS = {}; // in memory store
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
            const requestedPlugin: IOutputPlugin = GetPluginFor(opts.instance, requestBody.output);
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

            // Create new session and add to local store
            const session = new Session({
              name: requestBody.name,
              url: url.href,
              plugin: outputDest,
              dest: requestBody.output,
              concurrency: requestBody["concurrency"] ? requestBody["concurrency"] : null,
              windowSize: requestBody["windowSize"] ? requestBody["windowSize"] : null,
            });
            // Store Hls recorder in dictionary in-memory
            SESSIONS[session.sessionId] = session;
            console.log(`New Fetcher Session Created, id:[${session.sessionId}]`);

            reply.code(200).send({
              message: "Created a Fetcher and started pulling from HLS Live Stream",
              fetcherId: session.sessionId,
              requestData: request.body,
            });
          } catch (err) {
            reply.code(500).send(err.message);
          }
        }
      );
      fastify.get("/fetcher", { schema: Schemas("GET/fetcher") }, async (request, reply) => {
        try {
          // Remove any inactive sessions
          Object.keys(SESSIONS).map((sessionId) => {
            if (SESSIONS[sessionId].isActive() === false) {
              delete SESSIONS[sessionId];
            }
          });
          let activeFetchersList = Object.keys(SESSIONS).map((sessionId) => SESSIONS[sessionId].toJSON());
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
            let session = SESSIONS[fetcherId];
            if (!session) {
              console.log("Nothing found under specified fetcher id: " + fetcherId);
              return reply.code(404).send({
                message: `Fetcher with ID: '${fetcherId}' was not found`,
              });
            }
            console.log("SESSION:", session.toJSON());
            // Stop recording
            if (session.isActive()) {
              await session.StopHLSRecorder();
            }
            // Delete Session from store
            console.log(`Deleting Fetcher Session [ ${fetcherId} ] from Session Storage`);
            delete SESSIONS[fetcherId];

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

  registerPlugin(name: string, plugin: IOutputPlugin): void {
    if (!this.PLUGINS[name]) {
      this.PLUGINS[name] = plugin;
    }
    let pluginPayloadSchema: any = plugin.getPayloadSchema();
    this.PAYLOAD_SCHEMAS.push(pluginPayloadSchema);
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

function GetPluginFor(instance: any, name: string): IOutputPlugin {
  try {
    const result = instance.PLUGINS[name];
    if (!result) {
      console.log(
        `Requested Plugin:'${name}' Not Found Amongst Registered Plugins: [${Object.keys(instance.PLUGINS)}]`
      );
      return null;
    }
    return result;
  } catch (err) {
    console.error(err);
  }
}
