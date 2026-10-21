import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { LoginLimiter } from './login-limiter.service';
import { SessionGuard } from './session.guard';

@Module({ imports: [DatabaseModule], controllers: [AuthController], providers: [AuthService, PasswordService, LoginLimiter, SessionGuard], exports: [AuthService, SessionGuard] })
export class AuthModule {}
