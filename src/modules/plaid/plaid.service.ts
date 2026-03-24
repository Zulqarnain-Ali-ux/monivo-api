import {
  Injectable, Logger, NotFoundException,
  InternalServerErrorException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  SyncUpdatesAvailableWebhook,
  TransactionsSyncRequest,
} from 'plaid';
import * as AWS from 'aws-sdk';
import { PlaidItem } from './plaid-item.entity';
import { Entry } from '../entries/entry.entity';
import { StreakService } from '../streak/streak.service';

// Plaid category → MONIVO category mapping
const CATEGORY_MAP: Record<string, string> = {
  'Food and Drink': 'dining',
  'Restaurants': 'dining',
  'Coffee Shop': 'dining',
  'Groceries': 'groceries',
  'Supermarkets and Groceries': 'groceries',
  'Gas Stations': 'gas',
  'Transportation': 'transport',
  'Taxi': 'transport',
  'Ride Share': 'transport',
  'Entertainment': 'fun',
  'Recreation': 'fun',
  'Health': 'health',
  'Medical': 'health',
  'Pharmacies': 'health',
  'Shopping': 'shopping',
  'Service': 'other',
  'Transfer': 'other',
};

function mapCategory(plaidCategories: string[] | null): string {
  if (!plaidCategories?.length) return 'other';
  for (const cat of plaidCategories) {
    if (CATEGORY_MAP[cat]) return CATEGORY_MAP[cat];
  }
  return 'other';
}

@Injectable()
export class PlaidService {
  private readonly logger = new Logger(PlaidService.name);
  private readonly client: PlaidApi;
  private readonly kms: AWS.KMS;

