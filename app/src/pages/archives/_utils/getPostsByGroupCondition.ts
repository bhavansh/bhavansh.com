import type { CollectionEntry } from "astro:content";

export const getPostsByGroupCondition = (
  posts: CollectionEntry<"writings">[],
  groupCondition: (post: CollectionEntry<"writings">) => number | string
) => {
  const result: Record<string, CollectionEntry<"writings">[]> = {};
  for (let i = 0; i < posts.length; i++) {
    const item = posts[i];
    const groupKey = String(groupCondition(item));
    if (!result[groupKey]) {
      result[groupKey] = [];
    }
    result[groupKey].push(item);
  }
  return result;
};
