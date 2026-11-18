/**
 * Next.js App Router: app/api/webhooks/pickriders/route.ts
 * The same handler works in Hono, Remix, SvelteKit, Cloudflare Workers, Bun and Deno.
 */
import Pickriders from 'pickriders';

const pickriders = new Pickriders();

pickriders.webhooks.on('order.delivered', async (event) => {
  const order = event.data.object;
  console.log(`Delivered: ${order.reference ?? order.number}`);
});

export const POST = pickriders.webhooks.handler();
