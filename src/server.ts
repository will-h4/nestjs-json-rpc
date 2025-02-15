import * as express from "express";
import * as http from "http";

import { Server, CustomTransportStrategy } from "@nestjs/microservices";
import { ExpressAdapter } from '@nestjs/platform-express';

import { JsonRpcResponse } from "./transport-types";
import { CodedRpcException } from "./coded-error";
import { HttpServer } from "@nestjs/common";
import { invokeAsync } from "./util";

export class JsonRpcContext {
  constructor(private req: express.Request, private server: express.Application) {}

  getMetadataByKey(metadataKey: string): string | undefined {
    return this.req.get(metadataKey);
  }
}

interface HybridJsonRpcServerOptions {
  /**
   * The path at which the JSON RPC endpoint should be mounted
   */
  path: string;

  /**
   * The HTTP Server provided by the Nest runtime
   */
  adapter: HttpServer<any, any>;
}

interface StandaloneJsonRpcServerOptions {
 /**
  * Listening port for the HTTP server
  */
  port: number;
 
  /**
   * Listening host (optional, defaults to any)
   */
  hostname?: string;
  /*
   * The path at which the JSON RPC endpoint should be mounted
   */
  path: string;
}

export type JsonRpcServerOptions = HybridJsonRpcServerOptions | StandaloneJsonRpcServerOptions;

/**
 * Helper to serialize JSONRPC responses
 */
function serializeResponse<T>(
  id: string,
  response: { value: T } | { error: CodedRpcException }
): JsonRpcResponse<T> {
  if ("error" in response) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: response.error.code || 500,
        data: response.error.data,
        message: response.error.message
      }
    };
  } else {
    return { jsonrpc: "2.0", id, result: response.value };
  }
}

export class JsonRpcServer extends Server implements CustomTransportStrategy {
  public server: http.Server | null = null;

  /**
   * Creates a new JSON RPC Server strategy. When used to create a NestJS microservice, it will
   * expose a new microservce with a HTTP transport which implements JSON-RPC
   */
  constructor(private readonly options: JsonRpcServerOptions) {
    super();
  }

  public async listen(callback: () => void) {
    let app: HttpServer<any, any>;

    if (this.isHybrid(this.options)) {
      app = this.options.adapter;
    } else {
      app = new ExpressAdapter(express());
      app.initHttpServer({});
    }

    app.getInstance().post(this.options.path, express.json(), async (req: express.Request, res: express.Response) => {
      let handler = this.getHandlerByPattern(req.body.method);

      if (handler == null) {
        let error = new CodedRpcException("Method not found: " + req.body.method, 404);
        return res.status(200).json(serializeResponse(req.body.id, { error }));
      }

      let context = new JsonRpcContext(req, app.getHttpServer());

      let observableResult = this.transformToObservable(await handler(req.body.params, context));
      let promiseResult = observableResult.toPromise();

      let response = await promiseResult.then(
        value => ({ value }),
        error => ({ error })
      );

      res.status(200).json(serializeResponse(req.body.id, response));
    });

    await invokeAsync(cb => {
      if (this.isStandalone(this.options)) {
        if (this.options.hostname != null) {
          this.server = app.listen(this.options.port, this.options.hostname, cb);
        } else {
          this.server = app.listen(this.options.port, cb);
        }
      } else {
        cb();
      }
    });
    
    callback();
  }

  public async close() {
    // do nothing, maybe block further requests
    if (this.isStandalone(this.options)) {
      await invokeAsync(cb => this.server && this.server.close(cb));
    }
  }

  private isHybrid(options: JsonRpcServerOptions): options is HybridJsonRpcServerOptions {
    return (options as HybridJsonRpcServerOptions).adapter !== undefined;
  }

  private isStandalone(options: JsonRpcServerOptions): options is StandaloneJsonRpcServerOptions {
    return (options as StandaloneJsonRpcServerOptions).port !== undefined;
  }
}
