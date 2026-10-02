// Controller suites isolate persistence for authentication and rate limits.
// Security suites separately exercise the real session lookup and rate store.
import { beforeEach, type TestContext } from 'node:test';
import * as tokens from '../utils/jwt.js';
import { sessions } from '../services/sessions.js';
import { rateStore } from '../middleware/rateLimit.js';
import dotenv from 'dotenv';
dotenv.config = () => ({ parsed: {} });

beforeEach(context => {
  const t = context as TestContext;
  const identities = new Map<string, { role: string; tokenVersion: number }>();
  const generate = tokens.generateAccessToken;
  t.mock.method(tokens, 'generateAccessToken', (input: tokens.JwtPayload) => {
    identities.set(input.userId, { role: input.role, tokenVersion: input.tokenVersion ?? 0 });
    return generate(input);
  });
  t.mock.method(sessions, 'currentUser', async (userId: string) => identities.get(userId) as never);
  t.mock.method(rateStore, 'consume', async () => ({ count: 1, retryAfter: 60 }));
});
