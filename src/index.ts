import fastify, { FastifyInstance, FastifyRequest } from "fastify";
import { HLSRecorder } from "@eyevinn/hls-recorder";
import { Schemas } from "../util/schemas";
import { Session } from "../util/session";

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

export class HLSPullPush {
  private server: FastifyInstance;
  private dest: any;
  private SESSIONS: any;

  constructor(options) {
    const SESSIONS = {}; // in memory store
    this.dest = options?.dest;
    this.server = fastify({ ignoreTrailingSlash: true });
    this.server.register(require("fastify-swagger"), {
      routePrefix: "/api/docs",
      swagger: {
        info: {
          title: "Pull Push Service API",
          description: "Service that pulls from HLS live stream and pushes to Media Package",
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
            const requestBody: any = request.body;
            if (!requestBody || !requestBody.name || !requestBody.url || !requestBody.dest) {
              reply.code(404).send("Missing request body keys");
            }
            // Check if string is valid url
            const url = new URL(requestBody.url);
            // Create new session and add to local store
            const session = new Session({
              name: requestBody.name,
              url: url.href,
              dest: requestBody.dest,
              concurrency: null,
            });
            // Store Hls recorder in dictionary in-memory
            SESSIONS[session.sessionId] = session;
            console.log(
              "HLSPullPush instance's own SESSIONS:",
              JSON.stringify(Object.keys(SESSIONS), null, 2)
            );

            reply.code(200).send({
              message: "Created an Fetcher and started pulling from HLS Live Stream",
              fetcherId: session.sessionId,
              requestData: {
                name: requestBody.name,
                url: url.href,
                dest: requestBody.dest,
                concurrency: null,
              },
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
            let activeFetchersList = Object.keys(SESSIONS).map((sessionId) =>
              SESSIONS[sessionId].toJSON()
            );
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
              console.log("Deleting Recording Session from SessionStorage");
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

  listen(port) {
    this.server.listen(port, "0.0.0.0", (err, address) => {
      if (err) {
        throw err;
      }
      console.log(`Server listening at ${address}`);
    });
  }
}
