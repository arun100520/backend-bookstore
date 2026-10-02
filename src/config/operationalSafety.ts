export function requireDisposableDatabase(env = process.env): void {
  if (env.NODE_ENV === 'production' || env.ALLOW_DESTRUCTIVE_TESTS !== 'true') {
    throw new Error('This script requires a disposable database and ALLOW_DESTRUCTIVE_TESTS=true outside production');
  }
  const name = new URL(env.MONGO_URI || '').pathname.slice(1);
  if (!/^(?:test|dev|local)[_-][a-z0-9_-]+$/i.test(name)) {
    throw new Error('Disposable database name must begin with test_, dev_ or local_');
  }
}
