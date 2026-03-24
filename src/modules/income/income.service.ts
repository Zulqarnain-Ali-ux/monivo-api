import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Income } from './income.entity';
import { IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateIncomeDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @IsOptional() @Min(0) salary?: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsOptional() @Min(0) side?: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsOptional() @Min(0) passive?: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsOptional() @Min(0) savingsGoal?: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsOptional() @Min(0) investGoal?: number;
}

@Injectable()
export class IncomeService {
  constructor(
    @InjectRepository(Income) private incomeRepo: Repository<Income>,
  ) {}

  async get(userId: string): Promise<Income> {
    let income = await this.incomeRepo.findOne({ where: { userId } });
    if (!income) {
      income = this.incomeRepo.create({ userId });
      await this.incomeRepo.save(income);
    }
    return income;
  }

  async update(userId: string, dto: UpdateIncomeDto): Promise<Income> {
    const income = await this.get(userId);
    Object.assign(income, dto);
    return this.incomeRepo.save(income);
  }

  totalMonthly(income: Income): number {
    return (
      Number(income.salary) + Number(income.side) + Number(income.passive)
    );
  }
}
