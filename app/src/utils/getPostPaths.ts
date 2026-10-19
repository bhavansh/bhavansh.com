import { getRelativeLocaleUrl } from "astro:i18n";
import { BLOG_PATH, THOUGHTS_PATH } from "@/content.config";
import { slugifyStr } from "./slugify";
import config from "@/config";

function getPostPathSegments(
  filePath: string | undefined,
  collection: string = "writings"
): string[] {
  const basePath = collection === "thoughts" ? THOUGHTS_PATH : BLOG_PATH;
  return (
    filePath
      ?.replace(basePath, "")
      .split("/")
      .filter(path => path !== "")
      .filter(path => !path.startsWith("_"))
      .slice(0, -1)
      .map(segment => slugifyStr(segment)) ?? []
  );
}

function getIdSlug(id: string): string {
  const postId = id.split("/");
  return postId.length > 0 ? String(postId[postId.length - 1]) : id;
}

function getPostSlugPath(
  id: string,
  filePath: string | undefined,
  collection: string = "writings"
): string {
  const pathSegments = getPostPathSegments(filePath, collection);
  const slug = getIdSlug(id);
  return pathSegments.length > 0
    ? [...pathSegments, slug].join("/")
    : String(slug);
}

/**
 * Returns the slug-only path for use as a route param in `getStaticPaths`.
 * No base prefix, no locale — Astro handles those at a higher level.
 * e.g. `/examples/my-post`
 */
export function getPostSlug(
  id: string,
  filePath: string | undefined,
  collection: string = "writings"
): string {
  return `/${getPostSlugPath(id, filePath, collection)}`;
}

/**
 * Returns a fully navigable URL for use in `<a href>` and RSS links.
 * Applies both locale routing and the configured Astro base via
 * `getRelativeLocaleUrl`.
 * e.g. `/writings/my-post` or `/en/writings/my-post`
 */
export function getPostUrl(
  id: string,
  filePath: string | undefined,
  locale: string | undefined = config.site.lang,
  collection: string = "writings"
): string {
  return getRelativeLocaleUrl(
    locale,
    `${collection}/${getPostSlugPath(id, filePath, collection)}`
  );
}
