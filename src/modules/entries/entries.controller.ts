import {
  Controller, Get, Post, Delete,
  Body, Param, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { EntriesService } from './entries.service';
import { CreateEntryDto, QueryEntriesDto } from './entries.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';

@ApiTags('entries')
@ApiBearerAuth()
@Controller('entries')
export class EntriesController {
  constructor(private entriesService: EntriesService) {}

  @Get()
  @ApiOperation({ summary: 'Get entries with cursor pagination and optional date/category filters' })
  @ApiQuery({ name: 'from',     required: false, description: 'Start date YYYY-MM-DD' })
  @ApiQuery({ name: 'to',       required: false, description: 'End date YYYY-MM-DD' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'cursor',   required: false, description: 'entryTs of last received item' })
  @ApiQuery({ name: 'limit',    required: false, description: 'Page size (default 50, max 200)' })
  findAll(@CurrentUser() user: User, @Query() query: QueryEntriesDto) {
    return this.entriesService.findAll(user.id, query);
  }

  @Get('today')
  @ApiOperation({ summary: "Get today's entries ordered newest first" })
  findToday(@CurrentUser() user: User) {
    return this.entriesService.findToday(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Log a new spending entry (also updates streak)' })
  create(@CurrentUser() user: User, @Body() dto: CreateEntryDto) {
    return this.entriesService.create(user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an entry by id' })
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.entriesService.remove(user.id, id);
  }
}
