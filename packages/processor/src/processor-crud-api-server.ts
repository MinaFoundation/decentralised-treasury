import { Crud, type BaseRouteName, type CrudController } from "@dataui/crud";
import { TypeOrmCrudService } from "@dataui/crud-typeorm";
import {
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  type INestApplication,
  type Provider,
  type Type,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { InjectRepository, TypeOrmModule } from "@nestjs/typeorm";
import { DataSource, type Repository } from "typeorm";
import type {
  ProcessorDatabaseConfig,
  ProcessorEntitySchema,
} from "./processor-data-source.js";

const MUTATING_CRUD_ROUTES: BaseRouteName[] = [
  "createOneBase",
  "createManyBase",
  "updateOneBase",
  "replaceOneBase",
  "deleteOneBase",
  "recoverOneBase",
];
const DEFAULT_ROUTE_PREFIX = "v1/processor";
const PROCESSOR_CRUD_DATA_SOURCE = Symbol("PROCESSOR_CRUD_DATA_SOURCE");

interface ExposedEntity {
  entity: Type<object>;
  routePath: string;
}

export interface ProcessorCrudApiServerConfig extends ProcessorDatabaseConfig {
  processorApiPort: number;
  processorApiPrefix: string;
  apiPageLimitDefault: number;
  apiPageLimitMax: number;
}

export interface ProcessorCrudApiServerOptions {
  databaseUrl?: string;
  databaseSchema?: string;
  dataSource?: DataSource;
  port: number;
  routePrefix: string;
  pageLimitDefault: number;
  pageLimitMax: number;
  outputEntitySchemas: ProcessorEntitySchema[];
  readOnly: boolean;
}

function toKebabCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

function normalizeRoutePath(routePath: string): string {
  const normalized = routePath.trim().replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    throw new Error("Processor CRUD API route paths cannot be empty");
  }
  return normalized;
}

function normalizeRoutePrefix(prefix: string): string {
  return prefix.trim().replace(/^\/+|\/+$/g, "");
}

function defaultRoutePathForEntity(entity: Type<object>): string {
  const rawName = entity.name.trim();
  const withoutSuffix = rawName.replace(/Entity$/, "");
  const routeBase = toKebabCase(withoutSuffix || rawName || "entity");
  return routeBase.endsWith("s") ? routeBase : `${routeBase}s`;
}

function resolveExposedEntities(
  outputEntitySchemas: ProcessorEntitySchema[],
): ExposedEntity[] {
  if (!outputEntitySchemas.length) {
    throw new Error(
      "Processor CRUD API requires at least one output entity schema",
    );
  }

  const seenRoutePaths = new Set<string>();
  return outputEntitySchemas.map((schema) => {
    if (typeof schema !== "function") {
      throw new Error(
        "Processor CRUD API only supports class-based TypeORM entities",
      );
    }
    const entity = schema as Type<object>;
    const routePath = normalizeRoutePath(defaultRoutePathForEntity(entity));
    if (seenRoutePaths.has(routePath)) {
      throw new Error(
        `Processor CRUD API cannot expose duplicate route path "${routePath}"`,
      );
    }
    seenRoutePaths.add(routePath);
    return { entity, routePath };
  });
}

function createCrudService(
  entity: Type<object>,
  dataSourceToken: symbol | null,
): Type<TypeOrmCrudService<object>> {
  if (dataSourceToken) {
    @Injectable()
    class EntityCrudService extends TypeOrmCrudService<object> {
      public constructor(
        @Inject(dataSourceToken)
        dataSource: DataSource,
      ) {
        super(dataSource.getRepository(entity));
      }
    }

    return EntityCrudService;
  }

  @Injectable()
  class EntityCrudService extends TypeOrmCrudService<object> {
    public constructor(
      @InjectRepository(entity)
      repository: Repository<object>,
    ) {
      super(repository);
    }
  }

  return EntityCrudService;
}

function createCrudController(
  entity: Type<object>,
  serviceType: Type<TypeOrmCrudService<object>>,
  routePath: string,
  pageLimitDefault: number,
  pageLimitMax: number,
  readOnly: boolean,
): Type<object> {
  const routeOptions = readOnly
    ? {
        exclude: MUTATING_CRUD_ROUTES,
      }
    : undefined;

  @Controller(routePath)
  @Crud({
    model: {
      type: entity,
    },
    query: {
      alwaysPaginate: true,
      limit: pageLimitDefault,
      maxLimit: pageLimitMax,
    },
    routes: routeOptions,
  })
  class EntityCrudController implements CrudController<object> {
    public constructor(
      @Inject(serviceType)
      public service: TypeOrmCrudService<object>,
    ) {}
  }

  return EntityCrudController;
}

