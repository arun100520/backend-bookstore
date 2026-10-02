import { createHash, randomBytes } from 'node:crypto';
import { Resend } from 'resend';
import Registration from '../models/Registration.js';
import User from '../models/User.js';
import VerificationReceipt from '../models/VerificationReceipt.js';
import { AppError } from '../middleware/errorHandler.js';

export const registrationMessage = 'Check your email to complete registration. If you already have an account, sign in.';
export const verificationMail = {
  async send(email: string, token: string) {
    const { RESEND_API_KEY, MAIL_FROM, CLIENT_URL } = process.env;
    if (!RESEND_API_KEY || !MAIL_FROM || !CLIENT_URL) throw new Error('Email delivery is not configured');

    const url = new URL('/verify-email', CLIENT_URL);
    url.hash = token;

    const resend = new Resend(RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: MAIL_FROM,
      to: email,
      subject: 'Complete your OwnChapter registration',
      text: `If you requested an account, open this link within 30 minutes and confirm:\n${url}\n\nIf you already have an account, sign in with your existing password. This link cannot change it. If you did not request this email, ignore it.`,
    });
    if (error) throw new Error(`Resend delivery failed: ${error.message}`);
  },
};
export const registration = {
  async status(token: string): Promise<'verified' | 'pending' | 'invalid'> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    if (await VerificationReceipt.exists({ tokenHash })) return 'verified';
    if (await Registration.exists({ tokenHash, expiresAt: { $gt: new Date() } })) return 'pending';
    // A concurrent confirmation may have removed the pending registration.
    return await VerificationReceipt.exists({ tokenHash }) ? 'verified' : 'invalid';
  },
  async start(input: { name: string; email: string; passwordHash: string }) {
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    // Identical DB/mail flow for new and existing addresses. Login cannot probe
    // a pending signup because no account is created until mailbox verification.
    await Registration.create({ ...input, tokenHash, expiresAt: new Date(Date.now() + 30 * 60_000) });
    try { await verificationMail.send(input.email, token); }
    catch {
      await Registration.deleteOne({ tokenHash });
      throw new AppError(503, 'Registration email could not be sent. Please try again later.');
    }
  },
  async complete(token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    if (await VerificationReceipt.exists({ tokenHash })) return;
    // An insert failure leaves the link retryable; unique email prevents races
    // from creating duplicate accounts or replacing an existing password.
    const pending = await Registration.findOne({ tokenHash, expiresAt: { $gt: new Date() } });
    if (!pending) {
      if (await VerificationReceipt.exists({ tokenHash })) return;
      throw new AppError(400, 'This verification link is invalid or expired. Please register again.');
    }
    try { await User.create({ name: pending.name, email: pending.email, passwordHash: pending.passwordHash }); }
    catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    // Persist success before removing the pending record. Retries never change
    // an existing account's password or issue a session.
    try {
      await VerificationReceipt.updateOne({ tokenHash }, { $setOnInsert: { tokenHash, verifiedAt: new Date() } }, { upsert: true });
    } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
    await Registration.deleteOne({ tokenHash });
  },
};
