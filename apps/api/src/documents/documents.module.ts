import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({ imports: [AuthModule, DatabaseModule, WorkspacesModule], providers: [DocumentsService], controllers: [DocumentsController] })
export class DocumentsModule {}
