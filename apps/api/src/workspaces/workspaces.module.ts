import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { WorkspaceAccess } from './workspace-access.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({ imports: [AuthModule, DatabaseModule], providers: [WorkspaceAccess, WorkspacesService], controllers: [WorkspacesController], exports: [WorkspaceAccess] })
export class WorkspacesModule {}
