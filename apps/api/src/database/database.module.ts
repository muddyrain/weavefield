import { Injectable, Module, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { prisma } from '@weavefield/database';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly client = prisma;
  async onModuleInit() { await this.client.$connect(); }
  async onModuleDestroy() { await this.client.$disconnect(); }
}

@Module({ providers: [DatabaseService], exports: [DatabaseService] })
export class DatabaseModule {}
