'use client';

import { useEffect } from 'react';

export default function ViewportHeightFix() {
  useEffect(() => {
    const setVh = () => {
      try {
        const h = (window.visualViewport?.height || window.innerHeight || 0);
        if (!h) return;
        const vh = h * 0.01;
        document.documentElement.style.setProperty('--vh', `${vh}px`);
      } catch {}
    };
    setVh();
    const onResize = () => setVh();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    try { window.visualViewport?.addEventListener('resize', onResize); } catch {}
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      try { window.visualViewport?.removeEventListener('resize', onResize); } catch {}
    };
  }, []);
  return null;
}

