import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import slugify from 'slugify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../');
const CONTENT_DIR = path.join(ROOT_DIR, 'content');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const slg = (str) => slugify(str, { lower: true, strict: true });

async function ask(question) {
  return (await rl.question(question)).trim();
}

async function addWriting() {
  const title = await ask('Title: ');
  const slug = await ask(`Slug [${slg(title)}]: `) || slg(title);
  const desc = await ask('Description: ');
  const date = new Date().toISOString();
  
  const content = `---
title: "${title}"
description: "${desc}"
pubDatetime: ${date}
draft: false
tags: []
---

Write here...
`;
  await fs.mkdir(path.join(CONTENT_DIR, 'writings'), { recursive: true });
  const file = path.join(CONTENT_DIR, 'writings', `${slug}.md`);
  await fs.writeFile(file, content);
  console.log(`Created ${file}`);
}

async function addThought() {
  const title = await ask('Title: ');
  const slug = await ask(`Slug [${slg(title)}]: `) || slg(title);
  const desc = await ask('Description: ');
  const date = new Date().toISOString();
  
  const content = `---
title: "${title}"
description: "${desc}"
pubDatetime: ${date}
draft: false
tags: []
---

Write here...
`;
  await fs.mkdir(path.join(CONTENT_DIR, 'thoughts'), { recursive: true });
  const file = path.join(CONTENT_DIR, 'thoughts', `${slug}.md`);
  await fs.writeFile(file, content);
  console.log(`Created ${file}`);
}

async function addExperiment() {
  const title = await ask('Title: ');
  const slug = await ask(`Slug [${slg(title)}]: `) || slg(title);
  const desc = await ask('Description: ');
  
  const d = new Date();
  const dateStr = d.toISOString().split('T')[0];

  const content = `---
title: "${title}"
description: "${desc}"
status: in-progress
startDate: ${dateStr}
updatedDate: ${dateStr}
draft: false
---

## Overview

## Approach

## Lessons learned
`;
  const dir = path.join(CONTENT_DIR, 'experiments', slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'index.md'), content);
  console.log(`Created ${path.join(dir, 'index.md')}`);
}

async function prependLog(fileRelative, header) {
  const file = path.join(CONTENT_DIR, fileRelative);
  let content = '';
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (e) {
    // Ignore if not exists
  }
  
  console.log('Enter markdown content (type "END" on a new line to finish):');
  const lines = [];
  while (true) {
    const line = await ask('');
    if (line === 'END') break;
    lines.push(line);
  }
  
  const text = lines.join('\n');
  const newEntry = `${header}\n${text}\n\n`;

  // Find where to insert (after frontmatter, or after ## Log, or at top)
  let insertIndex = 0;
  if (content.startsWith('---')) {
    const fmEnd = content.indexOf('---', 3);
    if (fmEnd !== -1) {
      insertIndex = fmEnd + 3;
    }
  }
  
  // For fitness, we want it under ## Log
  if (fileRelative === 'fitness.md') {
    const logMatch = content.match(/^##\s+Log\s*$/m);
    if (logMatch) {
      insertIndex = logMatch.index + logMatch[0].length;
    } else {
      // Append ## Log at the end if missing
      content += '\n\n## Log\n';
      insertIndex = content.length;
    }
  } else if (fileRelative === 'reading.md' || fileRelative === 'now.md') {
    // Just after frontmatter or comments at top
    const commentEnd = content.lastIndexOf('-->');
    if (commentEnd !== -1 && commentEnd > insertIndex) {
      insertIndex = commentEnd + 3;
    }
  }

  const before = content.slice(0, insertIndex).trimEnd();
  const after = content.slice(insertIndex).trimStart();
  
  await fs.writeFile(file, `${before}\n\n${newEntry}${after}`);
  console.log(`Added entry to ${file}`);
}

async function addReading() {
  const title = await ask('Title: ');
  const header = `## ${title}`;
  await prependLog('reading.md', header);
}

async function addNow() {
  const dateStr = new Date().toISOString().split('T')[0];
  const header = `## ${dateStr}`;
  await prependLog('now.md', header);
}

async function addFitnessLog() {
  const dateStr = new Date().toISOString().split('T')[0];
  const title = await ask('Optional heading: ');
  let header = `## ${dateStr}`;
  if (title) header += ` · ${title}`;
  await prependLog('fitness.md', header);
}

async function addFitnessImage() {
  const imgPath = await ask('Path to image file: ');
  const title = await ask('Title (for filename/slug, optional): ');
  
  let baseName = path.parse(imgPath).name;
  if (title) {
    baseName = slg(title);
  }
  const ext = path.extname(imgPath).toLowerCase();
  
  const now = new Date();
  const datePrefix = now.toISOString().split('T')[0];
  const newName = `${datePrefix}-${baseName}${ext}`;
  
  const outDir = path.join(CONTENT_DIR, 'fitness');
  await fs.mkdir(outDir, { recursive: true });
  
  const outPath = path.join(outDir, newName);
  await processImage(imgPath, outPath);
  console.log(`Copied and stripped EXIF -> ${outPath}`);
  console.log(`You can now reference it in fitness.md using: ![${baseName}](/fitness/${newName})`);
}

async function processImage(srcPath, destPath) {
  // Strip EXIF and save
  await sharp(srcPath)
    .withMetadata(false) // Strips EXIF
    .toFile(destPath);
}

async function addPanel() {
  const imgPath = await ask('Path to image file: ');
  const ext = path.extname(imgPath).toLowerCase();
  
  const now = Date.now();
  const newName = `${now}${ext}`;
  const outDir = path.join(CONTENT_DIR, 'my-corner-of-fun');
  await fs.mkdir(outDir, { recursive: true });
  
  const outPath = path.join(outDir, newName);
  await processImage(imgPath, outPath);
  console.log(`Copied and stripped EXIF -> ${outPath}`);
}

async function main() {
  console.log(`
What would you like to add?
1. Article (Writing)
2. Thought
3. Experiment
4. Reading item
5. Now update
6. Fitness log
7. Fitness image
8. Panel (Image with optional caption)
`);

  const choice = await ask('> ');

  try {
    switch(choice.trim()) {
      case '1': await addWriting(); break;
      case '2': await addThought(); break;
      case '3': await addExperiment(); break;
      case '4': await addReading(); break;
      case '5': await addNow(); break;
      case '6': await addFitnessLog(); break;
      case '7': await addFitnessImage(); break;
      case '8': await addPanel(); break;
      default: console.log('Invalid choice');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    rl.close();
  }
}

export default main;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
