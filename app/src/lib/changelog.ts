/**
 * changelog.ts
 * Parses changelog-style Markdown files (reading.md, now.md).
 *
 * Format for reading.md:
 *   ## YYYY-MM-DD · [Title](url)
 *   by Author (optional)
 *   Free Markdown body (optional)
 *
 * Format for now.md:
 *   ## YYYY-MM-DD
 *   ## YYYY-MM-DD · Optional heading
 *   Free Markdown body (optional)
 */

import { createMarkdownProcessor } from "@astrojs/markdown-remark";

export interface ChangelogEntry {
  date: Date;
  dateStr: string; // "YYYY-MM-DD"
  /** Reading: link title. Now: optional heading after the date. */
  heading: string;
  /** Reading only */
  url?: string;
  /** Reading only */
  author?: string;
  /** The Markdown body text */
  body: string;
  /** Rendered HTML of the body */
  html: string;
  /** Original line number for error messages */
  lineNumber: number;
}

export interface ParseError {
  file: string;
  line: number;
  message: string;
}

const READING_HEADING_RE =
  /^##\s+(\d{4}-\d{2}-\d{2})\s*·\s*\[(.+?)\]\((https?:\/\/[^\s)]+)\)\s*$/;
const NOW_HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})(?:\s*·\s*(.+))?\s*$/;

function isValidDate(str: string): boolean {
  const d = new Date(str + "T00:00:00Z");
  return !isNaN(d.getTime());
}

/**
 * Parse reading.md entries.
 * Throws if a heading is malformed.
 */
export async function parseReadingEntries(
  content: string,
  filePath: string
): Promise<ChangelogEntry[]> {
  return parseEntries(content, filePath, "reading");
}

/**
 * Parse now.md entries.
 * Throws if a heading is malformed.
 */
export async function parseNowEntries(
  content: string,
  filePath: string
): Promise<ChangelogEntry[]> {
  return parseEntries(content, filePath, "now");
}

async function parseEntries(
  content: string,
  filePath: string,
  mode: "reading" | "now"
): Promise<ChangelogEntry[]> {
  const lines = content.split("\n");
  const entries: ChangelogEntry[] = [];
  let currentEntry: Omit<ChangelogEntry, "html"> | null = null;
  let currentBodyLines: string[] = [];

  const flushEntry = () => {
    if (currentEntry) {
      currentEntry.body = currentBodyLines
        .join("\n")
        .replace(/^\n+/, "")
        .replace(/\n+$/, "");
      entries.push({ ...currentEntry, html: "" });
    }
    currentBodyLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (line.startsWith("## ")) {
      // Try to parse as a changelog heading
      if (mode === "reading") {
        const m = READING_HEADING_RE.exec(line);
        if (m) {
          flushEntry();
          const [, dateStr, title, url] = m;
          if (!isValidDate(dateStr)) {
            throw new Error(
              `Invalid date "${dateStr}" in ${filePath} at line ${lineNum}`
            );
          }
          currentEntry = {
            date: new Date(dateStr + "T00:00:00Z"),
            dateStr,
            heading: title,
            url,
            body: "",
            lineNumber: lineNum,
          };
        } else {
          // A ## heading that doesn't match — fail the build
          throw new Error(
            `Malformed reading entry heading in ${filePath} at line ${lineNum}.\n` +
              `Expected: ## YYYY-MM-DD · [Title](https://...)\n` +
              `Got: ${line}`
          );
        }
      } else {
        // now mode
        const m = NOW_HEADING_RE.exec(line);
        if (m) {
          flushEntry();
          const [, dateStr, optHeading] = m;
          if (!isValidDate(dateStr)) {
            throw new Error(
              `Invalid date "${dateStr}" in ${filePath} at line ${lineNum}`
            );
          }
          currentEntry = {
            date: new Date(dateStr + "T00:00:00Z"),
            dateStr,
            heading: optHeading?.trim() ?? "",
            body: "",
            lineNumber: lineNum,
          };
        } else {
          throw new Error(
            `Malformed now entry heading in ${filePath} at line ${lineNum}.\n` +
              `Expected: ## YYYY-MM-DD or ## YYYY-MM-DD · Optional heading\n` +
              `Got: ${line}`
          );
        }
      }
    } else if (currentEntry) {
      // We're inside an entry — accumulate body lines
      // Parse optional "by Author" line (reading mode, first non-empty line)
      if (
        mode === "reading" &&
        !currentEntry.author &&
        currentBodyLines.every(l => l.trim() === "") &&
        line.trim().startsWith("by ")
      ) {
        currentEntry.author = line.trim().slice(3).trim();
      } else {
        currentBodyLines.push(line);
      }
    }
  }

  flushEntry();

  // Sort by date descending, stable for equal dates
  entries.sort((a, b) => b.date.getTime() - a.date.getTime());

  // Render HTML for each body
  const processor = await createMarkdownProcessor();
  for (const entry of entries) {
    if (entry.body) {
      const res = await processor.render(entry.body);
      entry.html = res.code;
    }
  }

  return entries;
}

/**
 * Format a date as "Month YYYY" (for now entries where full date isn't needed).
 */
export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Format a date as "DD Mon YYYY".
 */
export function formatShortDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
