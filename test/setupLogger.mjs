import { configureLogger } from '../dist/utils/logger.js';

configureLogger({
  console: { enabled: true },
  file: { enabled: false }
});
