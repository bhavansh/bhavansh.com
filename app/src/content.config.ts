import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";
import config from "@/config";

export const BLOG_PATH = "../content/writings";

const writings = defineCollection({
  loader: glob({ pattern: "**/[^_]*.{md,mdx}", base: BLOG_PATH }),
  schema: ({ image }) =>
    z.object({
      author: z.string().default(config.site.author),
      pubDatetime: z.date(),
      modDatetime: z.date().optional().nullable(),
      title: z.string(),
      featured: z.boolean().optional(),
      draft: z.boolean().optional(),
      tags: z.array(z.string()).default(["others"]),
      ogImage: image().or(z.string()).optional(),
      description: z.string(),
      canonicalURL: z.string().optional(),
      hideEditPost: z.boolean().optional(),
      timezone: z.string().optional(),
    }),
});

const pages = defineCollection({
  loader: glob({ pattern: "about.{md,mdx}", base: "../content" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    ogImage: z.string().optional(),
    canonicalURL: z.string().optional(),
  }),
});

const experiments = defineCollection({
  loader: glob({
    pattern: "**/[^_]*/index.{md,mdx}",
    base: "../content/experiments",
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      status: z.enum(["exploring", "in-progress", "paused", "completed"]),
      startDate: z.date(),
      updatedDate: z.date().optional().nullable(),
      cover: image().or(z.string()).optional(),
      coverAlt: z.string().optional(),
      tech: z.array(z.string()).optional(),
      github: z.string().url().optional(),
      demo: z.string().url().optional(),
      related: z.array(z.string()).optional(),
      featured: z.boolean().optional(),
      draft: z.boolean().optional(),
    }),
});

export const collections = { writings, pages, experiments };
