// components/ThreeCatalog.jsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import BuyUI from '@/components/BuyUI';
import TalkBubble from '@/components/TalkBubble';
import LegalOverlay from '@/components/LegalOverlay';
import useSpecialCollection from '@/components/threeCatalog/useSpecialCollection';
import useThreeEngineSetup from '@/components/threeCatalog/useThreeEngineSetup';
import useEngineSelectionSync from '@/components/threeCatalog/useEngineSelectionSync';
import useEngineOverlay from '@/components/threeCatalog/useEngineOverlay';
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
  const overlayRef = useRef(null);

  const defaultMainpage = { greeting: '', about: '', legalMessage: '', legalFulltext: '', horseClickMessage: '', backgroundUrl: '', envMapUrl: '' };
  const [mainpage, setMainpage] = useState(() => {
    if (typeof window === 'undefined') return defaultMainpage;
    try {
      const stored = sessionStorage.getItem('km_mainpage_cache');
      return stored ? { ...defaultMainpage, ...JSON.parse(stored) } : defaultMainpage;
    } catch {
      return defaultMainpage;
    }
  });

  useEffect(() => {
    let cancelled = false;
    const cached = (() => {
      if (typeof window === 'undefined') return null;
      try {
        const stored = sessionStorage.getItem('km_mainpage_cache');
        return stored ? JSON.parse(stored) : null;
      } catch { return null; }
    })();
    if (cached) setMainpage(prev => ({ ...prev, ...cached }));

    (async () => {
      try {
        const res = await fetch('/api/mainpage', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        const next = {
          greeting: (json?.greeting || '').trim(),
          about: (json?.about || '').trim(),
          legalMessage: (json?.legalMessage || '').trim(),
          legalFulltext: (json?.legalFulltext || '').trim(),
          horseClickMessage: (json?.horseClickMessage || '').trim(),
          backgroundUrl: (json?.backgroundUrl || '').trim(),
          envMapUrl: (json?.envMapUrl || '').trim?.() || '',
        };
        setMainpage(prev => ({ ...prev, ...next }));
        try { sessionStorage.setItem('km_mainpage_cache', JSON.stringify(next)); } catch {}
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

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
    const msg = section === 'about'
      ? (mainpage.about || readSectionText('about'))
      : section === 'legal'
        ? ''
        : '';
    if (msg) window.kmSaySet?.(msg);
  }, [section, mainpage.about]);

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
  useThreeEngineSetup({
    containerRef,
    contentRef,
    items: allItems,
    backgroundUrl: mainpage.backgroundUrl,
  });
  useEngineSelectionSync({ selectedId, section, contentRef, overlayRef });

  const overlayData = useEngineOverlay();
  const overlayHeight = Math.max(0, overlayData.contentHeightPx || 0);
  const topOffsetPx = overlayData.topOffsetPx || 0;
  const itemLookup = useMemo(() => {
    const map = new Map();
    for (const item of allItems) map.set(item.id, item);
    return map;
  }, [allItems]);

  /* ---------- URL sync ---------- */
  useInitialSelection(allItems, setSelectedId);
  useSelectionUrlSync(selectedId, allItems, section);
  useHistorySelectionSync(allItems, section, setSelectedId);

  /* ---------- Bubble + overlay ---------- */
  const bubble = useTalkBubble({ selectedId, section, copy: { greeting: mainpage.greeting, horseClickMessage: mainpage.horseClickMessage } });
  useEffect(() => {
    if (section === 'legal') window.kmSayClear?.();
  }, [section]);
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
      <TalkBubble text={bubble.text} x={bubble.x} y={bubble.y} visible={bubble.visible} clamped={bubble.clamped} />
      <LegalOverlay message={mainpage.legalMessage} visible={section === 'legal'} />

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

        <div
          className="overlay-grid"
          id="grid"
          ref={overlayRef}
          style={{ height: `${overlayHeight}px`, marginTop: `${topOffsetPx}px` }}
          aria-hidden={(!!selected || !!section) ? 'true' : 'false'}
        >
          {overlayData.rects.map((rect) => {
            const item = itemLookup.get(rect.id);
            if (!item) return null;
            const localTop = rect.top - topOffsetPx;
            const style = {
              left: `${rect.left}px`,
              top: `${localTop}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
            };
            const soldOut = !item.available;
            const onActivate = () => {
              if (!soldOut) setSelectedId(item.id);
            };
            return (
              <div
                key={item.id}
                className={`overlay-cell${soldOut ? ' soldout' : ''}`}
                style={style}
                role="button"
                tabIndex={soldOut ? -1 : 0}
                aria-label={soldOut ? `${item.name} – ausverkauft` : `${item.name}`}
                onClick={onActivate}
                onKeyDown={(e) => {
                  if (soldOut) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onActivate();
                  }
                }}
              >
                <span className="overlay-cell__label">{item.name}</span>
                {soldOut && <span className="overlay-cell__badge">Ausverkauft</span>}
              </div>
            );
          })}
        </div>

        <div style={{ height: '12vh' }} />
      </div>
    </>
  );
}
