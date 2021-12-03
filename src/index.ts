import fastify, { FastifyInstance, FastifyRequest } from "fastify";
import { Schemas } from "../util/schemas";
import { Session } from "../util/session";
import { IOutputPlugin, IOutputPluginDest } from "../types/output_plugin";
export { MediaPackageOutput } from "../output_plugins/mediapackage";

export interface IDestPayload {
  destination: string;
  username: string;
  password: string;
}

interface IWebDAV {
  TBD: any;
}

interface IRequestBody {
  name: string;
  url: string;
  dest?: any;
}
const PLUGINS = {};
export class HLSPullPush {
  private server: FastifyInstance;
  PLUGINS: Object;
  instanceId: number;

  constructor(opts?) {
    const SESSIONS = {}; // in memory store

    this.instanceId = 1;

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
    this.server.register(
      function (fastify, opts, done) {
        fastify.post("/fetcher", { schema: Schemas["POST/fetcher"] }, async (request, reply) => {
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
              reply.code(404).send("Missing request body keys");
            }
            // Check if string is valid url
            const url = new URL(requestBody.url);
            // Get Plugin from register if valid
            const requestedPlugin: IOutputPlugin = _getPluginFor(requestBody.output);
            if (!requestedPlugin) {
              reply.code(404).send({ message: `Unsupported Plugin Type '${requestBody.output}'` });
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
              concurrency: requestBody.payload["concurrency"] ? requestBody.payload["concurrency"] : null,
              windowSize: requestBody.payload["windowSize"] ? requestBody.payload["windowSize"] : null,
            });
            // Store Hls recorder in dictionary in-memory
            SESSIONS[session.sessionId] = session;

            reply.code(200).send({
              message: "Created a Fetcher and started pulling from HLS Live Stream",
              fetcherId: session.sessionId,
              requestData: request.body,
            });
          } catch (err) {
            reply.code(500).send(err.message);
          }
        });
        fastify.get("/fetcher", { schema: Schemas["GET/fetcher"] }, async (request, reply) => {
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
          { schema: Schemas["DELETE/fetcher/:fetcherId"] },
          async (request, reply) => {
            const requestParams: any = request.params;
            const fetcherId = requestParams.fetcherId;
            try {
              let session = SESSIONS[fetcherId];
              if (!session) {
                console.log("Nothing cached under specified cache id: " + fetcherId);
                reply.code(404).send({
                  message: `Recorder with Cache ID: '${fetcherId}' was not found`,
                });
              }
              console.log("SESSION:", session.toJSON());
              // Stop recording
              if (session.isActive()) {
                await session.StopHLSRecorder();
              }
              // Delete Session from store
              console.log(`Deleting Recording Session [ ${fetcherId} ] from SessionStorage`);
              delete SESSIONS[fetcherId];

              return reply.code(204).send({ message: "Deleted Fetcher Session" });
            } catch (err) {
              reply.code(500).send(err.message);
            }
          }
        );
        done();
      },
      { prefix: "/api/v1" }
    );
  }

  registerPlugin(name: string, plugin: IOutputPlugin): void {
    PLUGINS[name] = plugin;
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
function _getPluginFor(name: string): IOutputPlugin {
  console.log(`Registered Plugins are: [${Object.keys(PLUGINS)}]. Request arg is '${name}'`);
  const result = PLUGINS[name];
  if (!result) {
    return null;
  }
  return result;
}
