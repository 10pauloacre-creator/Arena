import { FileStore } from './file.js';
import { MemoryStore } from './memory.js';
import { RedisStore } from './redis.js';

let instance = null;

/** Escolhe o armazenamento conforme o ambiente. */
export function getStore() {
  if (instance) return instance;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (process.env.ARENA_STORE === 'memory') instance = new MemoryStore();
  else if (url && token) instance = new RedisStore({ url, token });
  else if (process.env.VERCEL) instance = new FileStore('/tmp/arena-data.json', { persistent: false });
  else instance = new FileStore(process.env.ARENA_DATA_FILE || '.data/arena.json', { persistent: true });
  return instance;
}
export function setStore(s) { instance = s; }
