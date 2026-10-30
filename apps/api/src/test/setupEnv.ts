import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "test";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
dotenv.config({ path: path.join(apiRoot, ".env.test"), override: true });
