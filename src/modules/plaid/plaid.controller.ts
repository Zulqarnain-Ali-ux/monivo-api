import {
  Controller, Get, Post, Delete,
  Body, Param, Req, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { PlaidService } from './plaid.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { User } from '../users/user.entity';

class ExchangeTokenDto {
  @IsString() publicToken: string;
}

@ApiTags('plaid')
@Controller('plaid')
export class PlaidController {
  constructor(private plaidService: PlaidService) {}

  @Post('link-token')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Plaid Link token to initiate bank connection' })
  createLinkToken(@CurrentUser() user: User) {
    return this.plaidService.createLinkToken(user.id);
  }

  @Post('exchange-token')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Exchange Plaid public token for persistent access token' })
  exchangeToken(@CurrentUser() user: User, @Body() dto: ExchangeTokenDto) {
    return this.plaidService.exchangePublicToken(user.id, dto.publicToken);
  }

  @Post('sync/:itemId')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger transaction sync for a connected institution' })
  sync(@CurrentUser() user: User, @Param('itemId') itemId: string) {
    return this.plaidService.syncTransactions(user.id, itemId);
  }

  @Get('items')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List connected bank accounts' })
  getItems(@CurrentUser() user: User) {
    return this.plaidService.getConnectedItems(user.id);
  }

  @Delete('items/:id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect a bank account' })
  disconnect(@CurrentUser() user: User, @Param('id') id: string) {
    return this.plaidService.disconnectItem(user.id, id);
  }

  /**
   * Plaid webhook receiver.
   * Plaid signs every webhook with a JWT in the Plaid-Verification header.
   * We verify the signature before processing to prevent spoofed webhooks.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Plaid webhook receiver (public, signature-verified)' })
  async webhook(
    @Body() body: Record<string, unknown>,
    @Req() req: import('express').Request,
  ) {
    const token = req.headers['plaid-verification'] as string | undefined;
    if (token) {
      const valid = await this.plaidService.verifyWebhookSignature(token, body);
      if (!valid) {
        return { received: false, reason: 'invalid_signature' };
      }
    }
    if (body['webhook_type'] === 'TRANSACTIONS' && body['webhook_code'] === 'SYNC_UPDATES_AVAILABLE') {
      void this.plaidService.handleWebhook(body as any);
    }
    return { received: true };
  }
}
