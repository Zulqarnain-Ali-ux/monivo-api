import { Controller, Get, Put, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IncomeService, UpdateIncomeDto } from './income.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';

@ApiTags('income')
@ApiBearerAuth()
@Controller('income')
export class IncomeController {
  constructor(private incomeService: IncomeService) {}

  @Get()
  @ApiOperation({ summary: 'Get income configuration' })
  get(@CurrentUser() user: User) {
    return this.incomeService.get(user.id);
  }

  @Put()
  @ApiOperation({ summary: 'Update income (salary, side, passive, savings goal)' })
  update(@CurrentUser() user: User, @Body() dto: UpdateIncomeDto) {
    return this.incomeService.update(user.id, dto);
  }
}
