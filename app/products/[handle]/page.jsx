// app/products/[handle]/page.jsx
import { notFound } from 'next/navigation';
import ProductDetailClient from '@/components/ProductDetailClient';
import { getProductByHandle, getRelatedProducts } from '@/lib/shopify';
export const runtime = 'edge';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://kleidungsmarke.de';

function stripHtml(html) {
  try { return (html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); } catch { return ''; }
}

export async function generateMetadata(props) {
  const params = await props.params;
  const handleRaw = Array.isArray(params?.handle) ? params.handle[0] : params?.handle;
  const handle = (typeof handleRaw === 'string' && handleRaw.trim()) ? handleRaw.trim() : null;
  if (!handle) return {};
  const product = await getProductByHandle(handle);
  if (!product) return {};

  const title = `${product.title} – Kleidungsmarke`;
  const description = stripHtml(product.descriptionHtml).slice(0, 160);
  const canonical = `${SITE_URL.replace(/\/$/, '')}/products/${encodeURIComponent(handle)}`;
  const images = product.images?.length ? [{ url: product.images[0].src }] : (product.posterUrl ? [{ url: product.posterUrl }] : []);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, images },
    twitter: { title, description, images },
  };
}

export const dynamic = 'force-dynamic';

export default async function Page(props) {
  // Next 15: params is async
  const params = await props.params;

  const handleRaw = Array.isArray(params?.handle) ? params.handle[0] : params?.handle;
  const handle = (typeof handleRaw === 'string' && handleRaw.trim()) ? handleRaw.trim() : null;
  if (!handle) notFound();

  // SSR product fetch (with retry/timeout handled inside lib/shopify.js)
  const product = await getProductByHandle(handle);
  if (!product) notFound();

  // Use the resolved handle here (don’t read params synchronously)
  const related = await getRelatedProducts({ excludeHandle: handle, limit: 6 });

  const price = related && product?.variants?.[0]?.price;
  const offer = product?.variants?.[0]?.price || null;
  const avail = product?.variants?.[0]?.availableForSale !== false;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: stripHtml(product.descriptionHtml),
    image: product.images?.map(i => i.src).slice(0, 6),
    brand: { '@type': 'Brand', name: 'Kleidungsmarke' },
    offers: offer ? {
      '@type': 'Offer',
      priceCurrency: offer.currencyCode || 'EUR',
      price: String(offer.amount ?? ''),
      availability: avail ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `${SITE_URL.replace(/\/$/, '')}/products/${encodeURIComponent(handle)}`,
    } : undefined,
  };

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    <ProductDetailClient product={product} related={related} />
  </>;
}
