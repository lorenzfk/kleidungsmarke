// lib/shopify.js
const SHOPIFY_STORE_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN || process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN;
const SHOPIFY_STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;

const API_URL = `https://${SHOPIFY_STORE_DOMAIN}/api/2024-07/graphql.json`;

// add a cache buster to CDN URLs
function withBuster(url, stamp) {
  if (!url) return null;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(stamp || '')}`;
}

/* ---------- resilient fetch: retries + timeout (NO API SHAPE CHANGE) ---------- */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * NOTE: Signature stays backward-compatible.
 * You can (optionally) pass a 3rd opts param: { attempts?: number, timeoutMs?: number }
 */
export async function shopifyFetch(query, variables = {}, opts = {}) {
  const attempts = Math.max(1, opts.attempts || 4);   // 1 try + up to 3 retries
  const timeoutMs = Math.max(1, opts.timeoutMs || 8000);

  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Storefront-Access-Token': SHOPIFY_STOREFRONT_TOKEN,
  };

  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ac ? setTimeout(() => ac.abort(new Error('fetch timeout')), timeoutMs) : null;

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
        cache: 'no-store', // stay fresh while iterating
        signal: ac?.signal,
        next: { revalidate: 0 },
      });

      if (timer) clearTimeout(timer);

      if (res.ok) {
        const json = await res.json();
        if (json.errors) throw new Error(JSON.stringify(json.errors));
        return json.data; // <-- unchanged return shape
      }

      // Retry on rate limit or transient server errors
      const http = res.status;
      if (http === 429 || (http >= 500 && http < 600)) {
        const backoff = Math.min(1500, 250 * Math.pow(2, i)); // 250, 500, 1000, 1500
        await sleep(backoff);
        continue;
      }

      const text = await res.text().catch(() => '');
      throw new Error(`Shopify fetch failed: ${http} ${text || res.statusText}`);
    } catch (err) {
      if (timer) clearTimeout(timer);
      lastErr = err;
      if (i < attempts - 1) {
        const backoff = Math.min(1500, 250 * Math.pow(2, i));
        await sleep(backoff);
        continue;
      }
    }
  }

  throw lastErr || new Error('Shopify fetch failed after retries');
}

/**
 * Return a canonical product shape used by the PDP/BuyUI:
 * { id, title, descriptionHtml, posterUrl, images[], options[], variants[], defaultVariantId }
 */
export async function getProductByHandle(handle) {
  const data = await shopifyFetch(
    /* GraphQL */ `
      query ProductByHandle($handle: String!) {
        product(handle: $handle) {
          id
          title
          descriptionHtml
          updatedAt

          options { name values }

          variants(first: 100) {
            nodes {
              id
              title
              availableForSale
              selectedOptions { name value }
              price { amount currencyCode }
            }
          }

          featuredImage { url altText }
          images(first: 12) { nodes { url altText } }

          poster: metafield(namespace: "three", key: "poster_image") {
            type
            updatedAt
            value
            reference {
              __typename
              ... on MediaImage { image { url } }
              ... on GenericFile { url }
            }
          }
        }
      }
    `,
    { handle }
  );

  const p = data?.product;
  if (!p) return null;

  // Resolve poster url and bust CDN cache
  const stamp = p.poster?.updatedAt || p.updatedAt;
  let rawPoster =
    p.poster?.reference?.image?.url ||
    p.poster?.reference?.url ||
    (p.poster?.value && /^https?:\/\//.test(p.poster.value) ? p.poster.value : null) ||
    p.featuredImage?.url ||
    p.images?.nodes?.[0]?.url ||
    null;

  const posterUrl = withBuster(rawPoster, stamp);

  // Normalize images -> [{ src, alt }]
  const imagesRaw = (p.images?.nodes || []).map(n => ({
    src: withBuster(n?.url || '', stamp),
    alt: n?.altText || '',
  })).filter(i => i.src);

  // De-dupe and ensure poster is first
  const images = (() => {
    const out = [];
    const seen = new Set();
    const add = (src, alt='') => { if (src && !seen.has(src)) { seen.add(src); out.push({ src, alt }); } };
    if (posterUrl) add(posterUrl, p.featuredImage?.altText || '');
    imagesRaw.forEach(i => add(i.src, i.alt));
    return out;
  })();

  // Variants
  const variants = (p.variants?.nodes || []).map(v => ({
    id: v.id,
    title: v.title,
    availableForSale: !!v.availableForSale,
    selectedOptions: v.selectedOptions || [],
    price: v.price || null,
  }));

  // Default variant: first available, else first
  const defaultVariant = variants.find(v => v.availableForSale) || variants[0] || null;

  return {
    id: p.id,
    title: p.title,
    descriptionHtml: p.descriptionHtml || '',
    posterUrl,
    images,                        // full gallery for carousel
    options: p.options || [],      // [{ name, values[] }]
    variants,                      // [{ id, selectedOptions[], price, availableForSale }]
    defaultVariantId: defaultVariant?.id || null,
  };
}

// helper: gid://shopify/ProductVariant/123456789 -> "123456789"
export function variantGidToNumeric(gid) {
  const m = gid?.match(/ProductVariant\/(\d+)/);
  return m ? m[1] : null;
}

// --- Related products (kept compatible) ---------------------------------
function mapPosterFromNode(p) {
  const raw =
    p.poster?.reference?.image?.url ||
    p.poster?.reference?.url ||
    p.featuredImage?.url ||
    p.images?.nodes?.[0]?.url ||
    null;
  if (!raw) return null;
  const sep = raw.includes('?') ? '&' : '?';
  return `${raw}${sep}v=${encodeURIComponent(p.updatedAt || '')}`;
}

export async function getRelatedProducts({
  excludeHandle,
  limit = 6,
  collectionHandle = process.env.FEATURED_COLLECTION_HANDLE || 'featured',
}) {
  // NOTE: UPDATED_AT is NOT valid for Collection.products.sortKey; use COLLECTION_DEFAULT.
  const QUERY = /* GraphQL */ `
    query Related($collection: String!) {
      collection(handle: $collection) {
        products(first: 50, sortKey: COLLECTION_DEFAULT) {
          nodes {
            id handle title updatedAt
            featuredImage { url }
            images(first: 1) { nodes { url } }
            poster: metafield(namespace: "three", key: "poster_image") {
              reference {
                __typename
                ... on MediaImage { image { url } }
                ... on GenericFile { url }
              }
            }
          }
        }
      }
      products(first: 50, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id handle title updatedAt
          featuredImage { url }
          images(first: 1) { nodes { url } }
          poster: metafield(namespace: "three", key: "poster_image") {
            reference {
              __typename
              ... on MediaImage { image { url } }
              ... on GenericFile { url }
            }
          }
        }
      }
    }
  `;

  try {
    const data = await shopifyFetch(QUERY, { collection: collectionHandle });

    const fromCollection = data?.collection?.products?.nodes || [];
    const fromAll = data?.products?.nodes || [];

    // Prefer curated collection; else fallback to all products
    const source = fromCollection.length ? fromCollection : fromAll;

    // Exclude the current product if possible; if that empties it, fall back
    let pool = source.filter(p => p.handle !== excludeHandle);
    if (pool.length === 0 && source.length > 0) pool = source;

    const mapped = pool.map(p => ({
      id: p.id,
      handle: p.handle,
      title: p.title,
      posterUrl: mapPosterFromNode(p),
    }));

    if (process.env.NODE_ENV !== 'production') {
      console.log('[related] source:', source.length, 'pool:', pool.length, 'returning:', Math.min(mapped.length, limit));
    }

    return mapped.slice(0, limit);
  } catch (err) {
    console.error('[related] fetch error:', err?.message || err);
    return [];
  }
}
