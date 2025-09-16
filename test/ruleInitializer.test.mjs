import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeRuleDirectory } from '../dist/prompts/ruleInitializer.js';

function createLogger() {
  const messages = { info: [], warn: [] };
  return {
    logger: {
      info: (msg) => messages.info.push(msg),
      warn: (msg) => messages.warn.push(msg)
    },
    messages
  };
}

test('initializeRuleDirectory skips when target is not provided', async () => {
  const { logger, messages } = createLogger();
  const result = await initializeRuleDirectory({ env: {}, logger });
  assert.equal(result.status, 'skipped-no-target');
  assert.equal(result.fileCount, 0);
  assert.equal(messages.info.length, 0);
  assert.equal(messages.warn.length, 0);
});

test('initializeRuleDirectory creates target even when source missing', async () => {
  const base = await mkdtemp(join(tmpdir(), 'tfa-rules-missing-'));
  try {
    const targetDir = join(base, 'target');
    const missingSource = join(base, 'source-does-not-exist');
    const { logger, messages } = createLogger();

    const result = await initializeRuleDirectory({ sourceDir: missingSource, targetDir, logger });
    assert.equal(result.status, 'missing-source');
    assert.equal(result.targetDir, targetDir);
    assert.equal(result.fileCount, 0);
    assert.equal(messages.warn.length, 1);

    const targetStats = await stat(targetDir);
    assert.ok(targetStats.isDirectory());
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('initializeRuleDirectory copies files recursively', async () => {
  const base = await mkdtemp(join(tmpdir(), 'tfa-rules-copy-'));
  try {
    const sourceDir = join(base, 'source');
    const nestedSource = join(sourceDir, 'nested');
    const targetDir = join(base, 'target');

    await mkdir(nestedSource, { recursive: true });
    await writeFile(join(sourceDir, 'root.md'), '# root\n');
    await writeFile(join(nestedSource, 'child.md'), '# child\n');

    const { logger, messages } = createLogger();
    const result = await initializeRuleDirectory({ sourceDir, targetDir, logger });

    assert.equal(result.status, 'initialized');
    assert.equal(result.fileCount, 2);
    assert.equal(messages.warn.length, 0);
    assert.equal(messages.info.length, 1);

    const rootContent = await readFile(join(targetDir, 'root.md'), 'utf8');
    const childContent = await readFile(join(targetDir, 'nested', 'child.md'), 'utf8');
    assert.match(rootContent, /# root/);
    assert.match(childContent, /# child/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
