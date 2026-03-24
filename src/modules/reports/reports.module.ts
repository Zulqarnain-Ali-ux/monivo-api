import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { Entry } from '../entries/entry.entity';
import { BudgetCategory } from '../budget/budget-category.entity';
import { Income } from '../income/income.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Entry, BudgetCategory, Income])],
  providers: [ReportsService],
  controllers: [ReportsController],
  exports: [ReportsService],
})
export class ReportsModule {}
