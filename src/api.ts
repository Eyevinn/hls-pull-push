import { Schemas } from "../util/schemas";
import { IOutputPlugin, IOutputPluginDest } from "../types/output_plugin";
import { FastifyInstance, FastifyRequest } from "fastify";
import { HLSPullPush } from "./index";

export default function (fastify: FastifyInstance, opts, done) {
  const instance: HLSPullPush = opts.instance;
  const logger = instance.getLogger();

  fastify.post(
    "/fetcher",
    { schema: Schemas("POST/fetcher", instance.getRegisteredPlugins()) },
    async (request: FastifyRequest, reply) => {
      try {
        //console.log(`[${this.instanceId}]: I got a POST request`);
        logger.verbose(`${request.ip}: POST /fetcher`);
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
        const requestedPlugin: IOutputPlugin = instance.getPluginFor(requestBody.output);
        if (!requestedPlugin) {
          return reply.code(404).send({ message: `Unsupported Plugin Type '${requestBody.output}'` });
        }

        // Generate instance of plugin destination if valid
        let outputDest: IOutputPluginDest;
        try {
          outputDest = requestedPlugin.createOutputDestination(requestBody.payload, instance.getLogger());
        } catch (err) {
          logger.error(err);
          return reply.code(404).send(JSON.stringify(err));
        }

        const sessionId = instance.startFetcher({
          name: requestBody.name,
          url: url.href,
          destPlugin: outputDest,
          destPluginName: requestBody.output,
          concurrency: requestBody["concurrency"] ? requestBody["concurrency"] : null,
          windowSize: requestBody["windowSize"] ? requestBody["windowSize"] : null,
        });
        outputDest.attachSessionId(sessionId);

        reply.code(200).send({
          message: "Created a Fetcher and started pulling from HLS Live Stream",
          fetcherId: sessionId,
          requestData: request.body,
        });
      } catch (err) {
        logger.error(err);
        reply.code(500).send(err.message);
      }
    }
  );
  fastify.get("/fetcher", { schema: Schemas("GET/fetcher", instance.getRegisteredPlugins()) }, async (request, reply) => {
    logger.verbose(`${request.ip}: GET /fetcher`);
    try {
      let activeFetchersList = instance.getActiveFetchers();
      reply.code(200).send(activeFetchersList);
    } catch (err) {
      logger.error(err);
      reply.code(500).send(err.message);
    }
  });
  fastify.delete(
    "/fetcher/:fetcherId",
    { schema: Schemas("DELETE/fetcher/:fetcherId", instance.getRegisteredPlugins()) },
    async (request, reply) => {
      const requestParams: any = request.params;
      const fetcherId = requestParams.fetcherId;
      logger.verbose(`${request.ip}: DELETE /fetcher/${fetcherId}`);
      try {
        if (!instance.isValidFetcher(fetcherId)) {
          logger.verbose("Nothing found under specified fetcher id: " + fetcherId);
          return reply.code(404).send({
            message: `Fetcher with ID: '${fetcherId}' was not found`,
          });
        }
        await instance.stopFetcher(fetcherId);
        return reply.code(204).send({ message: "Deleted Fetcher Session" });
      } catch (err) {
        logger.error(err);
        reply.code(500).send(err.message);
      }
    }
  );

  done();
};