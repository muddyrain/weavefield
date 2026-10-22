import { ApiContract } from './openapi/api-contract';
import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  @ApiContract({ tag: 'Health', summary: '读取进程健康状态', description: '静态进程探针，不代表数据库连通性或正式协作可用。', status: 200, response: 'Health' })
  check() {
    return { ok: true, service: 'weavefield-api', version: '0.1.0' };
  }
}
