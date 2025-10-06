// components/ThreeCatalog.jsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import BuyUI from '@/components/BuyUI';
import TalkBubble from '@/components/TalkBubble';
import useSpecialCollection from '@/components/threeCatalog/useSpecialCollection';
import useThreeEngineSetup from '@/components/threeCatalog/useThreeEngineSetup';
import useEngineSelectionSync from '@/components/threeCatalog/useEngineSelectionSync';
import useTalkBubble from '@/components/threeCatalog/useTalkBubble';
import useLoadingOverlay from '@/components/threeCatalog/useLoadingOverlay';
import { readSectionText } from '@/components/threeCatalog/text';
import {
  useHistorySelectionSync,
  useInitialSelection,
  useSelectionUrlSync,
} from '@/components/threeCatalog/useUrlSync';
import {
  SPECIAL_HANDLE,
  SPECIAL_MODEL_URL,
  SPECIAL_TITLE_FALLBACK,
} from '@/lib/three-catalog/constants';

function LoadingOverlay({ visible, pct }) {
  if (!visible) return null;
  const pct100 = Math.max(0, Math.min(100, Math.round(pct * 100)));
  return (
    <div className="km-overlay" aria-busy="true" aria-live="polite">
      <div className="km-overlay-inner" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct100}>
        <img src="/startup-logo.png" alt="" className="km-overlay-logo" />
        <div className="km-progress">
          <div className="km-progress-bar" style={{ ['--km-pct']: `${pct100}%` }} />
        </div>
      </div>
    </div>
  );
}

export default function ThreeCatalog({ products }) {
  const router = useRouter();

  const containerRef = useRef(null);
  const contentRef = useRef(null);
  const gridRef = useRef(null);

  const [selectedId, setSelectedId] = useState(null);
  const [section, setSection] = useState(null); // 'about' | 'legal' | null

  // SECTION param sync
  useEffect(() => {
    const readSection = () => {
      try {
        const sp = new URLSearchParams(window.location.search);
        const s = sp.get('section');
        setSection(s === 'about' || s === 'legal' ? s : null);
      } catch {
        setSection(null);
      }
    };

    readSection();
    const onPop = () => readSection();
    const onSectionChanged = (e) => {
      const next = e.detail?.section;
      setSection(next === 'about' || next === 'legal' ? next : null);
    };

    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    window.addEventListener('km_section_changed', onSectionChanged);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
      window.removeEventListener('km_section_changed', onSectionChanged);
    };
  }, []);

  // Clear section when a product gets selected
  useEffect(() => {
    if (!selectedId) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('section');
      window.history.replaceState({}, '', url);
    } catch {}
    setSection(null);
  }, [selectedId]);

  // Section behavior: clear selection + bubble text
  useEffect(() => {
    if (!section) return;
    setSelectedId(null);
    const msg = readSectionText(section);
    if (msg) window.kmSaySet?.(msg);
  }, [section]);

  // Clear selection event from AppChrome
  useEffect(() => {
    const onClear = () => {
      setSelectedId(null);
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('sel');
        window.history.replaceState({}, '', url);
      } catch {}
    };
    window.addEventListener('km_clear_selection', onClear);
    return () => window.removeEventListener('km_clear_selection', onClear);
  }, []);

  /* ---------- Data prep ---------- */
  const baseItems = useMemo(() => (products || []).map(p => ({
    id: p.id,
    handle: p.handle,
    name: p.title,
    priceText: `${Number(p.price?.amount ?? 0).toFixed(2)} ${p.price?.currencyCode ?? ''}`,
    currency: p.price?.currencyCode || '',
    modelUrl: p.modelUrl,
    posterUrl: p.posterUrl,
    available: p.availableForSale !== false,
  })), [products]);

  const specialCol = useSpecialCollection();

  const allItems = useMemo(() => {
    if (!specialCol.hasAny) return baseItems;
    const specialTile = {
      id: '__special__',
      handle: SPECIAL_HANDLE,
      name: specialCol.title || SPECIAL_TITLE_FALLBACK,
      modelUrl: SPECIAL_MODEL_URL,
      posterUrl: specialCol.items?.[0]?.posterUrl || '',
      available: true,
      __special: true,
      priceText: '',
      currency: '',
    };
    return [specialTile, ...baseItems];
  }, [baseItems, specialCol]);

  /* ---------- Engine wiring ---------- */
  useThreeEngineSetup({ containerRef, contentRef, gridRef, items: allItems });
  useEngineSelectionSync({ selectedId, section, contentRef, gridRef });

  /* ---------- URL sync ---------- */
  useInitialSelection(allItems, setSelectedId);
  useSelectionUrlSync(selectedId, allItems, section);
  useHistorySelectionSync(allItems, section, setSelectedId);

  /* ---------- Bubble + overlay ---------- */
  const bubble = useTalkBubble({ selectedId, section });
  const { overlayVisible, pct } = useLoadingOverlay();

  /* ---------- Derived selection ---------- */
  const selected = selectedId ? allItems.find(i => i.id === selectedId) : null;
  const selectedIdx = selected ? allItems.findIndex(i => i.id === selected.id) : -1;

  const buyNow = () => {
    if (!selected || !selected.available) return;
    router.push(`/products/${selected.handle}`);
  };
  const selectPrev = () => {
    if (selectedIdx > 0) setSelectedId(allItems[selectedIdx - 1].id);
  };
  const selectNext = () => {
    if (selectedIdx >= 0 && selectedIdx < allItems.length - 1) setSelectedId(allItems[selectedIdx + 1].id);
  };

  return (
    <>
      <LoadingOverlay visible={overlayVisible} pct={pct} />

      {/* 3D layer */}
      <div id="three-container" ref={containerRef} aria-hidden="true" />

      {/* Character bubble (persistent) */}
      <TalkBubble text={bubble.text} x={bubble.x} y={bubble.y} visible={bubble.visible} />

      {/* Foreground scroll layer */}
      <div className="content" id="content" ref={contentRef} aria-busy={overlayVisible}>
        <BuyUI
          selected={selected}
          selectedIdx={selectedIdx}
          totalItems={allItems.length}
          onPrev={selectPrev}
          onNext={selectNext}
          onBuy={buyNow}
          specialCollection={specialCol.hasAny ? specialCol : null}
        />

        <div className="grid" id="grid" ref={gridRef} aria-hidden={(!!selected || !!section) ? 'true' : 'false'}>
          {allItems.map(p => (
            <figure
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              title={p.name}
              className={p.available ? '' : 'soldout'}
              style={p.available ? undefined : { position: 'relative' }}
            >
              {!p.available && (
                <span
                  className="soldout-badge"
                  style={{
                    position: 'absolute', top: 8, left: 8, zIndex: 3,
                    padding: '6px 10px', borderRadius: 999, color: '#fff', fontWeight: 900,
                    fontSize: '0.8rem', letterSpacing: '.4px', textTransform: 'uppercase',
                    pointerEvents: 'none',
                    boxShadow: '0 6px 12px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.2)'
                  }}
                >
                  AUSVERKAUFT
                </span>
              )}
              <img src={p.posterUrl || '/placeholder.png'} alt={p.name} />
              <h3>{p.name}</h3>
            </figure>
          ))}
        </div>

        <div style={{ height: '30vh' }} />
      </div>
    </>
  );
}
