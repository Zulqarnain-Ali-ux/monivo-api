import { IsEmail, IsString, MinLength, MaxLength, IsOptional, IsNumber, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class SignUpDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fname: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  lname?: string;

  @IsEmail()
  @Transform(({ value }) => (value as string).toLowerCase().trim())
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  income?: number;
}

export class SignInDto {
  @IsEmail()
  @Transform(({ value }) => (value as string).toLowerCase().trim())
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken: string;
}

export class AuthResponseDto {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fname: string;
    lname: string | null;
    initials: string | null;
  };
}
