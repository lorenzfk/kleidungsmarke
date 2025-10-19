'use client';

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import AddToCartClient from '@/components/AddToCartClient';
import VariantPicker from '@/components/VariantPicker';

/* ---------- helpers ---------- */
function priceText(p) {
  if (!p) return '';
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: p.currencyCode || 'EUR' })
      .format(Number(p.amount || 0));
  } catch {
    return `${Number(p.amount || 0).toFixed(2)} ${p.currencyCode || 'EUR'}`;
  }
}
function isTrivialOptions(options) {
  if (!options || options.length === 0) return true;
  const filtered = options
    .map(opt => ({ name: opt.name || '', values: Array.from(new Set(opt.values || [])) }))
    .filter(opt => {
      const isDefaultTitle =
        opt.name?.toLowerCase?.() === 'title' &&
        (opt.values?.length || 0) === 1 &&
        (String(opt.values[0] || '')).toLowerCase() === 'default title';
      return !isDefaultTitle && (opt.values?.length || 0) > 0;
    });
  if (filtered.length === 0) return true;
  return filtered.every(opt => (opt.values?.length || 0) <= 1);
}
function findVariant(variants, selected) {
  const selMap = new Map((selected || []).map(o => [o.name, o.value]));
  return (variants || []).find(v =>
    (v.selectedOptions || []).every(o => selMap.get(o.name) === o.value)
  ) || null;
}
function initialSelected(options, variants, defaultVariantId) {
  const def = (variants || []).find(v => v.id === defaultVariantId);
  if (def && def.selectedOptions?.length) return def.selectedOptions;
  return (options || []).map(opt => ({ name: opt.name, value: (opt.values?.[0] || '') }));
}

