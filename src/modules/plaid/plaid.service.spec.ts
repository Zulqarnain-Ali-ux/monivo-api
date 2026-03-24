import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { PlaidService } from './plaid.service';
import { PlaidItem }    from './plaid-item.entity';
import { Entry }        from '../entries/entry.entity';
import { StreakService } from '../streak/streak.service';

// We test the category mapper and the sync orchestration logic,
// mocking Plaid API and KMS to avoid network calls.

const mockPlaidItemRepo = () => ({
  findOne: jest.fn(),
  create:  jest.fn().mockImplementation((d: unknown) => d),
  save:    jest.fn().mockImplementation((d: unknown) => Promise.resolve({ id: 'item-1', ...d as object })),
  find:    jest.fn(),
});

const mockEntryRepo = () => ({
  findOne: jest.fn().mockResolvedValue(null), // no duplicate entries
  create:  jest.fn().mockImplementation((d: unknown) => d),
  save:    jest.fn().mockImplementation((d: unknown) => Promise.resolve({ id: 'e-new', ...d as object })),
  remove:  jest.fn().mockResolvedValue(undefined),
});

const mockStreak = () => ({
  update: jest.fn().mockResolvedValue({ days: 1 }),
});

const mockConfig = () => ({
  get: jest.fn((key: string) => {
    const map: Record<string, unknown> = {
      'plaid.env':      'sandbox',
      'plaid.clientId': 'test-client-id',
      'plaid.secret':   'test-secret',
      'plaid.webhookUrl': 'https://api.monivo.ai/plaid/webhook',
      'aws.region':     'us-east-1',
      'aws.kmsKeyId':   '',   // empty = base64 fallback in dev
    };
    return map[key];
  }),
});

