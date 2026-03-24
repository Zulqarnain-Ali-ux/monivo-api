import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
    @InjectQueue('notifications') private notifQueue: Queue,
  ) {}

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — ECS restarts if this fails' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks DB and Redis' })
  async ready() {
    const checks: Record<string, string> = {};
    let healthy = true;

    try {
      await this.dataSource.query('SELECT 1');
      checks['postgres'] = 'ok';
    } catch {
      checks['postgres'] = 'error';
      healthy = false;
    }

    try {
      await this.notifQueue.client.ping();
      checks['redis'] = 'ok';
    } catch {
      checks['redis'] = 'error';
      healthy = false;
    }

    return { status: healthy ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() };
  }
}
