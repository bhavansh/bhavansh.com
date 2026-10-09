# bhavansh.com

This repository contains the source code and content for bhavansh.com, a personal site built on top of AstroPaper.

## Repository Layout

- `content/` — All site content (Markdown and images). **This is the primary directory you edit to add new content.**
- `app/` — The Astro application code (AstroPaper scaffold).
- `add-entry` — Interactive CLI script to scaffold new content entries.

## Quick Start

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Start the development server:
   ```bash
   pnpm dev
   ```

3. Build for production:
   ```bash
   pnpm build
   ```

## How to Add Content

The site is designed so you only need to interact with the `content/` folder. No JSON files are used.

You can use the interactive script to generate new content boilerplate automatically:
```bash
pnpm add-entry
# or
./add-entry
```

Alternatively, here is the manual guide for each section:

### 1. Writing (Blog Posts)
- **Path:** `content/writing/`
- **Format:** Add a `.md` or `.mdx` file.
- **Frontmatter:**
  ```yaml
  ---
  title: "Your Post Title"
  pubDatetime: 2026-10-09T00:00:00Z
  description: "A short description of the post."
  tags:
    - "setup"
    - "productivity"
  ---
  ```

### 2. Experiments
- **Path:** `content/experiments/`
- **Format:** Create a new subfolder (e.g., `content/experiments/my-project/`). Inside it, add an `index.md`.
- **Frontmatter:**
  ```yaml
  ---
  title: "My Project"
  description: "A short tagline."
  status: "In Progress" # or "Completed"
  github: "https://github.com/..."
  demo: "https://demo.com/..."
  ---
  ```
- **Images:** Add a `cover.png` or `cover.jpg` in the same subfolder to display on the project card.

### 3. Reading Log
- **Path:** `content/reading.md`
- **Format:** Append new entries at the top of the file, right below the frontmatter.
- **Syntax:**
  ```markdown
  ## YYYY-MM-DD · [Book Title](https://link-to-book.com)
  by Author Name

  Your optional review or notes go here.
  ```

### 4. Now Log
- **Path:** `content/now.md`
- **Format:** Append new entries at the top of the file.
- **Syntax:**
  ```markdown
  ## YYYY-MM-DD · Optional heading
  What you're currently focused on...
  ```

### 5. Quotes (Panels)
- **Path:** `content/panels/`
- **Format:** 
  1. Drop an image into the folder (e.g., `2026-10-09-quote.jpg`).
  2. To add a caption/quote text, create a matching markdown sidecar file with the exact same name (e.g., `2026-10-09-quote.md`). The markdown file's body will be rendered as the caption. 
  
  *Tip: Prefix the filename with the date (`YYYY-MM-DD-something.jpg`) to ensure it gets sorted chronologically.*

### 6. Fitness Logs
- **Path:** `content/fitness/`
- **Format:** Create a new folder for the month (e.g., `content/fitness/2026-10/`). Inside, add an `index.md`.
- **Frontmatter:**
  ```yaml
  ---
  title: "October check-in"
  weight: 75.5 # optional
  measurements: "..." # optional
  photos:
    - file: "progress-1.jpg"
      alt: "Front view"
      caption: "End of month check-in"
  ---
  ```
- **Images:** Drop any referenced photos (e.g., `progress-1.jpg`) right next to the `index.md` inside that month's folder.

### 7. About Page & Career Timeline
- **Path:** `content/about.md`
- **Format:** 
  - The top section contains your general bio and "Core Skills".
  - The bottom section under `## Career` renders as a visual timeline.
  - Add new career entries at the top of the `## Career` section using the format:
    ```markdown
    ## YYYY-MM-DD · Job Title at Company Name
    Description of your responsibilities and achievements.
    ```

---

> Note: All media dropped in `content/fitness/`, `content/panels/`, and `content/experiments/` is automatically copied to `app/src/assets/_content/` during build so that Astro can optimize it natively.

## Quality Checks

Run the validation checks to verify schemas and URLs:

```bash
pnpm check-content
```

Run Astro's type checks:

```bash
pnpm --dir app exec astro check
```

## Deployment

The project is configured to deploy easily on Cloudflare Pages.

- **Build command:** `pnpm build`
- **Output directory:** `app/dist` (or `dist` if running from within `app/`)
- **Root directory:** `app`