describe('PlaidService', () => {
  let service: PlaidService;
  let itemRepo: ReturnType<typeof mockPlaidItemRepo>;
  let entryRepo: ReturnType<typeof mockEntryRepo>;
  let streakService: ReturnType<typeof mockStreak>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaidService,
        { provide: getRepositoryToken(PlaidItem), useFactory: mockPlaidItemRepo },
        { provide: getRepositoryToken(Entry),     useFactory: mockEntryRepo },
        { provide: StreakService,                 useFactory: mockStreak },
        { provide: ConfigService,                 useFactory: mockConfig },
      ],
    }).compile();

    service      = module.get(PlaidService);
    itemRepo     = module.get(getRepositoryToken(PlaidItem));
    entryRepo    = module.get(getRepositoryToken(Entry));
    streakService = module.get(StreakService);
  });

  // ── KMS fallback encryption ────────────────────────────────────
  describe('token encryption (dev base64 fallback)', () => {
    it('encrypts and decrypts round-trip when KMS key not configured', async () => {
      // Access private methods via type casting for unit testing
      const svc = service as unknown as {
        encryptToken: (s: string) => Promise<string>;
        decryptToken: (s: string) => Promise<string>;
      };
      const token = 'access-sandbox-test-token';
      const encrypted = await svc.encryptToken(token);
      expect(encrypted).not.toBe(token);
      const decrypted = await svc.decryptToken(encrypted);
      expect(decrypted).toBe(token);
    });

    it('encryption produces base64 output when KMS not configured', async () => {
      const svc = service as unknown as { encryptToken: (s: string) => Promise<string> };
      const encrypted = await svc.encryptToken('test-token');
      // base64 only has A-Z a-z 0-9 + / = characters
      expect(/^[A-Za-z0-9+/=]+$/.test(encrypted)).toBe(true);
    });
  });

  // ── getConnectedItems ──────────────────────────────────────────
  describe('getConnectedItems()', () => {
    it('returns only active items for the user', async () => {
      itemRepo.find.mockResolvedValue([
        { id: 'i1', plaidItemId: 'plaid-1', institutionName: 'Chase', isActive: true },
      ]);
      const result = await service.getConnectedItems('u1');
      expect(itemRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', isActive: true } }),
      );
      expect(result).toHaveLength(1);
    });
  });

  // ── disconnectItem ─────────────────────────────────────────────
  describe('disconnectItem()', () => {
    it('marks item as inactive rather than deleting', async () => {
      const item = { id: 'i1', userId: 'u1', isActive: true, accessTokenEncrypted: Buffer.from('token').toString('base64') };
      itemRepo.findOne.mockResolvedValue(item);

      // Mock the Plaid client itemRemove call
      const plaidClient = (service as unknown as { client: { itemRemove: jest.Mock } }).client;
      plaidClient.itemRemove = jest.fn().mockResolvedValue({ data: {} });

      await service.disconnectItem('u1', 'i1');
      expect(itemRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });

    it('throws NotFoundException for unknown item', async () => {
      itemRepo.findOne.mockResolvedValue(null);
      await expect(service.disconnectItem('u1', 'ghost')).rejects.toThrow(NotFoundException);
    });

    it('marks inactive even if Plaid itemRemove fails', async () => {
      const item = { id: 'i1', userId: 'u1', isActive: true, accessTokenEncrypted: Buffer.from('token').toString('base64') };
      itemRepo.findOne.mockResolvedValue(item);
      const plaidClient = (service as unknown as { client: { itemRemove: jest.Mock } }).client;
      plaidClient.itemRemove = jest.fn().mockRejectedValue(new Error('Plaid error'));

      await service.disconnectItem('u1', 'i1');
      expect(itemRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });

  // ── syncTransactions ──────────────────────────────────────────
  describe('syncTransactions()', () => {
    it('throws NotFoundException for unknown plaidItemId', async () => {
      itemRepo.findOne.mockResolvedValue(null);
      await expect(service.syncTransactions('u1', 'ghost-item')).rejects.toThrow(NotFoundException);
    });

    it('skips pending transactions', async () => {
      const item = {
        id: 'i1', userId: 'u1', plaidItemId: 'plaid-1', isActive: true,
        cursor: null, accessTokenEncrypted: Buffer.from('token').toString('base64'),
      };
      itemRepo.findOne.mockResolvedValue(item);

      const client = (service as unknown as { client: { transactionsSync: jest.Mock } }).client;
      client.transactionsSync = jest.fn().mockResolvedValue({
        data: {
          added: [{ transaction_id: 'tx1', pending: true, amount: 25.00, category: ['Food'], date: '2026-03-15', datetime: null, merchant_name: 'Test' }],
          modified: [], removed: [],
          has_more: false, next_cursor: 'cursor-1',
        },
      });

      const count = await service.syncTransactions('u1', 'plaid-1');
      expect(count).toBe(0);              // pending tx skipped
      expect(entryRepo.save).not.toHaveBeenCalled();
    });

    it('skips credit/refund transactions (negative amount)', async () => {
      const item = {
        id: 'i1', userId: 'u1', plaidItemId: 'plaid-1', isActive: true,
        cursor: null, accessTokenEncrypted: Buffer.from('token').toString('base64'),
      };
      itemRepo.findOne.mockResolvedValue(item);

      const client = (service as unknown as { client: { transactionsSync: jest.Mock } }).client;
      client.transactionsSync = jest.fn().mockResolvedValue({
        data: {
          added: [{ transaction_id: 'tx1', pending: false, amount: -50.00, category: ['Transfer'], date: '2026-03-15', datetime: null, merchant_name: 'Refund' }],
          modified: [], removed: [],
          has_more: false, next_cursor: 'cursor-2',
        },
      });

      const count = await service.syncTransactions('u1', 'plaid-1');
      expect(count).toBe(0);
    });

    it('persists cursor after successful sync', async () => {
      const item = {
        id: 'i1', userId: 'u1', plaidItemId: 'plaid-1', isActive: true,
        cursor: null, accessTokenEncrypted: Buffer.from('token').toString('base64'),
      };
      itemRepo.findOne.mockResolvedValue(item);

      const client = (service as unknown as { client: { transactionsSync: jest.Mock } }).client;
      client.transactionsSync = jest.fn().mockResolvedValue({
        data: { added: [], modified: [], removed: [], has_more: false, next_cursor: 'new-cursor' },
      });

      await service.syncTransactions('u1', 'plaid-1');
      expect(itemRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: 'new-cursor' }),
      );
    });
  });
});
