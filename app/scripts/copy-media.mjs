import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../');
const CONTENT_DIR = path.join(ROOT_DIR, 'content');
const APP_SRC_DIR = path.join(ROOT_DIR, 'app/src');
const ASSETS_OUT_DIR = path.join(APP_SRC_DIR, 'assets/_content');

async function copyMedia() {
  console.log('Copying media from content/ to app/src/assets/_content/ ...');
  
  // Clear and recreate output directory
  await fs.rm(ASSETS_OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(ASSETS_OUT_DIR, { recursive: true });
  
  // List of directories in content/ to search for images
  const mediaDirs = ['fitness', 'my-corner-of-fun', 'experiments'];
  const extensions = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];

  // Clean public/fitness if it exists
  const publicFitnessDir = path.join(ROOT_DIR, 'app/public/fitness');
  await fs.rm(publicFitnessDir, { recursive: true, force: true }).catch(() => {});

  for (const dir of mediaDirs) {
    const srcDir = path.join(CONTENT_DIR, dir);
    
    // Choose destination based on directory
    let destDir = path.join(ASSETS_OUT_DIR, dir);
    if (dir === 'fitness') {
      destDir = publicFitnessDir;
    }
    
    try {
      await fs.access(srcDir);
    } catch {
      continue; // Skip if directory doesn't exist
    }

    await copyFiles(srcDir, destDir, extensions, dir === 'my-corner-of-fun');
  }
  
  console.log('Media copy complete.');
}

async function copyFiles(src, dest, extensions, renameToTimestamp = false) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  
  await fs.mkdir(dest, { recursive: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);

    if (entry.isDirectory()) {
      await copyFiles(srcPath, path.join(dest, entry.name), extensions, renameToTimestamp);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        let destName = entry.name;
        if (renameToTimestamp) {
          const stats = await fs.stat(srcPath);
          const timestamp = Math.floor(stats.mtimeMs || stats.birthtimeMs);
          destName = `${timestamp}-${entry.name}`;
        }
        const destPath = path.join(dest, destName);
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}

copyMedia().catch(err => {
  console.error('Error copying media:', err);
  process.exit(1);
});
