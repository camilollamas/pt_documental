import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { authConfig } from './auth.config.js';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  async login(username: string, password: string) {
    const { adminUsername, adminPasswordHash, jwtExpiresIn } = authConfig();

    // bcrypt se ejecuta siempre, aunque el usuario no coincida: el tiempo de respuesta
    // no revela si el usuario existe. El usuario se compara en tiempo constante.
    const passwordMatches = await bcrypt.compare(password, adminPasswordHash);
    const usernameMatches = timingSafeEqual(sha256(username), sha256(adminUsername));
    if (!passwordMatches || !usernameMatches) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    return {
      accessToken: await this.jwt.signAsync({ sub: adminUsername }),
      expiresIn: jwtExpiresIn,
    };
  }

  async isValidToken(token: string | undefined): Promise<boolean> {
    if (!token) return false;
    try {
      await this.jwt.verifyAsync(token);
      return true;
    } catch {
      return false;
    }
  }
}
