import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import type { EmailJob } from './notifications.service';
import { NotificationsService } from './notifications.service';

@Processor('notifications')
export class NotificationsProcessor {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private notificationsService: NotificationsService) {}

  @Process()
  async handleEmail(job: Job<EmailJob>): Promise<void> {
    this.logger.debug(`Processing: ${job.data.type} → ${job.data.to}`);
    await this.notificationsService.send(job.data);
  }
}
