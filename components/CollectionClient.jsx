// components/CollectionClient.jsx
'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';

const INITIAL_VISIBLE = 18;
const LOAD_STEP = 12;

export default function CollectionClient({
  title = 'Kollektion',
  description = '',
  descriptionHtml = '',
  items = [],
  embedded = false,
}) {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(INITIAL_VISIBLE, items.length || INITIAL_VISIBLE));

  useEffect(() => {
    setVisibleCount(Math.min(INITIAL_VISIBLE, items.length || INITIAL_VISIBLE));
  }, [items]);

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

  const totalProducts = products.length;
  const visibleProducts = useMemo(
    () => products.slice(0, visibleCount),
    [products, visibleCount]
  );
  const hasMore = visibleCount < totalProducts;

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(totalProducts, prev + LOAD_STEP));
  }, [totalProducts]);

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
        {visibleProducts.map((p) => (
          <li key={p.id} className={`collection-card ${p.available ? '' : 'is-soldout'}`}>
            {/* same structure as before */}
            <Image
              src={p.posterUrl || '/placeholder.png'}
              alt={p.name}
              width={84}
              height={84}
              className="collection-card__img"
              sizes="84px"
              loading="lazy"
              quality={70}
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

      {hasMore && (
        <div className="collection-loadmore-wrap">
          <button
            type="button"
            className="collection-loadmore"
            onClick={loadMore}
          >
            Weitere Produkte laden ({totalProducts - visibleCount} übrig)
          </button>
        </div>
      )}

      <div style={{ height: '12vh' }} />
    </div>
  );
}
