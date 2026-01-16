'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { clamp } from '@/lib/three-catalog/constants';

export default function useLoadingOverlay() {
  const [load, setLoad] = useState({ loaded: 0, total: 0, done: false });
  const [overlayVisible, setOverlayVisible] = useState(true);
  const hideTimeoutRef = useRef(null);
  const doneOnceRef = useRef(false);

  useEffect(() => {
    const onProg = (e) => {
      const { phase, loaded, total } = e.detail || {};
      if (phase === 'done') {
        doneOnceRef.current = true;
        setLoad({ loaded: 1, total: 1, done: true });
        return;
      }
      if (doneOnceRef.current) return;
      else if (phase === 'progress' || phase === 'start') {
        const L = Math.max(0, Number(loaded || 0));
        const T = Math.max(L, Number(total || 0));
        setLoad({ loaded: L, total: T, done: false });
      }
    };
    window.addEventListener('km_loading_progress', onProg);
    return () => window.removeEventListener('km_loading_progress', onProg);
  }, []);

  useEffect(() => {
    clearTimeout(hideTimeoutRef.current);
    if (load.done) hideTimeoutRef.current = setTimeout(() => setOverlayVisible(false), 250);
    else setOverlayVisible(true);
    return () => clearTimeout(hideTimeoutRef.current);
  }, [load.done]);

  const pct = useMemo(() => {
    const { loaded, total, done } = load;
    if (done) return 1;
    if (!total || total <= 0) return 0.1;
    return clamp(loaded / total, 0, 1);
  }, [load]);

  return { overlayVisible, pct };
}
