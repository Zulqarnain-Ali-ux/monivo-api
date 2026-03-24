import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';

class DailyQueryDto {
  @IsDateString() from: string;
  @IsDateString() to: string;
}

class MonthlyQueryDto {
  @IsInt() @Min(1) @Max(24) @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  months?: number;
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Current month breakdown with budget vs actual' })
  currentMonth(@CurrentUser() user: User) {
    return this.reportsService.currentMonthBreakdown(user.id);
  }

  @Get('monthly')
  @ApiOperation({ summary: 'Last N months spending totals (default 6)' })
  monthly(@CurrentUser() user: User, @Query() query: MonthlyQueryDto) {
    return this.reportsService.monthlySummary(user.id, query.months ?? 6);
  }

  @Get('daily')
  @ApiOperation({ summary: 'Daily totals for a date range' })
  daily(@CurrentUser() user: User, @Query() query: DailyQueryDto) {
    return this.reportsService.dailyTotals(user.id, query.from, query.to);
  }

  @Get('benchmarks')
  @ApiOperation({ summary: 'How your spending compares to anonymous peers' })
  benchmarks(@CurrentUser() user: User) {
    return this.reportsService.benchmarks(user.id);
  }
}
