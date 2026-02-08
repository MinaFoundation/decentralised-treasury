import { RedisMemoryServer } from "redis-memory-server";

export async function createRedisServer() {
  const redisServer = new RedisMemoryServer({
    instance: {
      ip: "127.0.0.1",
    },
  });
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const redisUrl = `redis://${redisHost}:${redisPort}`;
  return { redisServer, redisUrl };
}
