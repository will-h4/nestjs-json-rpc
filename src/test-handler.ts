import {
  UsePipes,
  PipeTransform,
  Injectable,
  NestInterceptor,
  CanActivate,
  ExecutionContext,
  CallHandler,
  ArgumentMetadata,
  UseInterceptors,
  UseGuards,
  Scope,
  Inject
} from "@nestjs/common";
import { Ctx } from "@nestjs/microservices";

import { CodedRpcException, JsonRpcContext, RpcController, RpcMethod, RpcService } from ".";

const initialModuleState = {
  pipeCalled: false,
  guardCaled: false,
  interceptorCalled: false,
  serviceConstructorCount: 0,
  interceptorConstructorCount: 0
};

export let DecorationsState = Object.assign({}, initialModuleState);

export function resetDecorationsState() {
  Object.assign(DecorationsState, initialModuleState);
}

@Injectable()
class TestPipe implements PipeTransform {
  transform(value: any, _metadata: ArgumentMetadata) {
    DecorationsState.pipeCalled = true;
    return value;
  }
}

@Injectable({ scope: Scope.REQUEST })
class TestInterceptor implements NestInterceptor {
  constructor() {
    DecorationsState.interceptorConstructorCount++;
  }

  intercept(
    _context: ExecutionContext,
    next: CallHandler<any>
  ): import("rxjs").Observable<any> | Promise<import("rxjs").Observable<any>> {
    DecorationsState.interceptorCalled = true;
    return next.handle();
  }
}

function getMetadataFromContext(ctx: ExecutionContext, key: string) {
  switch (ctx.getType()) {
    case "http":
      return ctx
        .switchToHttp()
        .getRequest()
        .get(key);
    case "rpc":
      return ctx
        .switchToRpc()
        .getContext<JsonRpcContext>()
        .getMetadataByKey(key);
  }
}

@Injectable()
class TestGuard implements CanActivate {
  canActivate(
    ctx: ExecutionContext
  ): boolean | Promise<boolean> | import("rxjs").Observable<boolean> {
    let authMetadata = getMetadataFromContext(ctx, "Authorization");
    if (authMetadata) {
      return true;
    }
    return false;
  }
}

type IRpcTestService = RpcController<ITestClientService>;

@RpcService({
  namespace: "test"
})
@Injectable({ scope: Scope.REQUEST })
export class TestService implements IRpcTestService {
  constructor() {
    DecorationsState.serviceConstructorCount = DecorationsState.serviceConstructorCount + 1;
  }

  @UsePipes(TestPipe)
  @UseInterceptors(TestInterceptor)
  @UseGuards(TestGuard)
  @RpcMethod()
  public async invoke(params: { test: string }) {
    return Promise.resolve(params);
  }

  @UsePipes(TestPipe)
  @UseInterceptors(TestInterceptor)
  @UseGuards(TestGuard)
  @RpcMethod()
  public async testError(params: { errorTest: string }) {
    // construct the error object with some data inside
    throw new CodedRpcException("RPC EXCEPTION", 403, { fromService: "Test Service", params });
  }

  @UsePipes(TestPipe)
  @UseInterceptors(TestInterceptor)
  @UseGuards(TestGuard)
  @RpcMethod()
  public async invokeClientService(params: { test: string }) {
    return Promise.resolve(params);
  }

  public async notExposed(params: { test: string }) {
    return Promise.resolve(params);
  }

  @RpcMethod() public async unrecognizedError(params: {}) {
    throw new TypeError("Accidental server error");
  }

  @RpcMethod() public async injectContext(params: {}, @Ctx() context: JsonRpcContext) {
    return Promise.resolve({ key: context.getMetadataByKey("Authorization") });
  }
}

export interface ITestClientService {
  invoke(params: { test: string }): Promise<{ test: string }>;
  invokeClientService(params: { test: string }): Promise<{ test: string }>;
  testError(params: { errorTest: string }): Promise<void>;
  injectContext(params: {}): Promise<{ key: string | undefined }>;
  unrecognizedError(params: {}): any;
  notExposed(params: { test: string }): Promise<{ test: string }>;
}