/* ---------- tiny, dependency-free carousel ---------- */
function HeroCarousel({ images, title }) {
  const list = Array.isArray(images) ? images.filter(i => i?.src) : [];
  if (list.length === 0) return null;

  const [idx, setIdx] = useState(0);
  const [resizeTick, setResizeTick] = useState(0);
  const wrap = useRef(null);
  const clamp = useCallback((n) => (n + list.length) % list.length, [list.length]);
  const prev = useCallback(() => setIdx((i) => clamp(i - 1)), [clamp]);
  const next = useCallback(() => setIdx((i) => clamp(i + 1)), [clamp]);

  // swipe support
  useEffect(() => {
    const el = wrap.current;
    if (!el || list.length <= 1) return;
    let startX = 0, curX = 0, dragging = false;

    const onDown = (e) => {
      dragging = true;
      startX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      curX = startX;
    };
    const onMove = (e) => { if (!dragging) return; curX = 'touches' in e ? e.touches[0].clientX : e.clientX; };
    const onUp   = () => {
      if (!dragging) return;
      const dx = curX - startX;
      dragging = false;
      if (Math.abs(dx) > 40) { if (dx < 0) next(); else prev(); }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('touchstart', onDown, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('touchstart', onDown);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onUp);
    };
  }, [list.length, next, prev]);

  useEffect(() => {
    const handle = () => setResizeTick((t) => t + 1);
    window.addEventListener('resize', handle);
    window.addEventListener('orientationchange', handle);
    return () => {
      window.removeEventListener('resize', handle);
      window.removeEventListener('orientationchange', handle);
    };
  }, []);

  const trackStyle = {
    width: '100%',
    height: '100%',
  };
  const innerStyle = {
    display: 'flex',
    width: `${list.length * 100}%`,
    transform: `translateX(-${idx * (100 / list.length)}%)`,
    transition: 'transform .35s ease',
    height: '100%',
  };
  const slideStyle = {
    width: `${100 / list.length}%`,
    flex: '0 0 auto',
    height: '100%',
    position: 'relative',
  };

  const navBtn = {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    border: '2px solid white',
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,.2), 0 6px 6px rgba(0,0,0,.55)',
    background: 'linear-gradient(to bottom, #85beffff, #1500ffff)',
    fontSize: 20,
    textShadow: '0 0 3px rgba(0,0,0,.5)',
    color: '#fff',
    width: 36,
    height: 36,
    borderRadius: 999,
    cursor: 'pointer',
  };

  const content = (
    <div className="product-poster">
      <div className="product-poster__square">
        <div
          ref={wrap}
          className="product-poster__carousel"
          style={trackStyle}
          aria-roledescription={list.length > 1 ? 'carousel' : undefined}
          aria-label="Produktbilder"
        >
          <div className="product-poster__inner" style={innerStyle} key={resizeTick}>
            {list.map((img, i) => (
              <div key={i} className="product-poster__slide" style={slideStyle}>
                <img className="product-poster__img" src={img.src} alt={img.alt || title} />
              </div>
            ))}
          </div>

          {list.length > 1 && (
            <>
              <button aria-label="vorheriges Bild" onClick={prev} style={{ ...navBtn, left: 12 }}>◀︎</button>
              <button aria-label="nächstes Bild" onClick={next} style={{ ...navBtn, right: 12 }}>▶︎</button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return content;
}

/* ---------- PDP ---------- */
export default function ProductDetailClient({ product, related = [] }) {
  // Harden against undefined product
  const p = product || {};

  // Build robust image list: posterUrl first, then product images
  const images = useMemo(() => {
    const list = [];
    const add = (src, alt='') => { if (src && !list.some(i => i.src === src)) list.push({ src, alt }); };

    if (p.posterUrl) add(p.posterUrl, p.title);

    if (Array.isArray(p.images)) {
      p.images.forEach(i => add(i?.src || i?.url, i?.alt || i?.altText || p.title));
    } else if (p.images?.nodes?.length) {
      p.images.nodes.forEach(n => add(n?.url || n?.src, n?.altText || p.title));
    } else if (p.images?.edges?.length) {
      p.images.edges.forEach(e => add(e?.node?.url || e?.node?.src, e?.node?.altText || p.title));
    } else if (p.image?.src) {
      add(p.image.src, p.title);
    }

    return list;
  }, [p]);

  const [selected, setSelected] = useState(
    initialSelected(p.options || [], p.variants || [], p.defaultVariantId)
  );

  const hasOptions = useMemo(
    () => !isTrivialOptions(p.options),
    [p.options]
  );

  const variant = useMemo(
    () => findVariant(p.variants || [], selected) || null,
    [p.variants, selected]
  );

  const price = variant?.price || null;
  const available = variant?.availableForSale ?? p.availableForSale ?? true;

  // If we still don't have a real product payload (no id/title), render nothing
  if (!p || (!p.id && !p.handle)) return null;

  return (
    <div className="product-page">
      <div className="container">
        <a style={{display:'none'}} className="btn-aqua btn-close back-link" href="/">← Katalog</a>

        <div className="product-hero">
          <HeroCarousel images={images} title={p.title} />

          <div className="product-info">
            {price && <div className="product-price">{priceText(price)}</div>}
            <h1 style={{ display:'none' }} className="product-title">{p.title}</h1>

            {hasOptions && (
              <VariantPicker
                options={p.options || []}
                variants={p.variants || []}
                selected={selected}
                onChange={setSelected}
              />
            )}

            {!!p.descriptionHtml && (
              <div
                className="product-desc"
                dangerouslySetInnerHTML={{ __html: p.descriptionHtml }}
              />
            )}

            <div className="product-actions">
              <AddToCartClient
                variantId={variant?.id || null}
                disabled={!available}
              />
            </div>

            {available === false && (
              <div style={{ marginTop: 10, color: '#fff', opacity: .85 }}>
                Aktuell nicht verfügbar für die gewählte Option.
              </div>
            )}
          </div>
        </div>

        {Array.isArray(related) && related.length > 0 && (
          <section className="related-section">
            <h2 className="related-title">Mehr von kleidungsmarke</h2>
            <div className="related-grid">
              {related.map((r) => (
                <Link href={`/products/${r.handle}`} key={r.id} className="related-card">
                  <img
                    src={r.posterUrl || '/placeholder.png'}
                    alt={r.title}
                    className="related-img"
                  />
                  <div className="related-name">{r.title}</div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
