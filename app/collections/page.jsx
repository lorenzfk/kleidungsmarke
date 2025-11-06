// app/collections/page.jsx
import Link from 'next/link';
import Image from 'next/image';
import { shopifyFetch } from '@/lib/shopify';

export const runtime = 'edge';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://kleidungsmarke.de';

export const metadata = {
  title: 'Kollektionen',
  description: 'Alle Kollektionen von Kleidungsmarke – entdecke neue Drops und Klassiker.',
  alternates: { canonical: `${(SITE_URL || '').replace(/\/$/, '')}/collections` },
};

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

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Startseite', item: SITE_URL.replace(/\/$/, '') },
      { '@type': 'ListItem', position: 2, name: 'Kollektionen', item: `${SITE_URL.replace(/\/$/, '')}/collections` },
    ],
  };

  return (
    <div className="collection-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />
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
                <Image
                  src={c.image?.url || '/placeholder.png'}
                  alt={c.image?.altText || title}
                  width={84}
                  height={84}
                  className="collection-card__img"
                  sizes="84px"
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
