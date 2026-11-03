declare module 'virtual:astro-section-editor/renderer' { export const Renderer: any; }
declare module 'virtual:astro-section-editor/site' {
  export const site: { schemas: Record<string, any>; presets: { label: string; description?: string; create: () => any }[] };
  export const options: Record<string, any>;
}

declare namespace App {
  interface Locals {
    /** Set by the editor middleware when a request is authenticated (passkey session or proxy header). */
    editorUser?: { id: string; name: string };
  }
}
