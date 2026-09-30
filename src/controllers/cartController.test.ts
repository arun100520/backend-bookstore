import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import Cart from '../models/Cart.js';
import Entitlement from '../models/Entitlement.js';
import { getCartHandler } from './cartController.js';

test('cart refresh preserves newly added books even when the reader already owns them', async t => {
  const items = [{ book: 'paid-book', quantity: 2 }, { book: 'pending-book', quantity: 1 }];
  t.mock.method(Entitlement, 'find', (filter: unknown) => {
    assert.deepEqual(filter, { user: 'reader' });
    return { distinct: async (field: string) => { assert.equal(field, 'book'); return ['paid-book']; } };
  });
  const update = t.mock.method(Cart, 'updateOne', async () => {});
  t.mock.method(Cart, 'findOne', () => ({ populate: async () => ({ items }) }));
  t.mock.method(Cart, 'calculateTotal', async () => items.length * 100);
  const res = { set() {}, status() { return this; }, json(body: any) {
    assert.deepEqual(body.data.items, items);
    assert.equal(body.meta.totalPriceInPaise, 200);
  } } as unknown as Response;
  for (let i = 0; i < 2; i++) await getCartHandler({ user: { userId: 'reader' } } as Request, res, error => { throw error; });
  assert.equal(update.mock.callCount(), 0, 'Reading the cart must never remove items based on past purchases');
});

test('pending or failed payments without ownership do not change the cart', async t => {
  t.mock.method(Entitlement, 'find', () => ({ distinct: async () => [] }));
  const update = t.mock.method(Cart, 'updateOne', async () => {});
  t.mock.method(Cart, 'findOne', () => ({ populate: async () => ({ items: [{ book: 'unpaid' }] }) }));
  t.mock.method(Cart, 'calculateTotal', async () => 500);
  const res = { set() {}, status() { return this; }, json(body: any) { assert.equal(body.data.items[0].book, 'unpaid'); } } as unknown as Response;
  await getCartHandler({ user: { userId: 'reader' } } as Request, res, error => { throw error; });
  assert.equal(update.mock.callCount(), 0);
});
