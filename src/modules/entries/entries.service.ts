import {
  Injectable, NotFoundException, ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThan, FindManyOptions } from 'typeorm';
import { Entry } from './entry.entity';
import { CreateEntryDto, QueryEntriesDto } from './entries.dto';
import { StreakService } from '../streak/streak.service';

export interface EntriesPage {
  items:      Entry[];
  nextCursor: number | null;
  total:      number;
}

@Injectable()
export class EntriesService {
  constructor(
    @InjectRepository(Entry) private entryRepo: Repository<Entry>,
    private streakService: StreakService,
  ) {}

  async findAll(userId: string, query: QueryEntriesDto): Promise<EntriesPage> {
    const limit = query.limit ?? 50;

    // Build base where clause
    const baseWhere: Record<string, unknown> = { userId };
    if (query.from && query.to)  baseWhere['entryDate'] = Between(query.from, query.to);
    if (query.category)          baseWhere['category']  = query.category;

    // Cursor where (for next-page fetches)
    const pageWhere = { ...baseWhere };
    if (query.cursor) pageWhere['entryTs'] = LessThan(query.cursor);

    const opts: FindManyOptions<Entry> = {
      where: pageWhere as any,
      order: { entryTs: 'DESC' },
      take: limit + 1,
    };

    const [items, total] = await Promise.all([
      this.entryRepo.find(opts),
      this.entryRepo.count({ where: baseWhere as any }),
    ]);

    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].entryTs : null,
      total,
    };
  }

  async findToday(userId: string): Promise<Entry[]> {
    const today = new Date().toISOString().slice(0, 10);
    return this.entryRepo.find({
      where: { userId, entryDate: today },
      order: { entryTs: 'DESC' },
    });
  }

  async create(userId: string, dto: CreateEntryDto): Promise<Entry> {
    const entry = this.entryRepo.create({
      userId,
      amount:    dto.amount,
      category:  dto.category,
      entryDate: dto.entryDate,
      entryTs:   dto.entryTs,
      note:      dto.note ?? '',
    });
    const saved = await this.entryRepo.save(entry);
    await this.streakService.update(userId, dto.entryDate);
    return saved;
  }

  async remove(userId: string, entryId: string): Promise<void> {
    const entry = await this.entryRepo.findOne({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Entry not found');
    if (entry.userId !== userId) throw new ForbiddenException();
    await this.entryRepo.remove(entry);
  }

  async getMonthRange(userId: string, from: string, to: string): Promise<Entry[]> {
    return this.entryRepo.find({
      where: { userId, entryDate: Between(from, to) as any } as any,
      order: { entryDate: 'ASC', entryTs: 'ASC' },
    });
  }
}
