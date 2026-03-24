import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy, StrategyOptionsWithRequest } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthService } from './auth.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    const opts: StrategyOptionsWithRequest = {
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => (req?.cookies as Record<string, string>)?.['refresh_token'] ?? null,
        ExtractJwt.fromBodyField('refreshToken'),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.refreshSecret') ?? 'dev-refresh',
      passReqToCallback: true,
    };
    super(opts);
  }

  async validate(req: Request, payload: { sub: string }) {
    const token =
      (req?.cookies as Record<string, string>)?.['refresh_token'] ??
      (req.body as Record<string, string>)?.refreshToken;
    if (!token) throw new UnauthorizedException('Refresh token missing');

    const user = await this.authService.validateRefreshToken(payload.sub, token);
    if (!user) throw new UnauthorizedException('Invalid refresh token');
    return user;
  }
}
