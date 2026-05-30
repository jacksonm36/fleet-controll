import { createRequire } from "node:module";
import type { FastifyBaseLogger } from "fastify/types/logger.js";
import type { FastifyInstance } from "fastify/types/instance.js";
import type { FastifyReply } from "fastify/types/reply.js";
import type { FastifyRequest } from "fastify/types/request.js";
import type { RouteGenericInterface } from "fastify/types/route.js";
import type { FastifySchema } from "fastify/types/schema.js";
import type { FastifyTypeProviderDefault } from "fastify/types/type-provider.js";
import type {
  ContextConfigDefault,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify/types/utils.js";

const require = createRequire(import.meta.url);

export type AppInstance = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  FastifyBaseLogger,
  FastifyTypeProviderDefault
>;

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const fastify = require("fastify") as (opts?: object) => AppInstance;

export type AppRequest = FastifyRequest<
  RouteGenericInterface,
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  FastifySchema,
  FastifyTypeProviderDefault,
  ContextConfigDefault,
  FastifyBaseLogger
>;

export type AppReply = FastifyReply<
  RouteGenericInterface,
  RawServerDefault,
  RawRequestDefaultExpression<RawServerDefault>,
  RawReplyDefaultExpression<RawServerDefault>,
  ContextConfigDefault,
  FastifySchema,
  FastifyTypeProviderDefault
>;
