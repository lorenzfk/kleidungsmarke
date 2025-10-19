'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import ProductDetailClient from '@/components/ProductDetailClient';
import CollectionClient from '@/components/CollectionClient';

let themeJsonAvailable = null;

/**
 * BuyUI renders the leather bar + wood panel and embeds either:
 *  - the full PDP (ProductDetailClient) for a product, OR
 *  - the CollectionClient for the "special" collection when the special tile is selected.
 * 
 * Keeps itself in the DOM even when nothing is selected (data-active toggles CSS).
 */
export default function BuyUI({
  selected,
  selectedIdx,
  totalItems,
  onPrev,
  onNext,
  onBuy,
  specialCollection,     // { title, items, hasAny } | null
}) {
  const isSpecialSelected = !!(selected && selected.__special);

  // Treat "no selection" as disabled state
  const hasSelection = !!selected;
  const atStart = !hasSelection || selectedIdx <= 0;
  const atEnd   = !hasSelection || selectedIdx >= totalItems - 1;

  const handlePrev = () => { if (!hasSelection || atStart) return; onPrev?.(); };
  const handleNext = () => { if (!hasSelection || atEnd) return; onNext?.(); };

  /** ---------------- PDP flow (only when NOT special) ---------------- */
  // normalize any "images" shape into [{src, alt}]
  const normalizeImages = (imgs, posterUrl) => {
    const list = [];
    const push = (src, alt='') => {
      if (!src) return;
      if (!list.some(i => i.src === src)) list.push({ src, alt });
    };

    if (Array.isArray(imgs)) {
      imgs.forEach(img => {
        if (!img) return;
        if (typeof img === 'string') push(img, '');
        else if (img.src) push(img.src, img.alt || '');
        else if (img.url) push(img.url, img.alt || '');
      });
    } else if (imgs?.edges?.length) {
      imgs.edges.forEach(e => push(e?.node?.url || e?.node?.src, e?.node?.altText || ''));
    } else if (imgs?.nodes?.length) {
      imgs.nodes.forEach(n => push(n?.url || n?.src, n?.altText || ''));
    }

    // ensure poster is first, if present
    if (posterUrl) {
      const already = list.find(i => i.src === posterUrl);
      if (!already) list.unshift({ src: posterUrl, alt: '' });
    }
    return list;
  };

  // Build a minimal PDP object from a *selected* catalog card (only as last resort)
  const synthesizeFromSelected = (sel) => {
    if (!sel) return null;
    const currency = sel.price?.currencyCode || 'EUR';
    const amount   = String(sel.price?.amount ?? '0');
    const variants = [{
      id: String(sel.defaultVariantId ?? `${sel.id}-default`),
      availableForSale: sel.available ?? true,
      price: { amount, currencyCode: currency },
      selectedOptions: [],
    }];
    return {
      id: String(sel.id ?? ''),
      title: sel.name || sel.title || '',
      descriptionHtml: sel.descriptionHtml || '',
      posterUrl: sel.posterUrl || '',
      images: normalizeImages(sel.images, sel.posterUrl || ''),
      options: sel.options || [],
      variants,
      defaultVariantId: variants[0]?.id || null,
      related: sel.related || [],
    };
  };

  // Unify shapes coming from /api/product, /products/<handle>.json, etc.
  const adaptProduct = (raw, sel) => {
    if (!raw) return synthesizeFromSelected(sel);
    const p = raw.product || raw;

    const title = p.title || sel?.name || sel?.title || '';
    const posterUrl =
      p.posterUrl ||
      p.featuredImage?.url ||
      p.image?.src ||
      p.images?.[0]?.src ||
      p.images?.nodes?.[0]?.url ||
      sel?.posterUrl ||
      '';

    const options = Array.isArray(p.options)
      ? p.options.map(o => ({ name: o.name, values: Array.from(new Set(o.values || [])) }))
      : (sel?.options || []);

    let variants = [];
    if (Array.isArray(p.variants)) {
      variants = p.variants.map(v => ({
        id: String(v.id ?? v.admin_graphql_api_id ?? v.sku ?? `${p.id || 'p'}-var`),
        availableForSale: !!(v.available ?? v.availableForSale ?? true),
        price: {
          amount: String(v.price?.amount ?? v.priceV2?.amount ?? v.price ?? sel?.price?.amount ?? '0'),
          currencyCode: v.price?.currencyCode || v.priceV2?.currencyCode || sel?.price?.currencyCode || 'EUR',
        },
        selectedOptions:
          (v.selectedOptions?.map(o => ({ name: o.name, value: o.value })) ||
            options.map((o, i) => ({ name: o.name, value: v[`option${i + 1}`] ?? o.values?.[0] ?? '' }))),
      }));
    } else if (p.variants?.edges?.length) {
      variants = p.variants.edges.map(({ node }) => ({
        id: String(node.id),
        availableForSale: !!node.availableForSale,
        price: {
          amount: String(node.price?.amount ?? node.priceV2?.amount ?? '0'),
          currencyCode: node.price?.currencyCode || node.priceV2?.currencyCode || 'EUR',
        },
        selectedOptions: node.selectedOptions || [],
      }));
    } else if (sel?.variants) {
      variants = sel.variants;
    }

    const defaultVariantId =
      p.defaultVariantId ||
      p.default_variant_id ||
      (variants.find(v => v.availableForSale)?.id) ||
      (variants[0]?.id) ||
      null;

    const images = normalizeImages(p.images, posterUrl);

    return {
      id: String(p.id ?? sel?.id ?? ''),
      title,
      descriptionHtml: p.descriptionHtml || p.body_html || '',
      posterUrl,
      images,
      options,
      variants,
      defaultVariantId,
      related: p.related || sel?.related || [],
    };
  };

  const inlineProduct = useMemo(() => {
    if (!selected || isSpecialSelected) return null;
    const maybe =
      selected?.product ||
      selected?.fullProduct ||
      (selected && selected.title && (selected.variants || selected.options) ? selected : null);
    return maybe ? adaptProduct(maybe, selected) : null;
  }, [selected, isSpecialSelected]);

  const [product, setProduct] = useState(null);
  const [pLoading, setPLoading] = useState(false);

  useEffect(() => {
    setProduct(null);

    if (!selected || isSpecialSelected) return; // skip PDP fetching when special

    // Inline → done
    if (inlineProduct) { setProduct(inlineProduct); return; }

    const handle = selected?.handle;
    if (!handle) { setProduct(synthesizeFromSelected(selected)); return; }

    let cancelled = false;
    async function load() {
      setPLoading(true);

      // 1) Primary: our API
      try {
        const res = await fetch(`/api/product?handle=${encodeURIComponent(handle)}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const base = adaptProduct(data, selected);
        if (!cancelled) setProduct(base);

        const canTryThemeJson = (() => {
          if (themeJsonAvailable === false) return false;
          if (typeof window === 'undefined') return themeJsonAvailable !== false;
          if (themeJsonAvailable === null) {
            try {
              const stored = sessionStorage.getItem('km_theme_json_available');
              if (stored === '0') themeJsonAvailable = false;
              else if (stored === '1') themeJsonAvailable = true;
            } catch {}
          }
          return themeJsonAvailable !== false;
        })();

        if (canTryThemeJson) {
          try {
            const r2 = await fetch(`/products/${handle}.json`, { cache: 'no-store' });
            if (r2.ok) {
              const d2 = await r2.json();
              const enriched = adaptProduct(d2, selected);
              const merged = {
                ...base,
                images: (() => {
                  const seen = new Set();
                  const out = [];
                  const add = (src, alt='') => { if (src && !seen.has(src)) { seen.add(src); out.push({ src, alt }); } };
                  add(base.posterUrl, '');
                  (base.images || []).forEach(i => add(i.src, i.alt));
                  (enriched.images || []).forEach(i => add(i.src, i.alt));
                  return out;
                })(),
              };
              if (!cancelled) setProduct(merged);
              themeJsonAvailable = true;
              try { sessionStorage.setItem('km_theme_json_available', '1'); } catch {}
            } else if (r2.status === 404) {
              themeJsonAvailable = false;
              try { sessionStorage.setItem('km_theme_json_available', '0'); } catch {}
            }
          } catch {
            themeJsonAvailable = false;
            try { sessionStorage.setItem('km_theme_json_available', '0'); } catch {}
          }
        }

      } catch (e) {
        // 3) fallback to theme JSON directly
        try {
          const r2 = themeJsonAvailable === false ? null : await fetch(`/products/${handle}.json`, { cache: 'no-store' });
          if (!r2?.ok) throw new Error(`HTTP ${r2?.status}`);
          const d2 = await r2.json();
          const adapted = adaptProduct(d2, selected);
          if (!cancelled) setProduct(adapted);
        } catch {
          // last resort: synthesize from the selection card
          if (!cancelled) setProduct(synthesizeFromSelected(selected));
        }
      } finally {
        if (!cancelled) setPLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [selected, isSpecialSelected, inlineProduct]);

  // Fallback “open full page”
  const handleOpenFullPage = () => {
    if (!selected) return;
    if (isSpecialSelected) {
      // Optional: route to the special collection page
      window.location.href = `/collections/${encodeURIComponent('special')}`;
      return;
    }
    if (onBuy) onBuy();
    else if (selected?.handle) window.location.href = `/products/${selected.handle}`;
  };

  const buyuiRef = useRef(null);
  const woodRef = useRef(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const wood = woodRef.current;
    if (!wood) return;
    const onScroll = () => {
      setIsExpanded(wood.scrollTop > 0);
    };
    wood.addEventListener('scroll', onScroll);
    return () => wood.removeEventListener('scroll', onScroll);
  }, []);

  const titleText = hasSelection
    ? (isSpecialSelected
        ? (specialCollection?.description || specialCollection?.title || 'Special')
        : (selected?.name || selected?.title || ''))
    : '';

  return (
    <div
      id="buyui"
      ref={buyuiRef}
      className={isExpanded ? 'expand' : ''}
      data-active={hasSelection}
      aria-hidden={!hasSelection}
    >
      <div className="buyui-wrap">
        {/* Leather middle bar */}
        <div className="buyui-bar">
          <div className="buyui-bar__inner">
            <button
              className={`buyui-btn arrow-left${atStart ? ' disabled' : ''}`}
              onClick={handlePrev}
              disabled={atStart}
              aria-label="letztes Produkt"
            >
              <span>letztes</span>
            </button>

            {/* keep id=buyTitle so AppChrome can read it */}
            <h2 id="buyTitle" className="buyui-title">{titleText}</h2>

            <button
              className={`buyui-btn arrow-right${atEnd ? ' disabled' : ''}`}
              onClick={handleNext}
              disabled={atEnd}
              aria-label="nächstes Produkt"
            >
              <span>nächstes</span>
            </button>
          </div>
        </div>

        {/* Wood panel with embedded content */}
        <div className="buyui-wood" ref={woodRef}>
          {!hasSelection ? null : (
            <>
              {/* SPECIAL: render collection client */}
              {isSpecialSelected && (
                <div className="buyui-detail">
                  {specialCollection?.hasAny ? (
                    <CollectionClient
                      title={specialCollection.title}
                      description={specialCollection.description}
                      descriptionHtml={specialCollection.descriptionHtml}
                      items={specialCollection.items}
                    />
                  ) : (
                    <div className="buyui-detail error">
                      <p>Diese Kollektion ist leer.</p>
                      <button className="btn-aqua" onClick={handleOpenFullPage}>Öffnen</button>
                    </div>
                  )}
                </div>
              )}

              {/* NORMAL PDP */}
              {!isSpecialSelected && (
                <>
                  {!product && (
                    <div className="buyui-detail loading" aria-busy="true" aria-live="polite">
                      <div className="spinner" />
                    </div>
                  )}

                  {product && (
                    <div className="buyui-detail">
                      <ProductDetailClient product={product} related={product.related || []} />
                    </div>
                  )}

                  {!product && (
                    <div className="buyui-detail error">
                      
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
