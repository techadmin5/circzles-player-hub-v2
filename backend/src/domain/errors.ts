export class AppError extends Error {
  constructor(public code: string, message: string, public statusCode = 400, public details?: unknown) {
    super(message);
  }
}

export const unauthorized = () => new AppError("UNAUTHORIZED", "Authentication is required.", 401);
export const forbidden = (message = "Forbidden.") => new AppError("FORBIDDEN", message, 403);
export const validationFailed = (message: string, details?: unknown) => new AppError("VALIDATION_FAILED", message, 400, details);
export const insufficientPoints = () => new AppError("INSUFFICIENT_POINTS", "Not enough Synapse Points.", 400);
