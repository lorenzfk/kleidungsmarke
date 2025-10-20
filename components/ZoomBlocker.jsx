'use client';

import { useEffect } from 'react';

export default function ZoomBlocker() {
  useEffect(() => {
    // Prevent pinch-zoom (iOS Safari emits gesture* events)
    const stop = (e) => { try { e.preventDefault(); } catch {} };
    document.addEventListener('gesturestart', stop, { passive: false });
    document.addEventListener('gesturechange', stop, { passive: false });
    document.addEventListener('gestureend', stop, { passive: false });

    // Prevent double-tap zoom
    let lastTouchEnd = 0;
    const onTouchEnd = (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 350) {
        try { e.preventDefault(); } catch {}
      }
      lastTouchEnd = now;
    };
    document.addEventListener('touchend', onTouchEnd, { passive: false });

    return () => {
      document.removeEventListener('gesturestart', stop);
      document.removeEventListener('gesturechange', stop);
      document.removeEventListener('gestureend', stop);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, []);
  return null;
}

