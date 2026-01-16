// lib/catalog.js

/* ===================== ENV & CONSTANTS ===================== */
const SHOP_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN ||
  process.env.STORE_DOMAIN || '';

const SHOP_TOKEN =
  process.env.SHOPIFY_STOREFRONT_TOKEN ||
  process.env.STOREFRONT_ACCESS_TOKEN || '';

const SHOP_API_VERSION =
  process.env.SHOPIFY_STOREFRONT_API_VERSION ||
  process.env.SHOPIFY_API_VERSION ||
  '2024-07';

const API_URL = SHOP_DOMAIN
  ? `https://${SHOP_DOMAIN}/api/${SHOP_API_VERSION}/graphql.json`
  : '';

function assertEnv() {
  if (!SHOP_DOMAIN || !SHOP_TOKEN) {
    throw new Error(
      'Shopify env missing (need SHOPIFY_STORE_DOMAIN and SHOPIFY_STOREFRONT_TOKEN).'
    );
  }
}

/* Small helper to add a cache-busting stamp to CDN URLs */
function withBuster(url, stamp) {
  if (!url) return null;
  const u = String(url);
  const s = stamp ? String(stamp) : '';
  const sep = u.includes('?') ? '&' : '?';
  return s ? `${u}${sep}v=${encodeURIComponent(s)}` : u;
}

/* ===================== CORE FETCH (with retries) ===================== */
export async function shopifyFetch(query, variables = {}, opts = {}) {
  assertEnv();

  const attempts = Math.max(1, opts.attempts || 4); // 1 + 3 retries
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Storefront-Access-Token': SHOP_TOKEN,
  };

  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
        cache: 'no-store',
        next: { revalidate: 0 },
      });

      const http = res.status;

      if (res.ok) {
        const json = await res.json();
        if (json.errors) {
          throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
        }
        return { data: json.data, http };
      }

      // Retry on rate-limit or transient server errors
      if (http === 429 || (http >= 500 && http < 600)) {
        const wait = Math.min(1200, 250 * Math.pow(2, i)); // 250ms, 500ms, 1000ms, 1200ms
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      const text = await res.text().catch(() => '');
      throw new Error(`Shopify ${http}: ${text || res.statusText}`);
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const wait = Math.min(1200, 250 * Math.pow(2, i));
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
    }
  }
  throw lastErr || new Error('Shopify fetch failed after retries');
}

/* ===================== PRODUCT MAPPER ===================== */
export function mapProduct(node) {
  // Price (first variant if present)
  const v0 = node?.variants?.nodes?.[0];
  const price = v0?.price || { amount: 0, currencyCode: 'EUR' };

  // metafield "three.model_glb"
  const mfModel = node?.mfModel;
  let modelUrl =
    mfModel?.reference?.url ||
    mfModel?.reference?.image?.url ||
    null;

  // If no metafield, try model3D media
  if (!modelUrl && node?.media?.nodes?.length) {
    const m3d = node.media.nodes.find(n => n.__typename === 'Model3d');
    if (m3d?.sources?.length) modelUrl = m3d.sources[0].url;
  }

  // Poster image: metafield > featuredImage > first image
  const mfPoster = node?.mfPoster;
  let posterUrl =
    mfPoster?.reference?.image?.url ||
    mfPoster?.reference?.url ||
    node?.featuredImage?.url ||
    node?.images?.nodes?.[0]?.url ||
    null;

  const stamp = node?.updatedAt || v0?.updatedAt || '';
  modelUrl = withBuster(modelUrl, stamp);
  posterUrl = withBuster(posterUrl, stamp);

  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    availableForSale: node.availableForSale !== false,
    price,
    modelUrl,
    posterUrl,
    updatedAt: node.updatedAt,
  };
}

export function mapProductLite(node) {
  const v0 = node?.variants?.nodes?.[0];
  const price = v0?.price || { amount: 0, currencyCode: 'EUR' };

  const mfModel = node?.mfModel;
  let modelUrl =
    mfModel?.reference?.url ||
    mfModel?.reference?.image?.url ||
    null;

  if (!modelUrl && node?.media?.nodes?.length) {
    const m3d = node.media.nodes.find(n => n.__typename === 'Model3d');
    if (m3d?.sources?.length) modelUrl = m3d.sources[0].url;
  }

  const stamp = node?.updatedAt || v0?.updatedAt || '';
  modelUrl = withBuster(modelUrl, stamp);

  return {
    id: node.id,
    handle: node.handle,
    title: node.title,
    availableForSale: node.availableForSale !== false,
    price,
    modelUrl,
    posterUrl: null,
    updatedAt: node.updatedAt,
  };
}

/* ===================== QUERIES ===================== */
const PRODUCT_FIELDS = `
  id
  handle
  title
  updatedAt
  availableForSale
  featuredImage { url }
  images(first: 1) { nodes { url } }
  variants(first: 1) { nodes { price { amount currencyCode } } }

  mfModel: metafield(namespace: "three", key: "model_glb") {
    type
    updatedAt
    reference {
      __typename
      ... on GenericFile { url }
      ... on MediaImage  { image { url } }
    }
  }
  mfPoster: metafield(namespace: "three", key: "poster_image") {
    type
    updatedAt
    reference {
      __typename
      ... on MediaImage { image { url } }
      ... on GenericFile { url }
    }
  }

  media(first: 10) {
    nodes {
      __typename
      ... on Model3d { sources { url mimeType format } }
    }
  }
`;

const PRODUCT_FIELDS_LITE = `
  id
  handle
  title
  updatedAt
  availableForSale
  variants(first: 1) { nodes { price { amount currencyCode } } }

  mfModel: metafield(namespace: "three", key: "model_glb") {
    type
    updatedAt
    reference {
      __typename
      ... on GenericFile { url }
      ... on MediaImage  { image { url } }
    }
  }

  media(first: 10) {
    nodes {
      __typename
      ... on Model3d { sources { url mimeType format } }
    }
  }
`;

/* ===================== FEATURED for homepage ===================== */
export async function getLandingData() {
  const QUERY = /* GraphQL */ `
    query FeaturedForHome {
      collection(handle: "featured") {
        title
        products(first: 100, sortKey: COLLECTION_DEFAULT) {
          nodes { ${PRODUCT_FIELDS_LITE} }
        }
      }
    }
  `;

  const { data } = await shopifyFetch(QUERY, {}, { attempts: 4 });
  const col = data?.collection || null;
  const nodes = col?.products?.nodes || [];
  return {
    title: col?.title || 'Featured',
    items: nodes.map(mapProductLite),
  };
}

/* ===================== Generic collection for /collections/[handle] ===================== */
export async function getCollectionItems(collectionHandle) {
  const QUERY = /* GraphQL */ `
    query CollectionForList($handle: String!) {
      collection(handle: $handle) {
        title
        description
        descriptionHtml
        products(first: 100, sortKey: COLLECTION_DEFAULT) {
          nodes { ${PRODUCT_FIELDS} }
        }
      }
    }
  `;

  const { data } = await shopifyFetch(QUERY, { handle: collectionHandle }, { attempts: 4 });
  const col = data?.collection || null;
  const nodes = col?.products?.nodes || [];
  return {
    title: col?.title || collectionHandle,
    description: col?.description || '',
    descriptionHtml: col?.descriptionHtml || '',
    items: nodes.map(mapProduct),
  };
}
