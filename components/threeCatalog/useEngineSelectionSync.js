'use client';

import { useEffect } from 'react';

import { getEngine } from '@/lib/three-catalog/engine';

export default function useEngineSelectionSync({ selectedId, section, contentRef, gridRef }) {
  useEffect(() => {
    const eng = getEngine();
    if (!eng) return;

    eng.selectById(selectedId);
    eng.setSelectionPlaneVisible(!!selectedId);

    const contentEl = contentRef?.current;
    const gridEl = gridRef?.current;
    const lock = !!selectedId || !!section;
    if (contentEl && gridEl) {
      if (lock) {
        contentEl.classList.add('locked');
        gridEl.classList.add('disabled');
      } else {
        contentEl.classList.remove('locked');
        gridEl.classList.remove('disabled');
      }
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
  }, [selectedId, section, contentRef, gridRef]);
}
