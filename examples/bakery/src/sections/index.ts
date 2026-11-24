// PageStack's `sections` module: what the editor can build pages from.
//   schemas      field definitions per node type (schema.ts)
//   presets      the "Add section" library, each arriving filled in
//   pageFields   the Page tab, stored in page.layout
//   templates    starting points for "Add page"
//   globals      site-wide JSON edited on its own screen
//   collections  Markdown folders (the news posts)
import type { CollectionDoc, Field, GlobalDoc, Node, PageTemplate, Preset } from '@pirateandfox/pagestack/runtime';
import { newId } from '@pirateandfox/pagestack/runtime';
import { schemas } from './schema';

export { schemas };

const n = (type: string, settings: Record<string, any> = {}, blocks?: Node[]): Node => ({ id: newId(), type, settings, ...(blocks ? { blocks } : {}) });
/** A node with its schema defaults, overridden by `settings`. */
const make = (type: string, settings: Record<string, any> = {}, blocks?: Node[]) => {
  const defaults = Object.fromEntries(Object.entries(schemas[type].fields).map(([k, f]) => [k, structuredClone(f.default ?? '')]));
  return n(type, { ...defaults, ...settings }, blocks);
};
const img = (name: string, alt: string) => ({ src: `/images/${name}.svg`, alt });
const button = (label: string, href: string, style = 'primary') => make('button', { label, href, style });

export const presets: Preset[] = [
  {
    label: 'Hero',
    description: 'Big headline, a few words, two buttons and an illustration.',
    create: () => make('hero', {
      eyebrow: 'Fresh this morning',
      title: 'Bread worth getting up <em>early</em> for',
      text: '<p>Slow-fermented loaves, flaky pastry and strong coffee, baked in small batches every morning.</p>',
      image: img('hero-loaves', 'A round sourdough loaf and a baguette on a board'),
      badge: 'Baked daily',
    }, [button('See the menu', '/menu/'), button('Plan a visit', '/visit/', 'outline')]),
  },
  {
    label: 'Page banner',
    description: 'A centred title and a line of text, for the top of an inner page.',
    create: () => make('hero', { eyebrow: 'A new page', title: 'A title for this page', text: '<p>One or two sentences to set the scene.</p>', variant: 'banner', background: 'wheat' }),
  },
  {
    label: 'Product grid',
    description: 'Three cards with a picture, name, price and description.',
    create: () => make('features', { title: 'This week’s specials', intro: '' }, [
      make('product', { image: img('cinnamon-bun', 'A spiralled morning bun'), name: 'Morning bun', price: '$4.75', text: '<p>Orange zest and cardamom sugar.</p>' }),
      make('product', { image: img('focaccia', 'A slab of focaccia'), name: 'Rosemary focaccia', price: '$7', text: '<p>Olive oil, flaky salt, rosemary.</p>' }),
      make('product', { image: img('rye', 'A seeded rye loaf'), name: 'Seeded rye', price: '$10', text: '<p>Sunflower, flax and caraway.</p>', tag: 'Thu–Sat' }),
    ]),
  },
  {
    label: 'Image and text',
    description: 'An illustration beside a heading, a paragraph and a link.',
    create: () => make('split', {
      eyebrow: 'Behind the counter', title: 'Meet the bakers',
      text: '<p>Five of us, one deck oven, and a starter called Gus. Say hello next time you’re in.</p>',
      image: img('oven', 'A brick deck oven with a wooden peel'),
    }, [button('Our story', '/about/', 'link')]),
  },
  {
    label: 'Text',
    description: 'A heading and a few paragraphs at reading width.',
    create: () => make('text'),
  },
  {
    label: 'Kind words',
    description: 'Two quotes from customers.',
    create: () => make('quotes', {}, [
      make('quote', { quote: '<p>The croissant you think about on Tuesday, when they’re closed.</p>', name: 'Ana R.', detail: 'Weekend regular' }),
      make('quote', { quote: '<p>I moved two streets away and I still walk over on Saturdays.</p>', name: 'Priya S.', detail: 'Regular since the garage days' }),
    ]),
  },
  {
    label: 'Hours and location',
    description: 'The week’s opening hours with the address beside them.',
    create: () => make('hours', {}, [
      ['Monday', '', true], ['Tuesday', '', true], ['Wednesday', '7 a.m. – 3 p.m.'], ['Thursday', '7 a.m. – 3 p.m.'],
      ['Friday', '7 a.m. – 6 p.m.'], ['Saturday', '7 a.m. – 4 p.m.'], ['Sunday', '8 a.m. – 2 p.m.'],
    ].map(([day, time, closed]) => make('hours-row', { day, time, closed: !!closed }))),
  },
  {
    label: 'Menu list',
    description: 'A titled price list, like a printed menu.',
    create: () => make('menu', { title: 'Pastry', image: img('croissant', 'A golden croissant') }, [
      make('menu-item', { name: 'Butter croissant', price: '$4.25', text: 'The one that started the queue.' }),
      make('menu-item', { name: 'Pain au chocolat', price: '$4.75', text: 'Two batons of dark chocolate.' }),
      make('menu-item', { name: 'Pear & brown butter tart', price: '$6', text: 'While the pears last.', tag: 'seasonal' }),
    ]),
  },
  {
    label: 'Call to action',
    description: 'A bold band with a headline and a button.',
    create: () => make('cta', { text: '<p>Call or email by 5 p.m. and your order will be waiting the next morning.</p>' }, [button('How ordering works', '/visit/#order')]),
  },
  {
    label: 'Button',
    description: 'A single button.',
    create: () => button('Find out more', '/'),
  },
];

