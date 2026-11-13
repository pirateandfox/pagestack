import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// News posts: Markdown in src/content/news, edited at /edit/collection/news.
// The editor's field list is in src/sections/index.ts (collections.news).
const news = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/news' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    excerpt: z.string().optional(),
    image: z.string().optional(),
    imageAlt: z.string().default(''),
    draft: z.boolean().default(false),
  }),
});

export const collections = { news };
