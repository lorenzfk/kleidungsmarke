// app/products/[handle]/page.jsx
import { getProductByHandle, getRelatedProducts } from '@/lib/shopify';
import ProductDetailClient from '@/components/ProductDetailClient';

export const dynamic = 'force-dynamic';

export default async function Page({ params }) {
  const product = await getProductByHandle(params.handle);
  if (!product) {
    return (
      <div className="product-page">
        <div className="container">
          <h1 style={{ color: '#fff' }}>Produkt nicht gefunden</h1>
          <a className="btn-aqua btn-close back-link" href="/">← Zurück</a>
        </div>
      </div>
    );
  }

  const related = await getRelatedProducts({ excludeHandle: params.handle, limit: 6 });

  return <ProductDetailClient product={product} related={related} />;
}
