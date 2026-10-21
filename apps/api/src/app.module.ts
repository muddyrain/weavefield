import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthController } from './health.controller';

@Module({ imports: [AuthModule, WorkspacesModule, DocumentsModule], controllers: [HealthController] })
export class AppModule {}
