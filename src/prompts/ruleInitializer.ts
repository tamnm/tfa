import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, Logger } from "../utils/logger.js";

export type RuleInitStatus = "skipped-no-target" | "missing-source" | "invalid-source" | "initialized";

export interface RuleInitOptions {
  env?: NodeJS.ProcessEnv;
  logger?: Partial<Logger>;
  sourceDir?: string;
  targetDir?: string;
}

export interface RuleInitResult {
  status: RuleInitStatus;
  sourceDir: string;
  targetDir?: string;
  fileCount: number;
}

export async function initializeRuleDirectory(options: RuleInitOptions = {}): Promise<RuleInitResult> {
  const env = options.env ?? process.env;
  const logger = createLogger("Rules", options.logger);

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(moduleDir, '..', '..');

  const sourceDirFromOpts = options.sourceDir;
  const resolvedSourceDir = sourceDirFromOpts
    ? (path.isAbsolute(sourceDirFromOpts) ? sourceDirFromOpts : path.resolve(projectRoot, sourceDirFromOpts))
    : resolveDefaultSourceDir();

  const envTarget = env?.TFA_RULE_DIR;
  const defaultTarget = options.env === undefined ? path.resolve(projectRoot, '.tfa', 'prompts') : undefined;
  const targetDirFromOpts = options.targetDir ?? envTarget ?? defaultTarget;

  if (!targetDirFromOpts) {
    logger.info("ℹ️  No target rule directory specified; skipping rule initialization.");
    return { status: "skipped-no-target", sourceDir: resolvedSourceDir, fileCount: 0 };
  }

  const resolvedTargetDir = path.isAbsolute(targetDirFromOpts)
    ? targetDirFromOpts
    : path.resolve(projectRoot, targetDirFromOpts);
  logger.info(`ℹ️  Rule source directory resolved to: ${resolvedSourceDir}`);
  logger.info(`ℹ️  Rule target directory resolved to: ${resolvedTargetDir}`);
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

async function copyRuleContents(sourceDir: string, targetDir: string, logger: Logger): Promise<number> {
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
