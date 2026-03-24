import {
  Injectable, NotFoundException, ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IsString, IsOptional, MaxLength, IsEmail } from 'class-validator';
import { Transform } from 'class-transformer';
import { User } from './user.entity';

export class UpdateProfileDto {
  @IsString()  @IsOptional() @MaxLength(100) fname?: string;
  @IsString()  @IsOptional() @MaxLength(100) lname?: string;
  @IsEmail()   @IsOptional()
  @Transform(({ value }) => (value as string)?.toLowerCase().trim())
  email?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  async update(userId: string, dto: UpdateProfileDto): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.email && dto.email !== user.email) {
      const existing = await this.userRepo.findOne({ where: { email: dto.email } });
      if (existing) throw new ConflictException('Email already in use');
    }

    if (dto.fname !== undefined) user.fname = dto.fname;
    if (dto.lname !== undefined) user.lname = dto.lname;
    if (dto.email !== undefined) user.email = dto.email;

    if (dto.fname !== undefined || dto.lname !== undefined) {
      user.initials = (
        (user.fname[0] ?? '') + (user.lname?.[0] ?? '')
      ).toUpperCase() || null;
    }

    return this.userRepo.save(user);
  }

  async deactivate(userId: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.isActive = false;
    user.refreshTokenHash = null;
    await this.userRepo.save(user);
  }
}
