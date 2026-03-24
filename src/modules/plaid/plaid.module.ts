import { Module, MiddlewareConsumer, RequestMethod, NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlaidService } from './plaid.service';
import { PlaidController } from './plaid.controller';
import { PlaidWebhookMiddleware } from './plaid-webhook.middleware';
import { PlaidItem } from './plaid-item.entity';
import { Entry }     from '../entries/entry.entity';
import { StreakModule } from '../streak/streak.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlaidItem, Entry]),
    StreakModule,
  ],
  providers: [PlaidService],
  controllers: [PlaidController],
  exports: [PlaidService],
})
export class PlaidModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(PlaidWebhookMiddleware)
      .forRoutes({ path: 'plaid/webhook', method: RequestMethod.POST });
  }
}
