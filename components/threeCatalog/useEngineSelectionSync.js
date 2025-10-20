'use client';

import { useEffect } from 'react';

import { getEngine } from '@/lib/three-catalog/engine';

export default function useEngineSelectionSync({ selectedId, section, contentRef, overlayRef }) {
  useEffect(() => {
    const eng = getEngine();
    if (!eng) return;

    eng.selectById(selectedId);
    eng.setSelectionPlaneVisible(!!selectedId);

    const contentEl = contentRef?.current;
    const lock = !!selectedId || !!section;
    const overlayEl = overlayRef?.current;
    if (contentEl) {
      if (lock) contentEl.classList.add('locked');
      else contentEl.classList.remove('locked');
    }
    if (overlayEl) {
      if (lock) overlayEl.classList.add('overlay-grid--selected');
      else overlayEl.classList.remove('overlay-grid--selected');
    }

    eng.setLockGridY(lock);

    if (selectedId) eng.focusSelectedToAnchor();
    else if (section) eng.focusSectionToFixed(section);
    else eng.releaseSelectedToScroll();

    const isSel = !!selectedId;
    const evt = new CustomEvent('km_selected_change', { detail: { selected: isSel } });
    window.dispatchEvent(evt);
    document.dispatchEvent(evt);
    document.body.dataset.kmSelected = isSel ? '1' : '0';
    const buy = document.getElementById('buyui');
    if (buy) buy.setAttribute('data-active', isSel ? 'true' : 'false');

    // Force a relayout so overlay height/rects are immediately correct
    try {
      eng.forceRelayoutNow?.();
      eng.queueRelayout?.();
      // A couple of delayed kicks to catch async image/font/layout updates
      requestAnimationFrame(() => eng.forceRelayoutNow?.());
      setTimeout(() => eng.forceRelayoutNow?.(), 60);
      setTimeout(() => eng.forceRelayoutNow?.(), 180);
    } catch {}
  }, [selectedId, section, contentRef, overlayRef]);
}