  constructor(
    private configService: ConfigService,
    @InjectRepository(PlaidItem) private itemRepo: Repository<PlaidItem>,
    @InjectRepository(Entry) private entryRepo: Repository<Entry>,
    private streakService: StreakService,
  ) {
    const env = configService.get<string>('plaid.env') ?? 'sandbox';
    const config = new Configuration({
      basePath: PlaidEnvironments[env as keyof typeof PlaidEnvironments],
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': configService.get<string>('plaid.clientId'),
          'PLAID-SECRET':    configService.get<string>('plaid.secret'),
        },
      },
    });
    this.client = new PlaidApi(config);
    this.kms = new AWS.KMS({
      region: configService.get<string>('aws.region'),
    });
  }

  // ── Step 1: Create link token (sent to frontend) ───────────────
  async createLinkToken(userId: string): Promise<{ linkToken: string }> {
    const response = await this.client.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: 'MONIVO',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us, CountryCode.Gb],
      language: 'en',
      webhook: this.configService.get<string>('plaid.webhookUrl'),
    });
    return { linkToken: response.data.link_token };
  }

  // ── Step 2: Exchange public token for access token ─────────────
  async exchangePublicToken(
    userId: string,
    publicToken: string,
  ): Promise<PlaidItem> {
    const exchangeRes = await this.client.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const { access_token, item_id } = exchangeRes.data;

    // Encrypt access token with KMS before storing
    const encrypted = await this.encryptToken(access_token);

    // Get institution info
    let institutionId: string | null = null;
    let institutionName: string | null = null;
    try {
      const itemRes = await this.client.itemGet({ access_token });
      institutionId = itemRes.data.item.institution_id ?? null;
      if (institutionId) {
        const instRes = await this.client.institutionsGetById({
          institution_id: institutionId,
          country_codes: [CountryCode.Us, CountryCode.Gb],
        });
        institutionName = instRes.data.institution.name;
      }
    } catch (e) {
      this.logger.warn('Could not fetch institution details', e);
    }

    const item = this.itemRepo.create({
      userId,
      plaidItemId: item_id,
      accessTokenEncrypted: encrypted,
      institutionId,
      institutionName,
    });
    return this.itemRepo.save(item);
  }

  // ── Step 3: Sync transactions (incremental via cursor) ─────────
  async syncTransactions(userId: string, plaidItemId: string): Promise<number> {
    const item = await this.itemRepo.findOne({
      where: { userId, plaidItemId, isActive: true },
    });
    if (!item) throw new NotFoundException('Plaid item not found');

    const accessToken = await this.decryptToken(item.accessTokenEncrypted);
    let cursor = item.cursor ?? undefined;
    let added = 0;
    let hasMore = true;

    while (hasMore) {
      const request: TransactionsSyncRequest = {
        access_token: accessToken,
        cursor,
        count: 500,
      };
      const res = await this.client.transactionsSync(request);
      const { added: newTxns, modified, removed, has_more, next_cursor } = res.data;

      // Insert new transactions
      for (const txn of newTxns) {
        if (txn.pending) continue; // skip pending
        if (Number(txn.amount) <= 0) continue; // skip credits/refunds

        const entryDate = txn.date; // YYYY-MM-DD
        const existing = await this.entryRepo.findOne({
          where: { plaidTransactionId: txn.transaction_id },
        });
        if (existing) continue;

        const entry = this.entryRepo.create({
          userId,
          amount: Math.abs(Number(txn.amount)),
          category: mapCategory(txn.category ?? null),
          entryDate,
          entryTs: new Date(txn.datetime ?? txn.date).getTime(),
          note: txn.merchant_name ?? txn.name ?? '',
          plaidTransactionId: txn.transaction_id,
        });
        await this.entryRepo.save(entry);
        await this.streakService.update(userId, entryDate);
        added++;
      }

      // Update modified
      for (const txn of modified) {
        const existing = await this.entryRepo.findOne({
          where: { plaidTransactionId: txn.transaction_id },
        });
        if (existing && !txn.pending) {
          existing.amount = Math.abs(Number(txn.amount));
          existing.note = txn.merchant_name ?? txn.name ?? '';
          await this.entryRepo.save(existing);
        }
      }

      // Remove deleted
      for (const rm of removed) {
        const existing = await this.entryRepo.findOne({
          where: { plaidTransactionId: rm.transaction_id },
        });
        if (existing) await this.entryRepo.remove(existing);
      }

      cursor = next_cursor;
      hasMore = has_more;
    }

    // Persist cursor
    item.cursor = cursor ?? null;
    item.lastSyncedAt = new Date();
    await this.itemRepo.save(item);

    this.logger.log(`Synced ${added} new transactions for user ${userId}`);
    return added;
  }

  // ── Webhook signature verification ───────────────────────────────
  /**
   * Plaid signs webhooks with a JWT using a key fetched from their JWKS endpoint.
   * We verify the signature on every webhook before processing.
   * https://plaid.com/docs/api/webhooks/webhook-verification/
   */
  async verifyWebhookSignature(
    token: string,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      // Decode header to get key_id
      const [headerB64] = token.split('.');
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString()) as { kid?: string };
      const keyId = header.kid;
      if (!keyId) return false;

      // Fetch Plaid's current verification key
      const keyRes = await this.client.webhookVerificationKeyGet({ key_id: keyId });
      const key = keyRes.data.key;
      if (!key) return false;

      // Check key hasn't been rotated out (expired > 5 minutes ago)
      if (key.expired_at) {
        const expiredAt = new Date(key.expired_at).getTime();
        if (Date.now() > expiredAt + 5 * 60 * 1000) return false;
      }

      // Verify the JWT signature (Plaid uses ES256)
      // Import the key and verify using Node's crypto
      const { createVerify } = await import('crypto');
      const [, payloadB64, sigB64] = token.split('.');
      const signingInput = `${headerB64}.${payloadB64}`;
      const sig = Buffer.from(sigB64, 'base64url');

      // Convert JWK to PEM for Node crypto
      const jwkKey = await crypto.subtle.importKey(
        'jwk', key as JsonWebKey,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true, ['verify'],
      );
      const keyBuffer = await crypto.subtle.exportKey('spki', jwkKey);
      const pem = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(keyBuffer).toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----`;

      const verify = createVerify('SHA256');
      verify.update(signingInput);
      return verify.verify({ key: pem, dsaEncoding: 'ieee-p1363' }, sig);
    } catch (e) {
      this.logger.warn('Webhook signature verification failed', e);
      return false;
    }
  }

  // ── Webhook handler ────────────────────────────────────────────
  async handleWebhook(body: SyncUpdatesAvailableWebhook): Promise<void> {
    const item = await this.itemRepo.findOne({
      where: { plaidItemId: body.item_id, isActive: true },
    });
    if (!item) return;

    // Fire-and-forget sync
    this.syncTransactions(item.userId, item.plaidItemId).catch((e) =>
      this.logger.error('Webhook sync failed', e),
    );
  }

  async getConnectedItems(userId: string): Promise<PlaidItem[]> {
    return this.itemRepo.find({
      where: { userId, isActive: true },
      select: ['id', 'plaidItemId', 'institutionName', 'lastSyncedAt', 'createdAt'],
    });
  }

  async disconnectItem(userId: string, id: string): Promise<void> {
    const item = await this.itemRepo.findOne({ where: { id, userId } });
    if (!item) throw new NotFoundException();
    try {
      const token = await this.decryptToken(item.accessTokenEncrypted);
      await this.client.itemRemove({ access_token: token });
    } catch (e) {
      this.logger.warn('Plaid itemRemove failed, marking inactive anyway', e);
    }
    item.isActive = false;
    await this.itemRepo.save(item);
  }

  // ── KMS encryption helpers ─────────────────────────────────────
  private async encryptToken(plaintext: string): Promise<string> {
    const keyId = this.configService.get<string>('aws.kmsKeyId');
    if (!keyId) {
      // Dev fallback: base64 only (never use in production)
      this.logger.warn('KMS key not configured — using base64 fallback');
      return Buffer.from(plaintext).toString('base64');
    }
    const result = await this.kms
      .encrypt({ KeyId: keyId, Plaintext: Buffer.from(plaintext) })
      .promise();
    if (!result.CiphertextBlob) throw new InternalServerErrorException('KMS encrypt failed');
    return (result.CiphertextBlob as Buffer).toString('base64');
  }

  private async decryptToken(ciphertext: string): Promise<string> {
    const keyId = this.configService.get<string>('aws.kmsKeyId');
    if (!keyId) {
      return Buffer.from(ciphertext, 'base64').toString('utf8');
    }
    const result = await this.kms
      .decrypt({ CiphertextBlob: Buffer.from(ciphertext, 'base64') })
      .promise();
    if (!result.Plaintext) throw new InternalServerErrorException('KMS decrypt failed');
    return (result.Plaintext as Buffer).toString('utf8');
  }
}
