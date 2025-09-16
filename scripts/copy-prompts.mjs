import { cp, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const source = path.join(projectRoot, 'src', 'prompts');
const destination = path.join(projectRoot, 'dist', 'prompts');

async function main() {
  try {
    await stat(source);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.warn('No prompts directory found; skipping copy.');
      return;
    }
    throw error;
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

main().catch((error) => {
  console.error('Failed to copy prompts directory:', error);
  process.exitCode = 1;
});
