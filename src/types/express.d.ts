// Augments Express's Request type so req.user is available after authenticate()
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        role: string;
        tokenVersion?: number;
      };
    }
  }
}

export {};
