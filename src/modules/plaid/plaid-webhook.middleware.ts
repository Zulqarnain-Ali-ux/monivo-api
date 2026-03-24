import { Injectable, NestMiddleware, BadRequestException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import {
  Configuration, PlaidApi, PlaidEnvironments,
} from 'plaid';

/**
 * Verifies the JWT signature Plaid attaches to every webhook request.
 * Plaid signs each webhook with a key pair that rotates; we fetch the
 * current public key from Plaid's /webhook_verification_key/get endpoint
 * and verify the JWT in the plaid-verification header.
 *
 * If verification fails, the request is rejected with 400 before it
 * reaches the controller.
 *
 * This middleware is applied only to POST /plaid/webhook.
 */
@Injectable()
export class PlaidWebhookMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PlaidWebhookMiddleware.name);
  private readonly client: PlaidApi;
  private readonly isDev:  boolean;

  constructor(private configService: ConfigService) {
    const env = configService.get<string>('plaid.env') ?? 'sandbox';
    this.isDev = env === 'sandbox';

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
  }

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    // In sandbox mode Plaid does not send real verification tokens
    if (this.isDev) { next(); return; }

    const token = req.headers['plaid-verification'] as string | undefined;
    if (!token) {
      throw new BadRequestException('Missing plaid-verification header');
    }

    try {
      // Decode header to extract key ID
      const [headerB64] = token.split('.');
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8')) as { kid?: string };
      if (!header.kid) throw new Error('No kid in verification token');

      // Fetch Plaid's public key for this key ID
      const keyRes = await this.client.webhookVerificationKeyGet({
        key_id: header.kid,
      });
      const jwk = keyRes.data.key;

      // Import the JWK and verify the JWT
      const key = await crypto.subtle.importKey(
        'jwk', jwk as JsonWebKey,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false, ['verify'],
      );

      const [hdr, payload, sigB64] = token.split('.');
      const data  = new TextEncoder().encode(`${hdr}.${payload}`);
      const sig   = Buffer.from(sigB64, 'base64url');

      const valid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        key, sig, data,
      );

      if (!valid) throw new Error('Signature invalid');

      // Check issued-at claim is within 5 minutes
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { iat?: number };
      if (!claims.iat) throw new Error('Missing iat claim');
      const ageSeconds = (Date.now() / 1000) - claims.iat;
      if (ageSeconds > 300) throw new Error('Webhook token expired');

      next();
    } catch (e) {
      this.logger.warn(`Plaid webhook verification failed: ${(e as Error).message}`);
      throw new BadRequestException('Invalid Plaid webhook signature');
    }
  }
}
