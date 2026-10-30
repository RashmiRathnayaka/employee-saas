import type { RequestAuth } from "../lib/authTypes.js";

declare global {
  namespace Express {
    interface Request {
      auth?: RequestAuth;
    }
  }
}
