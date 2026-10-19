import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { getSortedPosts } from "@/utils/getSortedPosts";
import { getPostUrl } from "@/utils/getPostPaths";
import config from "@/config";

export async function GET() {
  const writing = await getCollection("writings");
  const thoughts = await getCollection("thoughts");
  const sortedPosts = getSortedPosts([...writing, ...thoughts]);

  return rss({
    title: config.site.title,
    description: config.site.description,
    site: config.site.url,
    items: sortedPosts.map(({ data, id, filePath, collection }) => ({
      link: getPostUrl(id, filePath, config.site.lang, collection),
      title: data.title,
      description: data.description,
      pubDate: new Date(data.modDatetime ?? data.pubDatetime),
    })),
  });
}
