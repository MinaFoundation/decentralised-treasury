import type { EventsApiServerOptions } from "@repo/indexer";
import type {
  EntityMetadata,
  FindOptionsOrder,
  FindOptionsRelations,
  ObjectLiteral,
} from "typeorm";
import type { DataSource, EntityTarget } from "typeorm";
import { ProposalEntity } from "./processors/proposals/proposal-entity.js";
import { ProposalExecutionEntity } from "./processors/proposals/proposal-execution-entity.js";
import { VoteEntity } from "./processors/proposals/vote-entity.js";
import { VoteNullifierEntity } from "./processors/proposals/vote-nullifier-entity.js";
import { VoteTallyEntity } from "./processors/proposals/vote-tally-entity.js";

const DEFAULT_PAGE_LIMIT = 50;
const DEFAULT_PAGE_LIMIT_MAX = 200;

class RequestValidationError extends Error {}

interface ProcessorCrudRoutesOptions {
  dataSource: DataSource;
  pageLimitDefault?: number;
  pageLimitMax?: number;
}

interface ExposedEntity {
  entity: EntityTarget<ObjectLiteral>;
  routePath: string;
}

interface RelationTree {
  [key: string]: RelationTree | true;
}
type SortDirection = "ASC" | "DESC";

const EXPOSED_ENTITIES: ExposedEntity[] = [
  {
    entity: ProposalEntity,
    routePath: "proposals",
  },
  {
    entity: VoteEntity,
    routePath: "votes",
  },
  {
    entity: VoteNullifierEntity,
    routePath: "vote-nullifiers",
  },
  {
    entity: VoteTallyEntity,
    routePath: "vote-tallies",
  },
  {
    entity: ProposalExecutionEntity,
    routePath: "proposal-executions",
  },
];

function parseStringList(value: unknown): string[] {
  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RequestValidationError("limit must be a positive integer");
  }
  return Math.min(parsed, max);
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new RequestValidationError("offset must be a non-negative integer");
  }
  return parsed;
}

function buildDefaultSort(fields: string[]): Array<{ field: string; order: SortDirection }> {
  const fieldSet = new Set(fields);
  const sort: Array<{ field: string; order: SortDirection }> = [];

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

function parseSortList(metadata: EntityMetadata, value: unknown): FindOptionsOrder<ObjectLiteral> {
  const order: Record<string, SortDirection> = {};
  const allowedFields = new Set(metadata.columns.map((column) => column.propertyName));
  const seenFields = new Set<string>();
  const rawSorts = parseStringList(value);

  for (const rawSort of rawSorts) {
    const [field, rawDirection = "ASC"] = rawSort.split(",");
    if (!field || !allowedFields.has(field)) {
      throw new RequestValidationError(`unsupported sort field: ${field || rawSort}`);
    }
    const direction = rawDirection.toUpperCase();
    if (direction !== "ASC" && direction !== "DESC") {
      throw new RequestValidationError(`unsupported sort direction: ${rawDirection}`);
    }
    order[field] = direction;
    seenFields.add(field);
  }

  for (const defaultSort of buildDefaultSort(Array.from(allowedFields))) {
    if (seenFields.has(defaultSort.field)) {
      continue;
    }
    order[defaultSort.field] = defaultSort.order;
  }

  return order as FindOptionsOrder<ObjectLiteral>;
}

function appendJoinPath(
  relations: RelationTree,
  metadata: EntityMetadata,
  relationPath: string,
): void {
  const segments = relationPath.split(".").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new RequestValidationError("join must reference a relation path");
  }

  let currentNode = relations;
  let currentMetadata = metadata;

  for (const segment of segments) {
    const relation = currentMetadata.relations.find(
      (candidate) => candidate.propertyName === segment,
    );
    if (!relation) {
      throw new RequestValidationError(`unsupported join path: ${relationPath}`);
    }
    const existing = currentNode[segment];
    if (existing === undefined || existing === true) {
      currentNode[segment] = {};
    }
    currentNode = currentNode[segment] as RelationTree;
    currentMetadata = relation.inverseEntityMetadata;
  }
}

function parseJoinList(
  metadata: EntityMetadata,
  value: unknown,
): FindOptionsRelations<ObjectLiteral> {
  const relations: RelationTree = {};
  for (const join of parseStringList(value)) {
    appendJoinPath(relations, metadata, join);
  }
  return relations as FindOptionsRelations<ObjectLiteral>;
}

function toPage(offset: number, limit: number): number {
  return Math.floor(offset / limit) + 1;
}

function createWhereByPrimaryColumn(metadata: EntityMetadata, id: string): Record<string, string> {
  const primaryColumn = metadata.primaryColumns[0];
  if (!primaryColumn) {
    throw new Error(`Entity ${metadata.name} does not expose a primary column`);
  }
  return {
    [primaryColumn.propertyName]: id,
  };
}

export function createProcessorCrudRoutes({
  dataSource,
  pageLimitDefault = DEFAULT_PAGE_LIMIT,
  pageLimitMax = DEFAULT_PAGE_LIMIT_MAX,
}: ProcessorCrudRoutesOptions): NonNullable<EventsApiServerOptions["registerRoutes"]> {
  const resolvedPageLimitDefault = Math.max(1, pageLimitDefault);
  const resolvedPageLimitMax = Math.max(resolvedPageLimitDefault, pageLimitMax);

  return (app) => {
    app.get("/healthz", (_request, response) => {
      response.json({ ok: true });
    });

    for (const { entity, routePath } of EXPOSED_ENTITIES) {
      const basePath = `/${routePath}`;

      app.get(basePath, async (request, response) => {
        try {
          const metadata = dataSource.getMetadata(entity);
          const repository = dataSource.getRepository(entity);
          const limit = parsePositiveInt(
            request.query.limit,
            resolvedPageLimitDefault,
            resolvedPageLimitMax,
          );
          const offset = parseNonNegativeInt(request.query.offset, 0);
          const order = parseSortList(metadata, request.query.sort);
          const relations = parseJoinList(metadata, request.query.join);
          const [items, total] = await repository.findAndCount({
            relations,
            order,
            skip: offset,
            take: limit,
          });

          response.json({
            data: items,
            count: items.length,
            total,
            page: toPage(offset, limit),
            pageCount: Math.ceil(total / limit),
          });
        } catch (error) {
          if (error instanceof RequestValidationError) {
            response.status(400).json({ error: error.message });
            return;
          }
          console.error(`[processor-api] failed to fetch ${basePath}`, error);
          response.status(500).json({ error: "Internal server error" });
        }
      });

      app.get(`${basePath}/:id`, async (request, response) => {
        try {
          const metadata = dataSource.getMetadata(entity);
          const repository = dataSource.getRepository(entity);
          const relations = parseJoinList(metadata, request.query.join);
          const item = await repository.findOne({
            where: createWhereByPrimaryColumn(metadata, request.params.id),
            relations,
          });
          if (!item) {
            response.status(404).json({ error: "Not found" });
            return;
          }
          response.json(item);
        } catch (error) {
          if (error instanceof RequestValidationError) {
            response.status(400).json({ error: error.message });
            return;
          }
          console.error(`[processor-api] failed to fetch ${basePath} by id`, error);
          response.status(500).json({ error: "Internal server error" });
        }
      });
    }
  };
}
