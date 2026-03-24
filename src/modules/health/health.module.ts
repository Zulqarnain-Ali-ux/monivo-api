import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { HealthController } from './health.controller';

@Module({
  imports: [BullModule.registerQueue({ name: 'notifications' })],
  controllers: [HealthController],
})
export class HealthModule {}
