import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { LoginDto } from './login.dto.js';

/** Solo login: no hay registro, recuperación de contraseña ni gestión de usuarios (administrador único). */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  login(@Body() { username, password }: LoginDto) {
    return this.auth.login(username, password);
  }
}
