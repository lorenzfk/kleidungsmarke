'use client';

import { useEffect, useState } from 'react';

import {
  SPECIAL_HANDLE,
  SPECIAL_TITLE_FALLBACK,
} from '@/lib/three-catalog/constants';

export default function useSpecialCollection() {
  const [specialCol, setSpecialCol] = useState({
    title: SPECIAL_TITLE_FALLBACK,
    description: '',
    descriptionHtml: '',
    items: [],
    hasAny: false,
  });

  useEffect(() => {
    let dead = false;

    const htmlToText = (html) => {
      if (!html) return '';
      const div = document.createElement('div');
      div.innerHTML = html;
      return div.textContent || div.innerText || '';
    };

    const adaptProducts = (arr = []) => {
      return (arr || []).map((p, i) => ({
        id: String(p.id || p.admin_graphql_api_id || p.legacyResourceId || `sp-${i}`),
        handle: p.handle || p.handle?.toString?.() || '',
        title: p.title || p.name || '',
        price: p.price || p.priceV2 || { amount: p.price?.toString?.() || '0', currencyCode: p.currency || p.currencyCode || 'EUR' },
        posterUrl: p.posterUrl || p.image?.src || p.featuredImage?.url || p.images?.[0]?.src || p.images?.nodes?.[0]?.url || '',
        availableForSale: (typeof p.availableForSale === 'boolean') ? p.availableForSale : (p.available !== false),
      }));
    };

    async function load() {
      try {
        const res = await fetch(`/api/collection?handle=${SPECIAL_HANDLE}`, { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          const items = adaptProducts(json?.items || json?.products || []);
          if (!dead && items.length) {
            setSpecialCol({
              title: json?.title || SPECIAL_TITLE_FALLBACK,
              description: json?.description || '',
              descriptionHtml: json?.descriptionHtml || '',
              items,
              hasAny: true,
            });
            return;
          }
        }
      } catch {}

      try {
        const res = await fetch(`/collections/${SPECIAL_HANDLE}.json`, { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          const items = adaptProducts(json?.collection?.products || json?.products || []);
          if (!dead && items.length) {
            const bodyHtml = json?.collection?.body_html || '';
            const plain = json?.collection?.description || htmlToText(bodyHtml);
            setSpecialCol({
              title: json?.collection?.title || SPECIAL_TITLE_FALLBACK,
              description: plain,
              descriptionHtml: bodyHtml,
              items,
              hasAny: true,
            });
            return;
          }
        }
      } catch {}

      if (!dead) {
        setSpecialCol({
          title: SPECIAL_TITLE_FALLBACK,
          description: '',
          descriptionHtml: '',
          items: [],
          hasAny: false,
        });
      }
    }

    load();
    return () => { dead = true; };
  }, []);

  return specialCol;
}
