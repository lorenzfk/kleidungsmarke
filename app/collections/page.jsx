// app/collections/page.jsx
import Link from 'next/link';
import { shopifyFetch } from '@/lib/shopify';

export const dynamic = 'force-dynamic';

export default async function CollectionsIndexPage() {
  const QUERY = /* GraphQL */ `
    query AllCollections {
      collections(first: 50, sortKey: TITLE) {
        nodes {
          id
          handle
          title
          image { url altText }
        }
      }
    }
  `;

  const data = await shopifyFetch(QUERY);
  const cols = (data?.collections?.nodes || []).filter(Boolean);

  return (
    <div className="collection-page">
      <div className="collection-header">
        <h1 className="collection-title">Kollektionen</h1>
      </div>

      {cols.length === 0 ? (
        <p style={{ padding: '2rem 1rem' }}>Keine Kollektionen gefunden.</p>
      ) : (
        <ul className="collection-list">
          {cols.map((c) => {
            const title = c.title || c.handle || 'Kollektion';
            const handle = (c.handle || '').trim();
            const isFeatured = handle.toLowerCase() === 'featured';
            const href = isFeatured ? '/' : `/collections/${encodeURIComponent(handle)}`;

            return (
              <li key={c.id} className="collection-card">
                <img
                  src={c.image?.url || '/placeholder.png'}
                  alt={c.image?.altText || title}
                  className="collection-card__img"
                />
                <div className="collection-card__meta">
                  <div className="collection-card__title">{title}</div>
                  {/* Optional tiny hint; remove if not desired */}
                  {/* {isFeatured && <span className="collection-card__hint">Startseite</span>} */}
                </div>
                <Link
                  href={href}
                  className="collection-card__overlay"
                  aria-label={`${title} öffnen`}
                />
              </li>
            );
          })}
        </ul>
      )}

      <div style={{ height: '12vh' }} />
    </div>
  );
}
