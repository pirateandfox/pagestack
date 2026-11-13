// Field schemas for every section and block type: what the editor's sidebar, inserter, tree and
// save validation read. Serialisable; the components live in components.ts.
import type { BlockSchema, Field, SchemaRegistry } from '@pirateandfox/pagestack/runtime';

const opt = (vals: [string, string][]) => vals.map(([value, label]) => ({ value, label }));
const text = (label: string, def = '', extra: Partial<Field> = {}): Field => ({ type: 'text', label, inline: true, default: def, ...extra });
const rich = (label: string, def = '', extra: Partial<Field> = {}): Field => ({ type: 'richtext', label, inline: true, default: def, ...extra });
const image = (label = 'Image'): Field => ({ type: 'image', label, inline: true, default: { src: '', alt: '' } });
const select = (label: string, def: string, options: [string, string][], extra: Partial<Field> = {}): Field => ({ type: 'select', label, default: def, options: opt(options), group: 'style', ...extra });
const background = (def = 'cream') => select('Background', def, [['cream', 'Cream'], ['paper', 'Paper'], ['wheat', 'Wheat'], ['sage', 'Sage'], ['crust', 'Crust (orange)'], ['ink', 'Ink (dark)']]);
const anchor: Field = { type: 'text', label: 'Anchor id', default: '', group: 'advanced', help: 'Lets a link jump here, e.g. /visit/#order' };
const item = (label: string, fields: Record<string, Field>, extra: Partial<BlockSchema> = {}): BlockSchema => ({ label, hidden: true, fields, ...extra });

