import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StreakService } from './streak.service';
import { StreakController } from './streak.controller';
import { Streak } from './streak.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Streak])],
  providers: [StreakService],
  controllers: [StreakController],
  exports: [StreakService],
})
export class StreakModule {}
