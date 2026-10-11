import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../');
const EXPERIMENTS_DIR = path.join(ROOT_DIR, 'content/experiments');

async function syncRemoteContent() {
  try {
    await fs.access(EXPERIMENTS_DIR);
  } catch {
    return;
  }

  const entries = await fs.readdir(EXPERIMENTS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const indexPath = path.join(EXPERIMENTS_DIR, entry.name, 'index.md');
    let content;
    try {
      content = await fs.readFile(indexPath, 'utf-8');
    } catch {
      continue;
    }

    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n[\s\S]*)?$/);
    if (!frontmatterMatch) continue;

    const frontmatter = frontmatterMatch[1];
    const remoteUrlMatch = frontmatter.match(/remoteUrl:\s*["']?([^"'\r\n]+)["']?/);
    if (!remoteUrlMatch) continue;

    const remoteUrl = remoteUrlMatch[1].trim();
    console.log(`[sync-remote] Fetching ${entry.name} from ${remoteUrl}...`);

    try {
      const res = await fetch(remoteUrl);
      if (!res.ok) {
        console.warn(`[sync-remote] HTTP ${res.status} fetching ${remoteUrl}. Keeping existing content.`);
        continue;
      }

      let remoteBody = await res.text();
      // Sanitize LaTeX math in markdown headings to code backticks.
      // This prevents KaTeX DOM nodes from duplicating heading text (e.g. O(L)O(L)O(L)) in the TOC and slugs.
      remoteBody = remoteBody.replace(/^(#{1,6}\s+[^\r\n]+)$/gm, headingLine =>
        headingLine.replace(/\$([^$\r\n]+)\$/g, '`$1`')
      );
      const updatedContent = `---\n${frontmatter}\n---\n\n${remoteBody.trim()}\n`;

      await fs.writeFile(indexPath, updatedContent, 'utf-8');
      console.log(`[sync-remote] Successfully updated ${entry.name} from remote.`);
    } catch (err) {
      console.warn(`[sync-remote] Network error fetching ${remoteUrl}: ${err.message}. Keeping existing content.`);
    }
  }
}

syncRemoteContent().catch(err => {
  console.warn('[sync-remote] Sync script encountered an error:', err);
});
