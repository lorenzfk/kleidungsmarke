// components/CollectionClient.jsx
'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useMemo } from 'react';

export default function CollectionClient({
  title = 'Kollektion',
  description = '',
  descriptionHtml = '',
  items = [],
  embedded = false,
}) {
  const products = useMemo(
    () =>
      (items || []).map((p) => ({
        id: p.id,
        handle: p.handle,
        name: p.title,
        priceText: `${Number(p.price?.amount ?? 0).toFixed(2)} ${p.price?.currencyCode ?? ''}`,
        currency: p.price?.currencyCode || '',
        posterUrl: p.posterUrl,
        available: p.availableForSale !== false,
      })),
    [items]
  );

  return (
    <div
      className="collection-page"
      style={embedded ? undefined : { marginTop: '72px' }}
    >
      <div className="collection-header">
        <h1 className="collection-title">{title}</h1>
        {(descriptionHtml || description) && (
          descriptionHtml ? (
            <div
              className="collection-description"
              dangerouslySetInnerHTML={{ __html: descriptionHtml }}
            />
          ) : (
            <p className="collection-description">{description}</p>
          )
        )}
      </div>

      <ul className="collection-list">
        {products.map((p) => (
          <li key={p.id} className={`collection-card ${p.available ? '' : 'is-soldout'}`}>
            {/* same structure as before */}
            <Image
              src={p.posterUrl || '/placeholder.png'}
              alt={p.name}
              width={84}
              height={84}
              className="collection-card__img"
              sizes="84px"
            />
            <div className="collection-card__meta">
              <div className="collection-card__title">{p.name}</div>
              {p.priceText && <div className="collection-card__price">{p.priceText}</div>}
              {!p.available && <div className="collection-card__badge">AUSVERKAUFT</div>}
            </div>

            {/* clickable overlay that doesn't affect layout */}
            <Link
              href={`/products/${p.handle}`}
              className="collection-card__overlay"
              aria-label={`${p.name}${p.available ? '' : ' (ausverkauft)'}`}
            />
          </li>
        ))}
      </ul>

      <div style={{ height: '12vh' }} />
    </div>
  );
}
