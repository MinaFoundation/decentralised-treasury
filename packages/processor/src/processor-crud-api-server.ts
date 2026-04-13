import {
  Crud,
  type BaseRouteName,
  type CrudController,
  type JoinOptions,
  type QueryOptions,
} from "@dataui/crud";
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
import { DataSource, getMetadataArgsStorage, type Repository } from "typeorm";
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
const DEFAULT_ROUTE_PREFIX = "processor";
const PROCESSOR_CRUD_DATA_SOURCE = Symbol("PROCESSOR_CRUD_DATA_SOURCE");

interface ExposedEntity {
  entity: Type<object>;
  routePath: string;
}

interface RelationDescriptor {
  propertyName: string;
  targetEntity: Type<object> | null;
}

interface CrudQueryDescriptor {
  allow: string[];
  sort: NonNullable<QueryOptions["sort"]>;
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
  if (routeBase.endsWith("s")) {
    return routeBase;
  }
  if (/[bcdfghjklmnpqrstvwxyz]y$/i.test(routeBase)) {
    return `${routeBase.slice(0, -1)}ies`;
  }
  return `${routeBase}s`;
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

function resolveEntityClass(target: unknown): Type<object> | null {
  if (typeof target === "function") {
    return target as Type<object>;
  }
  return null;
}

function resolveRelationTarget(typeFactory: unknown): Type<object> | null {
  if (typeof typeFactory === "function") {
    try {
      return resolveEntityClass(typeFactory());
    } catch {
      return null;
    }
  }

  return resolveEntityClass(typeFactory);
}

function buildEntityRelationGraph(
  entityClasses: Type<object>[],
): Map<Type<object>, RelationDescriptor[]> {
  const storage = getMetadataArgsStorage();
  const entitySet = new Set(entityClasses);
  const relationGraph = new Map<Type<object>, RelationDescriptor[]>();

  for (const relation of storage.relations) {
    const sourceEntity = resolveEntityClass(relation.target);
    if (!sourceEntity || !entitySet.has(sourceEntity)) {
      continue;
    }

    const relationDescriptors = relationGraph.get(sourceEntity) ?? [];
    relationDescriptors.push({
      propertyName: relation.propertyName,
      targetEntity: resolveRelationTarget(relation.type),
    });
    relationGraph.set(sourceEntity, relationDescriptors);
  }

  return relationGraph;
}

function buildJoinOptionsForEntity(
  rootEntity: Type<object>,
  relationGraph: Map<Type<object>, RelationDescriptor[]>,
): JoinOptions {
  const joinOptions: JoinOptions = {};
  const visitedPaths = new Set<string>();

  const walk = (currentEntity: Type<object>, prefix: string, seen: Set<Type<object>>): void => {
    const relations = relationGraph.get(currentEntity) ?? [];
    for (const relation of relations) {
      const path = prefix
        ? `${prefix}.${relation.propertyName}`
        : relation.propertyName;
      if (!visitedPaths.has(path)) {
        joinOptions[path] = {};
        visitedPaths.add(path);
      }

      if (!relation.targetEntity || seen.has(relation.targetEntity)) {
        continue;
      }

      const nextSeen = new Set(seen);
      nextSeen.add(relation.targetEntity);
      walk(relation.targetEntity, path, nextSeen);
    }
  };

  walk(rootEntity, "", new Set([rootEntity]));
  return joinOptions;
}

function buildJoinOptionsByEntity(
  entityClasses: Type<object>[],
): Map<Type<object>, JoinOptions> {
  const relationGraph = buildEntityRelationGraph(entityClasses);
  const joinOptionsByEntity = new Map<Type<object>, JoinOptions>();

  for (const entityClass of entityClasses) {
    joinOptionsByEntity.set(
      entityClass,
      buildJoinOptionsForEntity(entityClass, relationGraph),
    );
  }

  return joinOptionsByEntity;
}

function buildEntityColumnMap(
  entityClasses: Type<object>[],
): Map<Type<object>, string[]> {
  const storage = getMetadataArgsStorage();
  const entitySet = new Set(entityClasses);
  const columnsByEntity = new Map<Type<object>, Set<string>>();

  for (const column of storage.columns) {
    const entityClass = resolveEntityClass(column.target);
    if (!entityClass || !entitySet.has(entityClass)) {
      continue;
    }

    const fieldSet = columnsByEntity.get(entityClass) ?? new Set<string>();
    fieldSet.add(column.propertyName);
    columnsByEntity.set(entityClass, fieldSet);
  }

  const normalized = new Map<Type<object>, string[]>();
  for (const [entityClass, fieldSet] of columnsByEntity.entries()) {
    normalized.set(entityClass, Array.from(fieldSet).sort());
  }

  return normalized;
}

function buildDefaultSort(fields: string[]): NonNullable<QueryOptions["sort"]> {
  const fieldSet = new Set(fields);
  const sort: NonNullable<QueryOptions["sort"]> = [];

  if (fieldSet.has("updatedAt")) {
    sort.push({ field: "updatedAt", order: "DESC" });
  } else if (fieldSet.has("createdAt")) {
    sort.push({ field: "createdAt", order: "DESC" });
  } else if (fieldSet.has("id")) {
    sort.push({ field: "id", order: "DESC" });
  }

  if (fieldSet.has("id") && !sort.some(({ field }) => field === "id")) {
    sort.push({ field: "id", order: "DESC" });
  }

  return sort;
}

function buildCrudQueryDescriptorsByEntity(
  entityClasses: Type<object>[],
): Map<Type<object>, CrudQueryDescriptor> {
  const columnsByEntity = buildEntityColumnMap(entityClasses);
  const descriptors = new Map<Type<object>, CrudQueryDescriptor>();

  for (const entityClass of entityClasses) {
    const allow = columnsByEntity.get(entityClass) ?? [];
    descriptors.set(entityClass, {
      allow,
      sort: buildDefaultSort(allow),
    });
  }

  return descriptors;
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
  joinOptions: JoinOptions,
  crudQueryDescriptor: CrudQueryDescriptor,
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
      allow: crudQueryDescriptor.allow,
      join: joinOptions,
      limit: pageLimitDefault,
      maxLimit: pageLimitMax,
      sort: crudQueryDescriptor.sort,
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
  const joinOptionsByEntity = buildJoinOptionsByEntity(entityClasses);
  const crudQueryDescriptorsByEntity =
    buildCrudQueryDescriptorsByEntity(entityClasses);
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
      joinOptionsByEntity.get(entity) ?? {},
      crudQueryDescriptorsByEntity.get(entity) ?? { allow: [], sort: [] },
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
    app.enableCors({
      origin: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["content-type"],
    });
    const normalizedRoutePrefix = normalizeRoutePrefix(this.options.routePrefix);
    if (normalizedRoutePrefix.length > 0) {
      app.setGlobalPrefix(normalizedRoutePrefix);
    }
    await app.listen(this.options.port);
    this.app = app;
    this.bindSignalHandlers();
    console.log(
      `[processor-api] listening on :${this.options.port}${normalizedRoutePrefix ? `/${normalizedRoutePrefix}` : ""}`,
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
