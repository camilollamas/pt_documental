import { appConfig } from '../common/config.js';

/**
 * Falla al arrancar si la autenticación está mal configurada: es preferible que la API no
 * levante a que levante con un secreto débil o sin administrador.
 */
export function authConfig() {
  const config = appConfig();
  if (config.jwtSecret.length < 32) {
    throw new Error('JWT_SECRET es obligatorio y debe tener al menos 32 caracteres.');
  }
  if (!/^\$2[aby]\$\d{2}\$.{53}$/.test(config.adminPasswordHash)) {
    throw new Error(
      'ADMIN_PASSWORD_HASH es obligatorio y debe ser un hash bcrypt. Genéralo con: npm run hash-password',
    );
  }
  return config;
}

export function extractBearerToken(header: string | undefined): string | undefined {
  const [scheme, token] = header?.split(' ') ?? [];
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}
