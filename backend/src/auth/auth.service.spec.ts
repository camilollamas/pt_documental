import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { AuthService } from './auth.service.js';

describe('AuthService', () => {
  const jwt = new JwtService({ secret: 'secreto-unitario-con-mas-de-32-caracteres' });
  const service = new AuthService(jwt);

  beforeAll(async () => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash('clave-correcta-123', 4);
    process.env.JWT_SECRET = 'secreto-unitario-con-mas-de-32-caracteres';
  });

  it('emite un token verificable con credenciales correctas', async () => {
    const { accessToken } = await service.login('admin', 'clave-correcta-123');
    expect(await service.isValidToken(accessToken)).toBe(true);
  });

  it('rechaza usuario o contraseña incorrectos', async () => {
    await expect(service.login('admin', 'otra')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.login('root', 'clave-correcta-123')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('considera inválidos los tokens ausentes o manipulados', async () => {
    const { accessToken } = await service.login('admin', 'clave-correcta-123');
    expect(await service.isValidToken(undefined)).toBe(false);
    expect(await service.isValidToken(accessToken.slice(0, -2) + 'xx')).toBe(false);
  });

  it('no arranca con un secreto JWT débil o sin hash de administrador', async () => {
    process.env.JWT_SECRET = 'corto';
    await expect(service.login('admin', 'x')).rejects.toThrow(/JWT_SECRET/);
    process.env.JWT_SECRET = 'secreto-unitario-con-mas-de-32-caracteres';

    process.env.ADMIN_PASSWORD_HASH = 'clave-en-claro';
    await expect(service.login('admin', 'x')).rejects.toThrow(/ADMIN_PASSWORD_HASH/);
  });
});
