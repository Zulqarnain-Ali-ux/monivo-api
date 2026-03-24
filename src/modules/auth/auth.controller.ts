import {
  Controller, Post, Get, Body, Res,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { AuthService }                                from './auth.service';
import { PasswordResetService, ForgotPasswordDto, ResetPasswordDto } from './password-reset.service';
import { SignUpDto, SignInDto }                        from './auth.dto';
import { Public }       from '../../common/decorators/public.decorator';
import { CurrentUser }  from '../../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';

const COOKIE_OPTS = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge,
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private passwordResetService: PasswordResetService,
  ) {}

  // ── Sign Up ────────────────────────────────────────────────────
  @Public()
  @Post('signup')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a new account' })
  async signUp(@Body() dto: SignUpDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.signUp(dto);
    this.setTokenCookies(res, result.accessToken, result.refreshToken);
    return { user: result.user };
  }

  // ── Sign In ────────────────────────────────────────────────────
  @Public()
  @Post('signin')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sign in with email + password' })
  async signIn(@Body() dto: SignInDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.signIn(dto);
    this.setTokenCookies(res, result.accessToken, result.refreshToken);
    return { user: result.user };
  }

  // ── Refresh ────────────────────────────────────────────────────
  @Public()
  @UseGuards(AuthGuard('jwt-refresh'))
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate access + refresh tokens' })
  async refresh(@CurrentUser() user: User, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.refreshTokens(user.id);
    this.setTokenCookies(res, result.accessToken, result.refreshToken);
    return { user: result.user };
  }

  // ── Sign Out ───────────────────────────────────────────────────
  @Post('signout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invalidate session and clear cookies' })
  async signOut(@CurrentUser() user: User, @Res({ passthrough: true }) res: Response) {
    await this.authService.signOut(user.id);
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
  }

  // ── Who am I ───────────────────────────────────────────────────
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  me(@CurrentUser() user: User) {
    return {
      id:           user.id,
      email:        user.email,
      fname:        user.fname,
      lname:        user.lname,
      initials:     user.initials,
      emailVerified:user.emailVerified,
      createdAt:    user.createdAt,
    };
  }

  // ── Forgot password ────────────────────────────────────────────
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  // Tight throttle — 3 attempts per hour to prevent email spam
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Request a password reset email (always 200 to prevent enumeration)' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.passwordResetService.requestReset(dto.email);
    // Return the same response regardless of whether the email exists
    return { message: 'If that email is registered, a reset link has been sent.' };
  }

  // ── Reset password ─────────────────────────────────────────────
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Set new password using token from reset email' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.passwordResetService.resetPassword(dto);
    return { message: 'Password updated. Please sign in.' };
  }

  // ── Helpers ────────────────────────────────────────────────────
  private setTokenCookies(res: Response, accessToken: string, refreshToken: string) {
    res.cookie('access_token',  accessToken,  COOKIE_OPTS(15 * 60 * 1000));
    res.cookie('refresh_token', refreshToken, COOKIE_OPTS(30 * 24 * 60 * 60 * 1000));
  }
}
