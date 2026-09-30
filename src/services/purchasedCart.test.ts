import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Types } from 'mongoose';
import Cart from '../models/Cart.js';
import { removePurchasedCartItems } from './purchasedCart.js';

test('payment cleanup preserves other books, changed quantities and a book added again on replay', async t => {
  const user = new Types.ObjectId();
  const book = new Types.ObjectId();
  const paidLine = { _id: new Types.ObjectId(), book, quantity: 1 };
  const changedLine = { _id: new Types.ObjectId(), book: new Types.ObjectId(), quantity: 3 };
  const otherLine = { _id: new Types.ObjectId(), book: new Types.ObjectId(), quantity: 1 };
  let items = [paidLine, changedLine, otherLine];
  t.mock.method(Cart, 'updateOne', async (filter: unknown, update: any) => {
    assert.deepEqual(filter, { user });
    items = items.filter(item => !update.$pull.items.$or.some((match: typeof paidLine) =>
      String(match._id) === String(item._id) && String(match.book) === String(item.book) && match.quantity === item.quantity));
  });
  const order = { user, items: [
    { cartItemId: paidLine._id, book, quantity: 1, priceAtPurchase: 100 },
    { cartItemId: changedLine._id, book: changedLine.book, quantity: 1, priceAtPurchase: 100 },
  ] };
  await removePurchasedCartItems(order);
  assert.deepEqual(items, [changedLine, otherLine]);
  const addedAgain = { ...paidLine, _id: new Types.ObjectId() };
  items.push(addedAgain);
  await removePurchasedCartItems(order);
  assert.deepEqual(items, [changedLine, otherLine, addedAgain]);
});

test('historical orders without cart line IDs never remove newly added items', async t => {
  const update = t.mock.method(Cart, 'updateOne', async () => {});
  await removePurchasedCartItems({ user: new Types.ObjectId(), items: [
    { book: new Types.ObjectId(), quantity: 1, priceAtPurchase: 100 },
  ] });
  assert.equal(update.mock.callCount(), 0);
});
