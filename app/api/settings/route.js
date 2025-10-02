// app/api/settings/route.js
import { shopifyFetch } from '@/lib/shopify';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Try multiple identifiers so you can keep Shopify's default "custom.*"
  const QUERY = /* GraphQL */ `
    query LockWelcome {
      shop {
        metafields(identifiers: [
          { namespace: "km",     key: "welcome" },
          { namespace: "custom", key: "welcome" },
          { namespace: "custom", key: "lockscreen_nachricht" },
          { namespace: "custom", key: "lockscreen_message" }
        ]) {
          namespace
          key
          value
          updatedAt
        }
      }
    }
  `;

  try {
    const data = await shopifyFetch(QUERY, {}, { attempts: 4, timeoutMs: 8000 });
    const list = data?.shop?.metafields || [];
    const first = list.find(m => (m?.value || '').trim().length > 0);
    const welcome = (first?.value || '').trim();
    return Response.json({ welcome, from: first ? `${first.namespace}.${first.key}` : null, updatedAt: first?.updatedAt || null });
  } catch (err) {
    console.error('[api/settings] welcome fetch failed:', err?.message || err);
    return Response.json({ welcome: '' }, { status: 200 });
  }
}
