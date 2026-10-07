import { FileStore } from './file.js';
import { MemoryStore } from './memory.js';
import { RedisStore } from './redis.js';
import { SupabaseStore } from './supabase.js';

let instance = null;

/**
 * Lê uma variável de ambiente pelos nomes exatos; se não achar, aceita o mesmo nome com prefixo
 * (a Vercel permite "Custom Prefix" ao conectar o banco, ex.: STORAGE_SUPABASE_URL).
 */
export function pickEnv(env, names, suffixes = names) {
  for (const n of names) if (env[n]) return env[n];
  for (const k of Object.keys(env)) {
    if (!env[k] || k.startsWith('NEXT_PUBLIC_')) continue;
    if (suffixes.some(s => k.endsWith('_' + s))) return env[k];
  }
  return '';
}

const supabaseEnv = env => ({
  url: pickEnv(env, ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'], ['SUPABASE_URL']),
  key: pickEnv(env, ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'], ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY']),
});
const redisEnv = env => ({
  url: pickEnv(env, ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'], ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL']),
  token: pickEnv(env, ['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'], ['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN']),
});

/** Texto do aviso "modo demonstração" que diz exatamente o que falta configurar (sem revelar valores). */
export function storageNote(env = process.env) {
  const sb = supabaseEnv(env), rd = redisEnv(env);
  if (sb.url && !sb.key) return 'O Supabase foi encontrado, mas falta a chave de servidor (SUPABASE_SERVICE_ROLE_KEY) nas variáveis da Vercel.';
  if (!sb.url && sb.key) return 'Falta a variável SUPABASE_URL na Vercel.';
  if (rd.url && !rd.token) return 'O Redis foi encontrado, mas falta o token (KV_REST_API_TOKEN) nas variáveis da Vercel.';
  return 'Conecte o Supabase (rodando supabase/arena_kv.sql) ou o Upstash Redis na Vercel e faça um Redeploy (veja o README).';
}

/** Escolhe o armazenamento conforme o ambiente. */
export function getStore() {
  if (instance) return instance;
  const env = process.env, rd = redisEnv(env), sb = supabaseEnv(env);
  if (env.ARENA_STORE === 'memory') instance = new MemoryStore();
  else if (rd.url && rd.token) instance = new RedisStore({ url: rd.url, token: rd.token });
  else if (sb.url && sb.key) instance = new SupabaseStore({ url: sb.url, key: sb.key });
  else if (env.VERCEL) instance = new FileStore('/tmp/arena-data.json', { persistent: false });
  else instance = new FileStore(env.ARENA_DATA_FILE || '.data/arena.json', { persistent: true });
  return instance;
}
export function setStore(s) { instance = s; }
