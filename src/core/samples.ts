// Sample content: pages and Markdown items a starter ships with `sample: true` (a page's JSON, an
// item's frontmatter), so a site can hide them (drafts, kept for reference) or delete them in one
// step from the editor. Saving a sample from the editor drops the mark: once someone has edited
// it, it is theirs and Hide and Delete leave it alone. Pure, so the rules can be tested.
import type { FileChange } from './storage';
import { parseMarkdown, writeMarkdown } from './frontmatter';
import type { PageDoc } from '../runtime';

/** What a host can add in its `sections` module as `sampleContent`. All optional. */
export interface SampleContent {
  /** Who the samples belong to, for the notice, e.g. "Crumb, the sample bakery". */
  label?: string;
  /** The home page that takes the sample one's place. Default: an empty page titled "Home". */
  home?: PageDoc;
  /** Values to set in globals when the samples go, e.g. `{ site: { announcement: '' } }`. */
  globals?: Record<string, Record<string, unknown>>;
}

export interface SamplePage { slug: string; path: string; raw: string; page: PageDoc }
export interface SampleItem { collection: string; label: string; slug: string; path: string; raw: string; title: string; draft: boolean }
export interface SampleGlobal { id: string; path: string; raw: string | null }

export type SampleState = 'shown' | 'hidden' | 'none';

/** The page slug the sample home page moves to when it is hidden. */
export const SAMPLE_HOME = 'sample-home';

export const isSamplePage = (page: unknown) => (page as { sample?: unknown } | null)?.sample === true;
export const isSampleItem = (raw: string) => parseMarkdown(raw).data.sample === true;

/** shown: a sample is on the public site. hidden: samples remain, all drafts. none: no samples. */
export function sampleState(pages: SamplePage[], items: SampleItem[]): SampleState {
  if (!pages.length && !items.length) return 'none';
  const shown = pages.some((p) => p.slug === 'index' || p.page.status !== 'draft') || items.some((i) => !i.draft);
  return shown ? 'shown' : 'hidden';
}

export interface SamplePlan { files: FileChange[]; deletes: string[]; expect: Record<string, string | null>; pages: number; items: number }

interface PlanInput {
  pages: SamplePage[];
  items: SampleItem[];
  globals: SampleGlobal[];
  config: SampleContent;
  /** Repo path for a page slug. */
  pagePath: (slug: string) => string;
  /** Slugs taken now, so the moved home page gets a free one. */
  taken: string[];
}

const pageJson = (page: PageDoc) => JSON.stringify(page, null, 2) + '\n';
const home = (config: SampleContent): PageDoc => {
  const { sample: _, ...page } = (config.home ?? { title: 'Home', sections: [] }) as PageDoc & { sample?: unknown };
  return { ...page, status: undefined } as PageDoc;
};

/** The global files with the host's values applied, where that changes anything. */
function globalChanges(input: PlanInput): FileChange[] {
  const out: FileChange[] = [];
  for (const g of input.globals) {
    const values = input.config.globals?.[g.id];
    if (!values || g.raw === null) continue;
    const data = JSON.parse(g.raw);
    if (Object.entries(values).every(([k, v]) => JSON.stringify(data[k]) === JSON.stringify(v))) continue;
    out.push({ path: g.path, content: JSON.stringify({ ...data, ...values }, null, 2) + '\n' });
  }
  return out;
}

function freeSlug(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Hide: sample pages become drafts, and sample items `draft: true`. The home page can't be a draft
 * (the site needs one), so the sample home moves to `sample-home` as a draft and `config.home`
 * takes its place. Every file it reads must be unchanged when the commit lands.
 */
export function planHide(input: PlanInput): SamplePlan {
  const files: FileChange[] = [];
  const deletes: string[] = [];
  const expect: Record<string, string | null> = {};
  let pages = 0, items = 0;
  for (const p of input.pages) {
    if (p.slug === 'index') {
      const to = input.pagePath(freeSlug(SAMPLE_HOME, input.taken));
      files.push({ path: to, content: pageJson({ ...p.page, title: `Sample: ${p.page.title}`, status: 'draft' }) });
      files.push({ path: p.path, content: pageJson(home(input.config)) });
      expect[to] = null;
    } else if (p.page.status !== 'draft') {
      files.push({ path: p.path, content: pageJson({ ...p.page, status: 'draft' }) });
    } else continue;
    expect[p.path] = p.raw;
    pages++;
  }
  for (const i of input.items) {
    if (i.draft) continue;
    files.push({ path: i.path, content: writeMarkdown(i.raw, { draft: true }, parseMarkdown(i.raw).body) });
    expect[i.path] = i.raw;
    items++;
  }
  for (const g of globalChanges(input)) { files.push(g); expect[g.path] = input.globals.find((x) => x.path === g.path)!.raw; }
  return { files, deletes, expect, pages, items };
}

/** Delete: every sample page and item goes. A sample home page is replaced by `config.home`. */
export function planDelete(input: PlanInput): SamplePlan {
  const files: FileChange[] = [];
  const deletes: string[] = [];
  const expect: Record<string, string | null> = {};
  for (const p of input.pages) {
    if (p.slug === 'index') files.push({ path: p.path, content: pageJson(home(input.config)) });
    else deletes.push(p.path);
    expect[p.path] = p.raw;
  }
  for (const i of input.items) { deletes.push(i.path); expect[i.path] = i.raw; }
  for (const g of globalChanges(input)) { files.push(g); expect[g.path] = input.globals.find((x) => x.path === g.path)!.raw; }
  return { files, deletes, expect, pages: input.pages.length, items: input.items.length };
}