export const pageFields: Record<string, Field> = {
  announcement: { type: 'boolean', label: 'Show the announcement bar', default: true, help: 'The line above the header. Its text is in Site details.' },
};

export const templates: PageTemplate[] = [
  {
    label: 'Standard page',
    description: 'A page banner and a column of text.',
    create: ({ title }) => ({ title, sections: [make('hero', { eyebrow: '', title, text: '<p>A sentence or two to introduce this page.</p>', variant: 'banner', background: 'wheat' }), make('text')] }),
  },
  {
    label: 'Seasonal special',
    description: 'A hero, a product grid and a call to action.',
    create: ({ title }) => ({
      title,
      sections: [presets[0].create(), presets[2].create(), presets[8].create()].map((s, i) => (i === 0 ? { ...s, settings: { ...s.settings, title } } : s)),
    }),
  },
];

const link = (label: string): Field => ({ type: 'link', label, default: '' });

export const globals: Record<string, GlobalDoc> = {
  site: {
    label: 'Site details',
    description: 'Menu, announcement bar, contact details and the footer note.',
    file: 'src/data/site.json',
    fields: {
      announcement: { type: 'text', label: 'Announcement bar', help: 'Blank hides it everywhere.' },
      nav: { type: 'list', label: 'Main menu', itemLabel: 'label', fields: { label: { type: 'text', label: 'Label', default: '' }, href: link('Link') } },
      orderLabel: { type: 'text', label: 'Header button label' },
      orderHref: link('Header button link'),
      address: { type: 'text', label: 'Address' },
      phone: { type: 'text', label: 'Phone' },
      email: { type: 'text', label: 'Email' },
      footerNote: { type: 'textarea', label: 'Footer note' },
    },
  },
};

/** Mirrors the schema in src/content.config.ts. */
export const collections: Record<string, CollectionDoc> = {
  news: {
    label: 'News',
    singular: 'post',
    dir: 'src/content/news',
    url: (slug) => `/news/${slug}/`,
    fields: {
      title: { type: 'text', label: 'Title' },
      date: { type: 'date', label: 'Date', time: false, required: true },
      excerpt: { type: 'textarea', label: 'Excerpt', help: 'One or two sentences for the news list.' },
      image: { type: 'image', label: 'Picture', asUrl: true, altField: 'imageAlt' },
      imageAlt: { type: 'text', label: 'Picture description' },
      draft: { type: 'boolean', label: 'Draft' },
    },
  },
};
