// lib/catalog.js
const SHOPIFY_STORE_DOMAIN =
  process.env.SHOPIFY_STORE_DOMAIN || process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN;
const SHOPIFY_STOREFRONT_TOKEN = process.env.SHOPIFY_STOREFRONT_TOKEN;
const API_URL = `https://${SHOPIFY_STORE_DOMAIN}/api/2024-07/graphql.json`;

function withBuster(url, stamp) {
  if (!url) return null;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${encodeURIComponent(stamp || '')}`;
}

async function shopifyFetch(query, variables = {}) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store', // always fresh while iterating
  });
  const http = res.status;
  if (!res.ok) throw new Error(`Shopify ${http}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return { data: json.data, http };
}

function mapProduct(p) {
  const variant = p.variants?.nodes?.[0] || null;
  const mfModel = p.mfModel?.reference || null;
  const mfPoster = p.mfPoster?.reference || null;

  let modelUrl = null;
  if (mfModel?.__typename === 'GenericFile' && mfModel.url) {
    modelUrl = mfModel.url;
  } else if (p.media?.nodes?.length) {
    const m3d = p.media.nodes.find(n => n.__typename === 'Model3d');
    if (m3d?.sources?.length) {
      const glb = m3d.sources.find(s => s.format === 'GLB' || s.mimeType === 'model/gltf-binary');
      modelUrl = (glb || m3d.sources[0]).url;
    }
  }

  let posterUrl =
    (mfPoster?.image?.url) ||
    (mfPoster?.url) ||
    p.featuredImage?.url ||
    p.images?.nodes?.[0]?.url ||
    null;

  const stamp = p.mfPoster?.updatedAt || p.mfModel?.updatedAt || p.updatedAt;
  posterUrl = withBuster(posterUrl, stamp);
  modelUrl  = withBuster(modelUrl, stamp);

  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    price: variant?.price || null,
    modelUrl,
    posterUrl,
    availableForSale: !!p.availableForSale,
  };
}

export async function getLandingData() {
  const QUERY = /* GraphQL */ `
    query GetCatalog {
      products(first: 50, sortKey: UPDATED_AT, reverse: true) {
        nodes {
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
              ... on MediaImage { image { url } }
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
        }
      }
    }
  `;

  const { data, http } = await shopifyFetch(QUERY);
  const products = data?.products?.nodes ?? [];
  const items = products.map(mapProduct);

  const dbg = {
    step: 'ok',
    domain: SHOPIFY_STORE_DOMAIN,
    hasToken: !!SHOPIFY_STOREFRONT_TOKEN,
    http,
    map: {
      fromAllCount: products.length,
      mappedCount: items.length,
      firstHandles: products.slice(0, 5).map(p => p.handle),
    },
  };

  return { items, dbg };
}