export const schemas: SchemaRegistry = {
  /* ---------- Sections ---------- */
  hero: {
    label: 'Hero',
    description: 'Big headline, a few words, buttons and an illustration.',
    category: 'Sections',
    keywords: ['banner', 'header', 'intro'],
    blocks: ['button'],
    fields: {
      // Title first: the List View names a section after its first text field.
      title: text('Title', 'Bread worth getting up early for'),
      eyebrow: text('Eyebrow', 'Fresh this morning'),
      text: rich('Text', '<p>Say what makes this place worth the walk.</p>'),
      image: image('Illustration'),
      badge: text('Badge', '', { help: 'Small round sticker on the image. Blank for none.' }),
      variant: select('Layout', 'split', [['split', 'Split (text left, image right)'], ['banner', 'Banner (centred, for inner pages)']]),
      background: background('cream'),
      anchor,
    },
  },
  features: {
    label: 'Product grid',
    description: 'A grid of cards: picture, name, price, a line of description.',
    category: 'Sections',
    keywords: ['cards', 'grid', 'breads', 'products', 'features'],
    blocks: ['product'],
    fields: {
      title: text('Title', 'What we bake'),
      eyebrow: text('Eyebrow', 'From the oven'),
      intro: rich('Intro', ''),
      columns: select('Columns', '3', [['2', 'Two'], ['3', 'Three'], ['4', 'Four']]),
      background: background('paper'),
      anchor,
    },
  },
  split: {
    label: 'Image and text',
    description: 'An illustration on one side, a story on the other.',
    category: 'Sections',
    keywords: ['media', 'story', 'about', 'two column'],
    blocks: ['button'],
    fields: {
      title: text('Title', 'A heading for this story'),
      eyebrow: text('Eyebrow', ''),
      text: rich('Text', '<p>Tell it in a paragraph or two.</p>'),
      image: image(),
      caption: text('Caption', '', { help: 'Small note under the image. Blank for none.' }),
      side: select('Image side', 'left', [['left', 'Image left'], ['right', 'Image right']]),
      background: background('cream'),
      anchor,
    },
  },
  text: {
    label: 'Text',
    description: 'A column of rich text: headings, paragraphs, lists, links.',
    category: 'Sections',
    keywords: ['prose', 'paragraph', 'content', 'rich text'],
    fields: {
      html: rich('Text', '<h2>A heading</h2><p>Start writing here.</p>'),
      width: select('Width', 'narrow', [['narrow', 'Narrow (reading width)'], ['wide', 'Wide']]),
      align: select('Alignment', 'left', [['left', 'Left'], ['center', 'Centre']]),
      background: background('cream'),
      anchor,
    },
  },
  quotes: {
    label: 'Kind words',
    description: 'One or more quotes from customers, with names.',
    category: 'Sections',
    keywords: ['testimonial', 'review', 'quote'],
    blocks: ['quote'],
    fields: {
      title: text('Title', ''),
      eyebrow: text('Eyebrow', 'Overheard at the counter'),
      background: background('wheat'),
      anchor,
    },
  },
  hours: {
    label: 'Hours and location',
    description: 'Opening hours by day, with the address and a note beside them.',
    category: 'Sections',
    keywords: ['opening times', 'address', 'map', 'visit', 'contact'],
    blocks: ['hours-row'],
    fields: {
      title: text('Title', 'Hours and where to find us'),
      eyebrow: text('Eyebrow', 'Come by'),
      text: rich('Address and directions', '<p>14 Larder Lane, Millbrook</p>'),
      note: text('Note under the hours', 'We close early when the shelves are empty.'),
      background: background('paper'),
      anchor,
    },
  },
  menu: {
    label: 'Menu list',
    description: 'A titled list of items with prices, like a printed menu.',
    category: 'Sections',
    keywords: ['prices', 'menu', 'list', 'coffee', 'pastries'],
    blocks: ['menu-item'],
    fields: {
      title: text('Title', 'Pastries'),
      intro: rich('Intro', ''),
      image: image('Illustration'),
      side: select('Illustration side', 'right', [['left', 'Left'], ['right', 'Right']]),
      background: background('cream'),
      anchor,
    },
  },
  cta: {
    label: 'Call to action',
    description: 'A bold band with a headline and a button or two.',
    category: 'Sections',
    keywords: ['cta', 'banner', 'signup', 'order'],
    blocks: ['button'],
    fields: {
      title: text('Title', 'Order ahead, skip the queue'),
      text: rich('Text', '<p>One line on why, and when.</p>'),
      background: background('crust'),
      anchor,
    },
  },

  /* ---------- Blocks ---------- */
  button: {
    label: 'Button',
    description: 'A link styled as a button.',
    category: 'Blocks',
    keywords: ['link', 'cta'],
    fields: {
      label: text('Label', 'Find out more'),
      href: { type: 'link', label: 'Link', default: '/' },
      style: select('Style', 'primary', [['primary', 'Filled'], ['outline', 'Outline'], ['link', 'Text link']]),
    },
  },
  product: item('Product', {
    image: image('Picture'),
    name: text('Name', 'Country sourdough'),
    price: text('Price', '$9'),
    text: rich('Description', '<p>A line about it.</p>'),
    tag: text('Tag', '', { help: 'Small label on the picture, e.g. "Weekends". Blank for none.' }),
  }),
  quote: item('Quote', {
    quote: rich('Quote', '<p>The best thing on our street.</p>'),
    name: text('Name', 'A regular'),
    detail: text('Detail', 'Saturday mornings since 2021'),
  }),
  'hours-row': item('Day', {
    day: text('Day', 'Monday'),
    time: text('Hours', '7 a.m. – 3 p.m.'),
    closed: { type: 'boolean', label: 'Closed this day', default: false, group: 'style' },
  }),
  'menu-item': item('Menu item', {
    name: text('Name', 'Butter croissant'),
    price: text('Price', '$4.25'),
    text: text('Description', 'Three days of laminating, French butter.'),
    tag: select('Label', '', [['', 'None'], ['vegan', 'Vegan'], ['seasonal', 'Seasonal'], ['new', 'New'], ['weekends', 'Weekends only']]),
  }),
};
