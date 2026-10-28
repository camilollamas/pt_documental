/** Subconjunto común: lo aceptan tanto ioredis como BullMQ 6 (que define su propio tipo de opciones). */
export type RedisConnection = {
  host: string;
  port: number;
  db: number;
  username?: string;
  password?: string;
  tls?: object;
};

/**
 * Opciones de conexión a partir de REDIS_URL, para TODAS las conexiones (cola BullMQ, Pub/Sub,
 * scripts). Se pasan opciones y no una instancia para que cada cliente gestione sus conexiones.
 * Conserva usuario (ACL de Redis 6+), contraseña, base y TLS (`rediss://`), necesarios en Redis gestionado.
 */
export function redisOptions(url: string): RedisConnection {
  const parsed = new URL(url);
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ''), // [::1] → ::1
    port: Number(parsed.port || 6379),
    db: Number(parsed.pathname.slice(1) || 0),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
  };
}
