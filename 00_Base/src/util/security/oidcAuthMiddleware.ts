// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import type { JwtPayload } from 'jsonwebtoken';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import type { Context, Next } from 'koa';

export interface OIDCConfig {
  jwksUri: string;
  issuer: string;
  audience?: string;
  cacheTime?: number;
  rateLimit?: boolean;
  requiredRoles?: string;
}

function parseRequiredRoles(
  spec?: string,
): Array<{ clientId: string; role: string }> {
  if (!spec) return [];
  return spec.split(',').map((entry) => {
    const [clientId, role] = entry.trim().split(':');
    return { clientId, role };
  });
}

export function oidcAuthMiddleware(config: OIDCConfig) {
  const requiredRoles = parseRequiredRoles(config.requiredRoles);
  const client = jwksClient({
    jwksUri: config.jwksUri,
    cache: true,
    cacheMaxAge: config.cacheTime || 60 * 60 * 1000,
    rateLimit: config.rateLimit ?? true,
    jwksRequestsPerMinute: 5,
  });

  async function getKey(header: any, callback: any) {
    client.getSigningKey(header.kid, function (err, key) {
      if (err || !key) {
        callback(err || new Error('Signing key not found'));
      } else {
        callback(null, key.getPublicKey());
      }
    });
  }

  return async (ctx: Context, next: Next) => {
    const authHeader = ctx.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ctx.status = 401;
      ctx.body = { error: 'Missing or invalid Authorization header' };
      return;
    }
    const token = authHeader.slice(7);
    try {
      const decoded = await new Promise<JwtPayload>((resolve, reject) => {
        jwt.verify(
          token,
          getKey,
          {
            issuer: config.issuer,
            audience: config.audience,
            algorithms: ['RS256'],
          },
          (err, payload) => {
            if (err) reject(err);
            else resolve(payload as JwtPayload);
          },
        );
      });
      ctx.state.user = decoded;
      if (requiredRoles.length > 0) {
        const hasAccess = requiredRoles.some(({ clientId, role }) =>
          ((decoded as any).resource_access?.[clientId]?.roles ?? []).includes(
            role,
          ),
        );
        if (!hasAccess) {
          ctx.status = 403;
          ctx.body = { error: 'Insufficient role' };
          return;
        }
      }
      await next();
    } catch (err) {
      ctx.status = 401;
      ctx.body = {
        error: 'Invalid token',
        details: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
