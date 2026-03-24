import {
  Controller, Get, Patch, Post, Delete,
  Body, Param, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { BudgetService, UpdateCategoryDto, CreateCategoryDto, AutopilotDto } from './budget.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';

@ApiTags('budget')
@ApiBearerAuth()
@Controller('budget')
export class BudgetController {
  constructor(private budgetService: BudgetService) {}

  @Get()
  @ApiOperation({ summary: 'Get all budget categories' })
  findAll(@CurrentUser() user: User) {
    return this.budgetService.findAll(user.id);
  }

  @Patch('categories/:catId')
  @ApiOperation({ summary: 'Update a single category amount or name' })
  updateOne(
    @CurrentUser() user: User,
    @Param('catId') catId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.budgetService.updateOne(user.id, catId, dto);
  }

  @Patch('categories')
  @ApiOperation({ summary: 'Bulk update multiple categories at once' })
  bulkUpdate(
    @CurrentUser() user: User,
    @Body() updates: Array<{ catId: string } & UpdateCategoryDto>,
  ) {
    return this.budgetService.bulkUpdate(user.id, updates);
  }

  @Post('categories')
  @ApiOperation({ summary: 'Add a custom category' })
  addCategory(@CurrentUser() user: User, @Body() dto: CreateCategoryDto) {
    return this.budgetService.addCategory(user.id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a custom category' })
  removeCategory(@CurrentUser() user: User, @Param('id') id: string) {
    return this.budgetService.removeCategory(user.id, id);
  }

  @Post('autopilot')
  @ApiOperation({ summary: 'Apply autopilot mode (aggressive / balanced / free)' })
  autopilot(@CurrentUser() user: User, @Body() dto: AutopilotDto) {
    return this.budgetService.applyAutopilot(user.id, dto.mode);
  }
}
