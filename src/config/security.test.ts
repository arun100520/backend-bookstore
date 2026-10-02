import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateProductionConfig } from './security.js';

function deployed(paymentMode?: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production', CASHFREE_ENV: paymentMode,
    JWT_SECRET: 'a'.repeat(48), JWT_REFRESH_SECRET: 'b'.repeat(48),
    MONGO_URI: 'mongodb://127.0.0.1/test_config', CLIENT_URL: 'https://store.example.invalid',
    CLOUDINARY_CLOUD_NAME: 'fixture', CLOUDINARY_API_KEY: 'fixture', CLOUDINARY_API_SECRET: 'fixture',
    CASHFREE_APP_ID: 'fixture', CASHFREE_SECRET_KEY: 'fixture', RESEND_API_KEY: 'fixture', MAIL_FROM: 'store@example.invalid',
  };
}
test('production hosting accepts explicit sandbox or live Cashfree mode', () => {
  for (const mode of ['sandbox', 'production', ' sandbox ']) {
    assert.doesNotThrow(() => validateProductionConfig(deployed(mode)));
  }
});
test('production hosting rejects absent and misspelled Cashfree modes', () => {
  for (const mode of [undefined, '', 'live', 'prodution']) {
    assert.throws(() => validateProductionConfig(deployed(mode)), /CASHFREE_ENV/);
  }
});
test('deployed sandbox retains HTTPS, secret, and email configuration requirements', () => {
  assert.throws(() => validateProductionConfig({ ...deployed('sandbox'), CLIENT_URL: 'http://store.example.invalid' }), /HTTPS/);
  assert.throws(() => validateProductionConfig({ ...deployed('sandbox'), JWT_SECRET: 'short' }), /JWT_SECRET/);
  assert.throws(() => validateProductionConfig({ ...deployed('sandbox'), RESEND_API_KEY: '' }), /RESEND_API_KEY/);
});
