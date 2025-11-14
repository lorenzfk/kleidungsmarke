// app/api/settings/route.js
import { shopifyFetch } from '@/lib/shopify';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Prefer metaobject (type: km_lockscreen, handle: lockscreen) but keep metafield fallback
  const QUERY = /* GraphQL */ `
    query LockWelcome {
      lockscreen: metaobject(handle: { handle: "lockscreen", type: "km_lockscreen" }) {
        id
        updatedAt
        message: field(key: "message") { value }
        lockUntil: field(key: "lock_until") { value }
        lockPassword: field(key: "lock_password") { value }
        background: field(key: "background") {
          value
          reference {
            __typename
            ... on MediaImage { image { url } }
            ... on GenericFile { url }
          }
        }
      }
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
    const lockscreen = data?.lockscreen || null;

    const backgroundRef = lockscreen?.background;
    const backgroundUrl = (() => {
      const ref = backgroundRef?.reference;
      if (ref?.__typename === 'MediaImage') return ref.image?.url || null;
      if (ref?.url) return ref.url;
      const raw = backgroundRef?.value || '';
      return /^https?:\/\//.test(raw) ? raw : null;
    })();

    const welcomeFromMetaobject = (lockscreen?.message?.value || '').trim();

    const list = data?.shop?.metafields || [];
    const fallback = list.find(m => (m?.value || '').trim().length > 0);
    const welcomeFallback = (fallback?.value || '').trim();

    const welcome = welcomeFromMetaobject || welcomeFallback;
    const from = welcomeFromMetaobject
      ? 'metaobject.km_lockscreen.message'
      : fallback ? `${fallback.namespace}.${fallback.key}` : null;
    const updatedAt = lockscreen?.updatedAt || fallback?.updatedAt || null;

    const lockUntilRaw = (lockscreen?.lockUntil?.value || '').trim();
    const parsedLockUntil = lockUntilRaw ? new Date(lockUntilRaw) : null;
    const lockUntil = parsedLockUntil && !Number.isNaN(parsedLockUntil.getTime())
      ? parsedLockUntil.toISOString()
      : null;
    const lockPassword = (lockscreen?.lockPassword?.value || '').trim() || null;

    return Response.json({
      welcome,
      from,
      updatedAt,
      backgroundUrl,
      lockUntil,
      lockPassword,
    });
  } catch (err) {
    console.error('[api/settings] welcome fetch failed:', err?.message || err);
    return Response.json({ welcome: '', lockUntil: null, lockPassword: null }, { status: 200 });
  }
}
