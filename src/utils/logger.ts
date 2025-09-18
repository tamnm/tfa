import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug?(message: string): void;
}

export type LoggerOverrides = Partial<Logger>;

export interface ConsoleLoggerOptions {
  enabled?: boolean;
}

export interface FileLoggerOptions {
  enabled?: boolean;
  path?: string;
  maxSizeBytes?: number;
  maxFiles?: number;
}

export interface LoggerConfig {
  console?: ConsoleLoggerOptions;
  file?: FileLoggerOptions;
  transports?: Logger[];
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

const defaultConfig: LoggerConfig = {
  console: { enabled: false },
  file: {
    enabled: true,
    path: process.env.TFA_LOG_PATH,
    maxSizeBytes: 5 * 1024 * 1024,
    maxFiles: 5
  },
  transports: []
};

let globalConfig: LoggerConfig = {
  console: { ...defaultConfig.console },
  file: { ...defaultConfig.file },
  transports: [...(defaultConfig.transports ?? [])]
};

function resolveProjectRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, '..', '..');
}

function resolveLogFilePath(filePath?: string): string {
  const projectRoot = resolveProjectRoot();
  const configured = filePath ?? process.env.TFA_LOG_PATH ?? '.tfa/logs/tfa.log';
  const resolved = isAbsolute(configured) ? configured : resolve(projectRoot, configured);
  ensureDirectory(resolved);
  return resolved;
}

function ensureDirectory(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function timestamp(): string {
  return new Date().toISOString();
}

function appendLine(filePath: string, component: string, level: LogLevel, message: string) {
  try {
    rotateFileIfNeeded(filePath, globalConfig.file?.maxSizeBytes, globalConfig.file?.maxFiles);
    appendFileSync(filePath, `${timestamp()} [${component}] ${level} ${message}\n`, { encoding: 'utf8' });
  } catch (error) {
    console.error(`[Logger] Failed to write log: ${(error as Error)?.message ?? error}`);
  }
}

function rotateFileIfNeeded(filePath: string, maxSizeBytes?: number, maxFiles?: number) {
  if (!maxSizeBytes || maxSizeBytes <= 0) return;

  let size = 0;
  try {
    size = statSync(filePath).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw error;
  }

  if (size < maxSizeBytes) return;

  const archiveCount = Math.max(1, maxFiles ?? defaultConfig.file?.maxFiles ?? 5);
  const oldestArchive = `${filePath}.${archiveCount}`;
  if (existsSync(oldestArchive)) {
    try {
      unlinkSync(oldestArchive);
    } catch (error) {
      console.error(`[Logger] Failed to remove old log archive: ${(error as Error)?.message ?? error}`);
    }
  }

  for (let index = archiveCount; index >= 1; index -= 1) {
    const source = index === 1 ? filePath : `${filePath}.${index - 1}`;
    const destination = `${filePath}.${index}`;
    if (!existsSync(source)) continue;

    try {
      renameSync(source, destination);
    } catch (error) {
      console.error(`[Logger] Failed to rotate log file: ${(error as Error)?.message ?? error}`);
    }
  }
}

export function createConsoleLogger(component: string): Logger {
  const prefix = `[${component}]`;
  return {
    info(message: string) {
      console.log(`${prefix} ${message}`);
    },
    warn(message: string) {
      console.warn(`${prefix} ${message}`);
    },
    error(message: string) {
      console.error(`${prefix} ${message}`);
    },
    debug(message: string) {
      if (console.debug) console.debug(`${prefix} ${message}`);
      else console.log(`${prefix} ${message}`);
    }
  };
}

export function createFileLogger(component: string, filePath?: string): Logger {
  const target = resolveLogFilePath(filePath);
  return {
    info(message: string) {
      appendLine(target, component, 'INFO', message);
    },
    warn(message: string) {
      appendLine(target, component, 'WARN', message);
    },
    error(message: string) {
      appendLine(target, component, 'ERROR', message);
    },
    debug(message: string) {
      appendLine(target, component, 'DEBUG', message);
    }
  };
}

export function chainLoggers(...loggers: Logger[]): Logger {
  const sinks = loggers.filter(Boolean);
  return {
    info(message: string) {
      if (!sinks.length) return;
      for (const logger of sinks) logger.info(message);
    },
    warn(message: string) {
      if (!sinks.length) return;
      for (const logger of sinks) logger.warn(message);
    },
    error(message: string) {
      if (!sinks.length) return;
      for (const logger of sinks) logger.error(message);
    },
    debug(message: string) {
      if (!sinks.length) return;
      for (const logger of sinks) (logger.debug ?? logger.info)(message);
    }
  };
}

export function configureLogger(config: LoggerConfig) {
  globalConfig = {
    console: { enabled: config.console?.enabled ?? globalConfig.console?.enabled ?? true },
    file: {
      enabled: config.file?.enabled ?? globalConfig.file?.enabled ?? true,
      path: config.file?.path ?? globalConfig.file?.path ?? process.env.TFA_LOG_PATH,
      maxSizeBytes:
        config.file?.maxSizeBytes ?? globalConfig.file?.maxSizeBytes ?? defaultConfig.file?.maxSizeBytes,
      maxFiles: config.file?.maxFiles ?? globalConfig.file?.maxFiles ?? defaultConfig.file?.maxFiles
    },
    transports: config.transports ?? globalConfig.transports ?? []
  };
}

export function createLogger(component: string, overrides: LoggerOverrides = {}): Logger {
  const transports: Logger[] = [];
  const consoleEnabled = globalConfig.console?.enabled ?? true;
  const fileEnabled = globalConfig.file?.enabled ?? true;

  if (consoleEnabled) transports.push(createConsoleLogger(component));
  if (fileEnabled) transports.push(createFileLogger(component, globalConfig.file?.path));
  if (globalConfig.transports?.length) transports.push(...globalConfig.transports);

  const combined = transports.length ? chainLoggers(...transports) : createConsoleLogger(component);

  return {
    info(message: string) {
      if (overrides.info) overrides.info(message);
      else combined.info(message);
    },
    warn(message: string) {
      if (overrides.warn) overrides.warn(message);
      else combined.warn(message);
    },
    error(message: string) {
      if (overrides.error) overrides.error(message);
      else combined.error(message);
    },
    debug(message: string) {
      if (overrides.debug) overrides.debug(message);
      else combined.debug?.(message);
    }
  };
}
