import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
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
}

export interface LoggerOptions {
  overrides?: LoggerOverrides;
  console?: ConsoleLoggerOptions;
  file?: FileLoggerOptions;
  transports?: Logger[];
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

const OVERRIDE_KEYS = new Set(['info', 'warn', 'error', 'debug']);

function isLoggerOverrides(value: unknown): value is LoggerOverrides {
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value as Record<string, unknown>).every(key => OVERRIDE_KEYS.has(key));
}

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
    appendFileSync(filePath, `${timestamp()} [${component}] ${level} ${message}\n`, { encoding: 'utf8' });
  } catch (error) {
    console.error(`[Logger] Failed to write log: ${(error as Error)?.message ?? error}`);
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

export function createLogger(component: string, init: LoggerOptions | LoggerOverrides = {}): Logger {
  const options: LoggerOptions = isLoggerOverrides(init)
    ? { overrides: init as LoggerOverrides }
    : (init as LoggerOptions);

  const overrides = options.overrides ?? (isLoggerOverrides(init) ? (init as LoggerOverrides) : undefined);

  const transports: Logger[] = [];
  const consoleEnabled = options.console?.enabled ?? true;
  const fileEnabled = options.file?.enabled ?? true;

  if (consoleEnabled) transports.push(createConsoleLogger(component));
  if (fileEnabled) transports.push(createFileLogger(component, options.file?.path));
  if (options.transports?.length) transports.push(...options.transports);

  const combined = transports.length ? chainLoggers(...transports) : createConsoleLogger(component);

  return {
    info(message: string) {
      if (overrides?.info) overrides.info(message);
      else combined.info(message);
    },
    warn(message: string) {
      if (overrides?.warn) overrides.warn(message);
      else combined.warn(message);
    },
    error(message: string) {
      if (overrides?.error) overrides.error(message);
      else combined.error(message);
    },
    debug(message: string) {
      if (overrides?.debug) overrides.debug(message);
      else combined.debug?.(message);
    }
  };
}