@Controller("healthz")
class ProcessorCrudHealthController {
  @Get()
  public healthz(): { ok: boolean } {
    return { ok: true };
  }
}

function createCrudApiModule(options: ProcessorCrudApiServerOptions): Type<object> {
  const exposedEntities = resolveExposedEntities(options.outputEntitySchemas);
  const entityClasses = exposedEntities.map(({ entity }) => entity);
  const useExternalDataSource = !!options.dataSource;
  const dataSourceToken = useExternalDataSource
    ? PROCESSOR_CRUD_DATA_SOURCE
    : null;
  const imports: any[] = [];
  const providers: Provider[] = [];

  if (useExternalDataSource) {
    providers.push({
      provide: PROCESSOR_CRUD_DATA_SOURCE,
      useValue: options.dataSource,
    });
  } else {
    imports.push(
      TypeOrmModule.forRoot({
        type: "postgres",
        url: options.databaseUrl,
        schema: options.databaseSchema,
        synchronize: false,
        entities: entityClasses,
      }),
      TypeOrmModule.forFeature(entityClasses),
    );
  }

  const serviceTypes = exposedEntities.map(({ entity }) =>
    createCrudService(entity, dataSourceToken),
  );
  const controllerTypes = exposedEntities.map(({ entity, routePath }, index) =>
    createCrudController(
      entity,
      serviceTypes[index],
      routePath,
      options.pageLimitDefault,
      options.pageLimitMax,
      options.readOnly,
    ),
  );

  @Module({
    imports,
    providers: [...providers, ...serviceTypes],
    controllers: [ProcessorCrudHealthController, ...controllerTypes],
  })
  class ProcessorCrudApiModule {}

  return ProcessorCrudApiModule;
}

export class ProcessorCrudApiServer {
  private app: INestApplication | null = null;
  private signalHandlersBound = false;
  private readonly handleSigInt = () => {
    void this.handleShutdownSignal("SIGINT");
  };
  private readonly handleSigTerm = () => {
    void this.handleShutdownSignal("SIGTERM");
  };

  public static fromConfig(
    config: ProcessorCrudApiServerConfig,
    outputEntitySchemas: ProcessorEntitySchema[],
  ): ProcessorCrudApiServer {
    return new ProcessorCrudApiServer({
      databaseUrl: config.databaseUrl,
      databaseSchema: config.databaseSchema,
      port: config.processorApiPort,
      routePrefix: config.processorApiPrefix || DEFAULT_ROUTE_PREFIX,
      pageLimitDefault: config.apiPageLimitDefault,
      pageLimitMax: config.apiPageLimitMax,
      outputEntitySchemas,
      readOnly: true,
    });
  }

  public constructor(private readonly options: ProcessorCrudApiServerOptions) {
    if (options.pageLimitDefault > options.pageLimitMax) {
      throw new Error(
        "Processor CRUD API pageLimitDefault cannot be greater than pageLimitMax",
      );
    }
    if (!options.dataSource && (!options.databaseUrl || !options.databaseSchema)) {
      throw new Error(
        "Processor CRUD API requires either an initialized data source or database connection settings",
      );
    }
  }

  public async start(): Promise<void> {
    if (this.app) {
      return;
    }

    if (this.options.dataSource && !this.options.dataSource.isInitialized) {
      await this.options.dataSource.initialize();
    }

    const module = createCrudApiModule(this.options);
    const app = await NestFactory.create(module, {
      logger: ["error", "warn", "log"],
    });
    const routePrefix = normalizeRoutePrefix(this.options.routePrefix);
    if (routePrefix.length > 0) {
      app.setGlobalPrefix(routePrefix);
    }
    await app.listen(this.options.port);
    this.app = app;
    this.bindSignalHandlers();
    console.log(
      `[processor-api] listening on :${this.options.port}${routePrefix ? `/${routePrefix}` : ""}`,
    );
  }

  public async stop(): Promise<void> {
    if (this.app) {
      const app = this.app;
      this.app = null;
      await app.close();
    }
    this.unbindSignalHandlers();
  }

  private bindSignalHandlers(): void {
    if (this.signalHandlersBound) {
      return;
    }
    process.on("SIGINT", this.handleSigInt);
    process.on("SIGTERM", this.handleSigTerm);
    this.signalHandlersBound = true;
  }

  private unbindSignalHandlers(): void {
    if (!this.signalHandlersBound) {
      return;
    }
    process.off("SIGINT", this.handleSigInt);
    process.off("SIGTERM", this.handleSigTerm);
    this.signalHandlersBound = false;
  }

  private async handleShutdownSignal(signal: string): Promise<void> {
    console.log(`[processor-api] received ${signal}, shutting down`);
    await this.stop();
  }
}
