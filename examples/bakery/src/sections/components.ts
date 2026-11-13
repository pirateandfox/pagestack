// One Astro component per node type in schema.ts.
import Hero from './Hero.astro';
import Features from './Features.astro';
import Split from './Split.astro';
import Text from './Text.astro';
import Quotes from './Quotes.astro';
import Hours from './Hours.astro';
import Menu from './Menu.astro';
import Cta from './Cta.astro';
import Button from './blocks/Button.astro';

// product, quote, hours-row and menu-item are drawn by their parent section.
export const components: Record<string, any> = {
  hero: Hero, features: Features, split: Split, text: Text, quotes: Quotes, hours: Hours, menu: Menu, cta: Cta, button: Button,
};
