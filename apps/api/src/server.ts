import { config } from "./config.js";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";

const app = createApp();

app.listen(config.PORT, () => {
  logger.info(`API listening on http://localhost:${config.PORT}`);
});
