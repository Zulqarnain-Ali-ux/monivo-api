import {
  IsString, IsNumber, IsPositive, IsDateString,
  IsOptional, MaxLength, IsInt, Min, Max,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateEntryDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsString()
  @MaxLength(100)
  category: string;

  @IsDateString()
  entryDate: string; // YYYY-MM-DD

  @IsNumber()
  entryTs: number;   // unix ms

  @IsString()
  @IsOptional()
  @MaxLength(500)
  note?: string;
}

export class QueryEntriesDto {
  @IsDateString() @IsOptional() from?: string;
  @IsDateString() @IsOptional() to?: string;
  @IsString() @IsOptional() @MaxLength(100) category?: string;

  /** Cursor pagination: pass entryTs of last received item */
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  @IsInt() @Min(0)
  cursor?: number;

  /** Page size — default 50, max 200 */
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : undefined))
  @IsInt() @Min(1) @Max(200)
  limit?: number;
}
