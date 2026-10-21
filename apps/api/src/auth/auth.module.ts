import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { LoginLimiter } from './login-limiter.service';

@Module({ imports: [DatabaseModule], controllers: [AuthController], providers: [AuthService, PasswordService, LoginLimiter] })
export class AuthModule {}
