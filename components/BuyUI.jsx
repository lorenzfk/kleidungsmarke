'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import ProductDetailClient from '@/components/ProductDetailClient';

/**
 * BuyUI renders the leather bar + wood panel and embeds a full PDP for the selected item.
 * - Keeps itself in the DOM even when nothing is selected (data-active toggles CSS).
 * - Fetches from /api/product first (your server helper), then *optionally* enriches
 *   with Shopify theme JSON (/products/<handle>.json or .js) to get extra images.
 * - Always sets posterUrl and images[] for ProductDetailClient.
 */
export default function BuyUI({
  selected,
  selectedIdx,
  totalItems,
  onPrev,
  onNext,
  onBuy,
}) {
  // Treat "no selection" as disabled state
  const hasSelection = !!selected;
  const atStart = !hasSelection || selectedIdx <= 0;
  const atEnd   = !hasSelection || selectedIdx >= totalItems - 1;

  const handlePrev = () => { if (!hasSelection || atStart) return; onPrev?.(); };
  const handleNext = () => { if (!hasSelection || atEnd) return; onNext?.(); };

  /** -------- adapters (keep tiny & defensive) -------- */

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

    // Known shapes:
    // - Our /api/product → { id,title,descriptionHtml,posterUrl,options[],variants[],defaultVariantId }
    // - Shopify theme JSON → { product: { title, body_html, images: [{src..}], image, variants, options } }
    const p = raw.product || raw; // absorb theme "product" wrapper if present

    const title = p.title || sel?.name || sel?.title || '';
    const posterUrl =
      p.posterUrl ||
      p.featuredImage?.url ||
      p.image?.src ||
      p.images?.[0]?.src ||
      p.images?.nodes?.[0]?.url ||
      sel?.posterUrl ||
      '';

    // options
    const options = Array.isArray(p.options)
      ? p.options.map(o => ({ name: o.name, values: Array.from(new Set(o.values || [])) }))
      : (sel?.options || []);

    // variants (normalize a few known shapes)
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

    // images
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

  // Prefer a complete product bundled with the selection (if you ever pass it in)
  const inlineProduct = useMemo(() => {
    const maybe =
      selected?.product ||
      selected?.fullProduct ||
      (selected && selected.title && (selected.variants || selected.options) ? selected : null);
    return maybe ? adaptProduct(maybe, selected) : null;
  }, [selected]);

  const [product, setProduct] = useState(null);
  const [pLoading, setPLoading] = useState(false);

  useEffect(() => {
    setProduct(null);
    if (!hasSelection) return;

    // Inline → done
    if (inlineProduct) { setProduct(inlineProduct); return; }

    const handle = selected?.handle;
    if (!handle) { setProduct(synthesizeFromSelected(selected)); return; }

    let cancelled = false;
    async function load() {
      setPLoading(true);

      // 1) Primary: our API (guarantees posterUrl/options/variants)
      try {
        const res = await fetch(`/api/product?handle=${encodeURIComponent(handle)}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const base = adaptProduct(data, selected);
        if (!cancelled) setProduct(base);

        // 2) Optional enrichment: try theme JSON for more images (doesn't break if it fails)
        try {
          const r2 = await fetch(`/products/${handle}.json`, { cache: 'no-store' });
          if (r2.ok) {
            const d2 = await r2.json();
            const enriched = adaptProduct(d2, selected);
            // merge images (keep poster first, de-dupe)
            const merged = {
              ...base,
              images: (() => {
                const seen = new Set();
                const out = [];
                const add = (src, alt='') => { if (src && !seen.has(src)) { seen.add(src); out.push({ src, alt }); } };
                // poster first
                add(base.posterUrl, '');
                (base.images || []).forEach(i => add(i.src, i.alt));
                (enriched.images || []).forEach(i => add(i.src, i.alt));
                return out;
              })(),
            };
            if (!cancelled) setProduct(merged);
          }
        } catch {}

      } catch (e) {
        // 3) fallback to theme JSON directly
        try {
          const r2 = await fetch(`/products/${handle}.json`, { cache: 'no-store' });
          if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
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
  }, [hasSelection, selected, inlineProduct]);

  // Fallback “open full page” if you still want a button somewhere
  const handleOpenFullPage = () => {
    if (!hasSelection) return;
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
          <button
            className={`buyui-btn arrow-left${atStart ? ' disabled' : ''}`}
            onClick={handlePrev}
            disabled={atStart}
            aria-label="letztes Produkt"
          >
            <span>letztes</span>
          </button>

          {/* keep id=buyTitle so AppChrome can read it */}
          <h2 id="buyTitle" className="buyui-title">
            {hasSelection ? (selected?.name || selected?.title || '') : ''}
          </h2>

          <button
            className={`buyui-btn arrow-right${atEnd ? ' disabled' : ''}`}
            onClick={handleNext}
            disabled={atEnd}
            aria-label="nächstes Produkt"
          >
            <span>nächstes</span>
          </button>
        </div>

        {/* Wood panel with embedded product detail */}
        <div className="buyui-wood" ref={woodRef}>
          {!hasSelection ? null : (
            <>
              {pLoading && (
                <div className="buyui-detail loading" aria-busy="true" aria-live="polite">
                  <div className="spinner" />
                </div>
              )}

              {!pLoading && product && (
                <div className="buyui-detail">
                  <ProductDetailClient product={product} related={product.related || []} />
                </div>
              )}

              {!pLoading && !product && (
                <div className="buyui-detail error">
                  <button className="btn-aqua" onClick={handleOpenFullPage}>
                    Zum Produkt
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
