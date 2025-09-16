import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type RuleInitStatus = "skipped-no-target" | "missing-source" | "invalid-source" | "initialized";

export interface RuleInitOptions {
  env?: NodeJS.ProcessEnv;
  logger?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
  };
  sourceDir?: string;
  targetDir?: string;
}

export interface RuleInitResult {
  status: RuleInitStatus;
  sourceDir: string;
  targetDir?: string;
  fileCount: number;
}

const defaultLogger = {
  info: console.log.bind(console),
  warn: console.warn.bind(console)
};

export async function initializeRuleDirectory(options: RuleInitOptions = {}): Promise<RuleInitResult> {
  const env = options.env ?? process.env;
  const logger = {
    info: options.logger?.info ?? defaultLogger.info,
    warn: options.logger?.warn ?? defaultLogger.warn
  };

  const resolvedSourceDir = options.sourceDir ?? resolveDefaultSourceDir();
  const targetDirFromOpts = options.targetDir ?? env?.TFA_RULE_DIR;

  if (!targetDirFromOpts) {
    return { status: "skipped-no-target", sourceDir: resolvedSourceDir, fileCount: 0 };
  }

  const resolvedTargetDir = path.resolve(targetDirFromOpts);
  await mkdir(resolvedTargetDir, { recursive: true });

  let sourceStats;
  try {
    sourceStats = await stat(resolvedSourceDir);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      logger.warn(`⚠️  Rule source directory not found at ${resolvedSourceDir}; created empty target at ${resolvedTargetDir}.`);
      return { status: "missing-source", sourceDir: resolvedSourceDir, targetDir: resolvedTargetDir, fileCount: 0 };
    }
    throw error;
  }

  if (!sourceStats.isDirectory()) {
    logger.warn(`⚠️  Rule source is not a directory: ${resolvedSourceDir}`);
    return { status: "invalid-source", sourceDir: resolvedSourceDir, targetDir: resolvedTargetDir, fileCount: 0 };
  }

  const fileCount = await copyRuleContents(resolvedSourceDir, resolvedTargetDir, logger);
  logger.info(`✅ Rules initialized at ${resolvedTargetDir}`);
  return { status: "initialized", sourceDir: resolvedSourceDir, targetDir: resolvedTargetDir, fileCount };
}

function resolveDefaultSourceDir(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, "./rules");
}

async function copyRuleContents(sourceDir: string, targetDir: string, logger: { warn: (message: string) => void }): Promise<number> {
  await mkdir(targetDir, { recursive: true });
  const entries = await readdir(sourceDir, { withFileTypes: true });
  let copied = 0;

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copied += await copyRuleContents(sourcePath, targetPath, logger);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, targetPath);
      copied += 1;
    } else {
      logger.warn(`⚠️  Skipping unsupported rule entry: ${sourcePath}`);
    }
  }

  return copied;
}
