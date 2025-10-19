'use client';

import { useEffect, useRef, useState } from 'react';

import { getEngine } from '@/lib/three-catalog/engine';

export default function useEngineOverlay() {
  const [overlay, setOverlay] = useState({ rects: [], contentHeightPx: 0, topOffsetPx: 0, rowHeightPx: 0 });
  const versionRef = useRef(-1);

  useEffect(() => {
    const eng = getEngine();
    if (!eng || typeof window === 'undefined') return;
    let raf = 0;
    const tick = () => {
      const data = eng.getOverlayData?.();
      if (data && data.version !== versionRef.current) {
        versionRef.current = data.version;
        setOverlay({
          rects: data.rects || [],
          contentHeightPx: data.contentHeightPx || 0,
          topOffsetPx: data.topOffsetPx || 0,
          rowHeightPx: data.rowHeightPx || 0,
        });
      }
      raf = window.requestAnimationFrame(tick);
    };
    tick();
    return () => window.cancelAnimationFrame(raf);
  }, []);

  return overlay;
}
