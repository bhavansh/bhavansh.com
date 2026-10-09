import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../');
const CONTENT_DIR = path.join(ROOT_DIR, 'content');

async function checkContent() {
  console.log('Validating content...');
  
  let errors = 0;

  // Validate reading.md links
  try {
    const reading = await fs.readFile(path.join(CONTENT_DIR, 'reading.md'), 'utf8');
    const lines = reading.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('## ')) {
        const m = /^##\s+(.+)$/.exec(line);
        if (!m) {
          console.error(`❌ reading.md:${i + 1}: Malformed heading: ${line}`);
          errors++;
        }
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  // Validate now.md
  try {
    const now = await fs.readFile(path.join(CONTENT_DIR, 'now.md'), 'utf8');
    const lines = now.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('## ')) {
        const m = /^##\s+(\d{4}-\d{2}-\d{2})(?:\s*·\s*(.+))?\s*$/.exec(line);
        if (!m) {
          console.error(`❌ now.md:${i + 1}: Malformed heading: ${line}`);
          errors++;
        }
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  // Validate experiments frontmatter
  try {
    const exps = await fs.readdir(path.join(CONTENT_DIR, 'experiments'), { withFileTypes: true });
    for (const exp of exps) {
      if (exp.isDirectory()) {
        const indexMdPath = path.join(CONTENT_DIR, 'experiments', exp.name, 'index.md');
        try {
          const content = await fs.readFile(indexMdPath, 'utf8');
          // simple check for URLs in frontmatter
          const githubMatch = content.match(/github:\s*(.+)/);
          if (githubMatch && !githubMatch[1].trim().startsWith('http')) {
            console.error(`❌ ${indexMdPath}: Invalid github URL`);
            errors++;
          }
          const demoMatch = content.match(/demo:\s*(.+)/);
          if (demoMatch && !demoMatch[1].trim().startsWith('http')) {
            console.error(`❌ ${indexMdPath}: Invalid demo URL`);
            errors++;
          }
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
        }
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  if (errors > 0) {
    console.error(`\nValidation failed with ${errors} errors.`);
    process.exit(1);
  } else {
    console.log('✅ Content validation passed.');
  }
}

checkContent().catch(err => {
  console.error('Validation error:', err);
  process.exit(1);
});
