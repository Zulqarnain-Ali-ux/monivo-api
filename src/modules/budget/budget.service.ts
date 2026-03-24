import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { BudgetGroup } from './budget-category.entity';
import { BudgetCategory } from './budget-category.entity';
import { IsString, IsNumber, IsOptional, MaxLength, IsIn, Min } from 'class-validator';

export class UpdateCategoryDto {
  @IsString() @IsOptional() @MaxLength(100) name?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsOptional() @Min(0) amount?: number;
  @IsString() @IsOptional() @MaxLength(10) icon?: string;
  @IsIn(['fixed','variable','financial']) @IsOptional() groupType?: string;
}

export class CreateCategoryDto {
  @IsString() @MaxLength(50) catId: string;
  @IsString() @MaxLength(100) name: string;
  @IsIn(['fixed','variable','financial']) groupType: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) amount: number;
  @IsString() @IsOptional() @MaxLength(10) icon?: string;
}

export class AutopilotDto {
  @IsIn(['aggressive','balanced','free']) mode: 'aggressive' | 'balanced' | 'free';
}

const AUTOPILOT_MULTIPLIERS = { aggressive: 0.80, balanced: 1.0, free: 1.15 };

@Injectable()
export class BudgetService {
  constructor(
    @InjectRepository(BudgetCategory) private catRepo: Repository<BudgetCategory>,
  ) {}

  findAll(userId: string): Promise<BudgetCategory[]> {
    return this.catRepo.find({ where: { userId }, order: { sortOrder: 'ASC' } });
  }

  async updateOne(userId: string, catId: string, dto: UpdateCategoryDto): Promise<BudgetCategory> {
    const cat = await this.catRepo.findOne({ where: { userId, catId } });
    if (!cat) throw new NotFoundException(`Category '${catId}' not found`);
    Object.assign(cat, dto);
    return this.catRepo.save(cat);
  }

  async bulkUpdate(userId: string, updates: Array<{ catId: string } & UpdateCategoryDto>): Promise<BudgetCategory[]> {
    const results: BudgetCategory[] = [];
    for (const u of updates) {
      const { catId, ...rest } = u;
      const cat = await this.catRepo.findOne({ where: { userId, catId } });
      if (cat) { Object.assign(cat, rest); results.push(await this.catRepo.save(cat)); }
    }
    return results;
  }

  async addCategory(userId: string, dto: CreateCategoryDto): Promise<BudgetCategory> {
    const count = await this.catRepo.count({ where: { userId } });
    const cat = this.catRepo.create({
      ...dto,
      groupType: dto.groupType as BudgetGroup,
      userId, sortOrder: count, isDefault: false, icon: dto.icon ?? '📌',
    });
    return this.catRepo.save(cat);
  }

  async removeCategory(userId: string, id: string): Promise<void> {
    const cat = await this.catRepo.findOne({ where: { id } });
    if (!cat) throw new NotFoundException();
    if (cat.userId !== userId) throw new ForbiddenException();
    if (cat.isDefault) throw new ForbiddenException('Cannot delete default categories');
    await this.catRepo.remove(cat);
  }

  async applyAutopilot(userId: string, mode: 'aggressive' | 'balanced' | 'free'): Promise<BudgetCategory[]> {
    const multiplier = AUTOPILOT_MULTIPLIERS[mode];
    const cats = await this.catRepo.find({ where: { userId, groupType: 'variable' } });
    for (const cat of cats) {
      cat.amount = Math.round(Number(cat.amount) * multiplier * 100) / 100;
    }
    return this.catRepo.save(cats);
  }
}
