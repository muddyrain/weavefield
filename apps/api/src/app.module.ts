import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { HealthController } from './health.controller';

@Module({ imports: [AuthModule, WorkspacesModule], controllers: [HealthController] })
export class AppModule {}
