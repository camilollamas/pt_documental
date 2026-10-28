import { redisOptions } from './redis.js';

describe('redisOptions', () => {
  it('lee host, puerto y base de una URL simple', () => {
    expect(redisOptions('redis://localhost:6379/1')).toEqual({
      host: 'localhost',
      port: 6379,
      db: 1,
      username: undefined,
      password: undefined,
      tls: undefined,
    });
  });

  it('conserva usuario, contraseña (codificada) y TLS de un Redis gestionado', () => {
    expect(redisOptions('rediss://app:p%40ss@cache.example.com:6380/2')).toEqual({
      host: 'cache.example.com',
      port: 6380,
      db: 2,
      username: 'app',
      password: 'p@ss',
      tls: {},
    });
  });

  it('acepta un host IPv6 (sin los corchetes de la URL)', () => {
    expect(redisOptions('redis://[::1]:6379').host).toBe('::1');
  });

  it('usa el puerto 6379 y la base 0 por defecto', () => {
    expect(redisOptions('redis://redis')).toMatchObject({ port: 6379, db: 0 });
  });
});
