import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { StreakService } from './streak.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';

@ApiTags('streak')
@ApiBearerAuth()
@Controller('streak')
export class StreakController {
  constructor(private streakService: StreakService) {}

  @Get()
  @ApiOperation({ summary: 'Get current streak status' })
  get(@CurrentUser() user: User) {
    return this.streakService.get(user.id);
  }
}
