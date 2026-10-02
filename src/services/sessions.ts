import User from '../models/User.js';

// Database-backed checks are shared by every worker; no stale role/session cache.
export const sessions = {
  async currentUser(userId: string) {
    return User.findById(userId).select('role tokenVersion').lean();
  },
  async revokeAll(userId: string) {
    await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  },
};
