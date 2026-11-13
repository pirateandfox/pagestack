// The editor's Cloudflare Worker entry. PageStack puts it in place of @astrojs/cloudflare's own
// entry in editor builds (index.mjs), so hosts change nothing: site pages are checked here
// (server/gate.ts), then everything goes to the adapter as before.
// @ts-ignore: the host's dependency, present whenever this file is used
import { handle } from '@astrojs/cloudflare/handler';
import { gateSitePage } from './server/gate';
import { opts, secret } from './server/context';

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    return (await gateSitePage(request, { auth: opts.auth, secret })) ?? handle(request, env, ctx);
  },
};
