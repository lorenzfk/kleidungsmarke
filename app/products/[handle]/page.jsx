// app/products/[handle]/page.jsx
import { notFound } from 'next/navigation';
import ProductDetailClient from '@/components/ProductDetailClient';
import { getProductByHandle, getRelatedProducts } from '@/lib/shopify';

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

  return <ProductDetailClient product={product} related={related} />;
}
