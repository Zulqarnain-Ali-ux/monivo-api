import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { GoalType } from './goal.entity';
import { Goal } from './goal.entity';
import { IsString, IsNumber, IsOptional, MaxLength, IsIn, Min } from 'class-validator';

export class CreateGoalDto {
  @IsString() @MaxLength(200) name: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) target: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsOptional() @Min(0) saved?: number;
  @IsIn(['emergency','vacation','house','debt','invest','other']) @IsOptional() goalType?: string;
}

export class UpdateGoalDto {
  @IsString() @IsOptional() @MaxLength(200) name?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsOptional() @Min(0) saved?: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsOptional() @Min(1) target?: number;
}

@Injectable()
export class GoalsService {
  constructor(@InjectRepository(Goal) private goalRepo: Repository<Goal>) {}

  findAll(userId: string): Promise<Goal[]> {
    return this.goalRepo.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  create(userId: string, dto: CreateGoalDto): Promise<Goal> {
    const goal = this.goalRepo.create({
      userId, name: dto.name, target: dto.target,
      saved: dto.saved ?? 0,
      goalType: (dto.goalType ?? 'other') as GoalType,
    });
    return this.goalRepo.save(goal);
  }

  async update(userId: string, id: string, dto: UpdateGoalDto): Promise<Goal> {
    const goal = await this.goalRepo.findOne({ where: { id } });
    if (!goal) throw new NotFoundException();
    if (goal.userId !== userId) throw new ForbiddenException();
    Object.assign(goal, dto);
    return this.goalRepo.save(goal);
  }

  async remove(userId: string, id: string): Promise<void> {
    const goal = await this.goalRepo.findOne({ where: { id } });
    if (!goal) throw new NotFoundException();
    if (goal.userId !== userId) throw new ForbiddenException();
    await this.goalRepo.remove(goal);
  }
}
