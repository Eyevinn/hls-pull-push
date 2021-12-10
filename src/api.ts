import { Schemas } from "../util/schemas";
import { IOutputPlugin, IOutputPluginDest } from "../types/output_plugin";
import { FastifyInstance } from "fastify";

export default function (fastify: FastifyInstance, opts, done) {
  fastify.post(
    "/fetcher",
    { schema: Schemas("POST/fetcher", opts.instance.getRegisteredPlugins()) },
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
  fastify.get("/fetcher", { schema: Schemas("GET/fetcher", opts.instance.getRegisteredPlugins()) }, async (request, reply) => {
    try {
      let activeFetchersList = opts.instance.getActiveFetchers();
      reply.code(200).send(activeFetchersList);
    } catch (err) {
      reply.code(500).send(err.message);
    }
  });
  fastify.delete(
    "/fetcher/:fetcherId",
    { schema: Schemas("DELETE/fetcher/:fetcherId", opts.instance.getRegisteredPlugins()) },
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