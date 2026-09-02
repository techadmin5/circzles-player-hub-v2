export class AppError extends Error {
  constructor(public code: string, message: string, public statusCode = 400, public details?: unknown) {
    super(message);
  }
}

export const unauthorized = () => new AppError("UNAUTHORIZED", "Authentication is required.", 401);
