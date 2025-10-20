import { shopifyFetch } from '@/lib/shopify';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://kleidungsmarke.de';

export default async function sitemap() {
  const base = SITE_URL.replace(/\/$/, '');
  const urls = [
    { url: `${base}/`, lastModified: new Date() },
    { url: `${base}/collections`, lastModified: new Date() },
    { url: `${base}/cart`, lastModified: new Date() },
  ];

  // Fetch product handles (first page)
  try {
    const PRODUCTS = /* GraphQL */ `
      query AllProductsForSitemap {
        products(first: 200, sortKey: UPDATED_AT, reverse: true) {
          nodes { handle updatedAt }
        }
      }
    `;
    const data = await shopifyFetch(PRODUCTS, {}, { attempts: 3 });
    const nodes = data?.products?.nodes || [];
    nodes.forEach(p => {
      const handle = (p?.handle || '').trim();
      if (!handle) return;
      urls.push({ url: `${base}/products/${encodeURIComponent(handle)}`, lastModified: p?.updatedAt ? new Date(p.updatedAt) : new Date() });
    });
  } catch {}

  // Fetch collection handles (first page)
  try {
    const COLS = /* GraphQL */ `
      query AllCollectionsForSitemap {
        collections(first: 50, sortKey: UPDATED_AT, reverse: true) {
          nodes { handle updatedAt }
        }
      }
    `;
    const data = await shopifyFetch(COLS, {}, { attempts: 3 });
    const nodes = data?.collections?.nodes || [];
    nodes.forEach(c => {
      const handle = (c?.handle || '').trim();
      if (!handle || handle.toLowerCase() === 'featured') return; // featured maps to homepage
      urls.push({ url: `${base}/collections/${encodeURIComponent(handle)}`, lastModified: c?.updatedAt ? new Date(c.updatedAt) : new Date() });
    });
  } catch {}

  return urls;
}

