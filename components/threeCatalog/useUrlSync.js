'use client';

import { useEffect, useRef } from 'react';

export function useInitialSelection(allItems, setSelectedId) {
  const initialSelHandleRef = useRef(null);

  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      initialSelHandleRef.current = u.searchParams.get('sel') || null;
    } catch {}
  }, []);

  useEffect(() => {
    const handle = initialSelHandleRef.current;
    if (!handle || !allItems.length) return;
    const match = allItems.find((item) => item.handle === handle);
    if (match) setSelectedId(match.id);
    initialSelHandleRef.current = null;
  }, [allItems, setSelectedId]);
}

export function useSelectionUrlSync(selectedId, allItems, section) {
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (selectedId) {
        const item = allItems.find((i) => i.id === selectedId);
        if (item?.handle) {
          url.searchParams.set('sel', item.handle);
          url.searchParams.delete('section');
        }
      } else {
        url.searchParams.delete('sel');
      }
      window.history.replaceState({}, '', url);
    } catch {}
  }, [selectedId, allItems, section]);
}

export function useHistorySelectionSync(allItems, section, setSelectedId) {
  useEffect(() => {
    const applyFromURL = () => {
      try {
        const u = new URL(window.location.href);
        const handle = u.searchParams.get('sel');
        if (!section && handle) {
          const match = allItems.find((item) => item.handle === handle);
          setSelectedId(match ? match.id : null);
        } else if (!section) {
          setSelectedId(null);
        }
      } catch {
        if (!section) setSelectedId(null);
      }
    };

    window.addEventListener('popstate', applyFromURL);
    window.addEventListener('hashchange', applyFromURL);
    return () => {
      window.removeEventListener('popstate', applyFromURL);
      window.removeEventListener('hashchange', applyFromURL);
    };
  }, [allItems, section, setSelectedId]);
}
