'use client';

import { useEffect } from 'react';

import { BG_URL } from '@/lib/three-catalog/constants';
import { getEngine } from '@/lib/three-catalog/engine';

export default function useThreeEngineSetup({ containerRef, contentRef, gridRef, items }) {
  // Engine init + background
  useEffect(() => {
    const eng = getEngine();
    if (!eng || !containerRef?.current) return;

    eng.init(containerRef.current);
    if (contentRef?.current) eng.attachScroll(contentRef.current);
    if (!eng.bgLoaded) eng.loadBackgroundOnce(BG_URL);
    else window.dispatchEvent(new CustomEvent('km_loading_progress', { detail: { phase: 'done', loaded: 1, total: 1 } }));
  }, [containerRef, contentRef]);

  // Attach grid whenever available
  useEffect(() => {
    const eng = getEngine();
    if (!eng) return;
    const node = gridRef?.current;
    if (node) eng.attachGrid(node);
  }, [gridRef]);

  // Load products
  useEffect(() => {
    const eng = getEngine();
    if (!eng) return;
    let cancelled = false;

    (async () => {
      await eng.loadProducts(items || []);
      if (!cancelled) {
        const node = gridRef?.current;
        if (node) eng.attachGrid(node);
        eng.relayoutEntries();
      }
    })();

    return () => { cancelled = true; };
  }, [items, gridRef]);

  // Periodic robustness resize
  useEffect(() => {
    const eng = getEngine();
    if (!eng) return;
    const interval = setInterval(() => { eng._onResize(); }, 10);
    return () => clearInterval(interval);
  }, []);

  // pageshow relayout helper
  useEffect(() => {
    const eng = getEngine();
    if (!eng) return;
    const checkAndRelayout = () => { eng.queueRelayout?.(); };
    const onPageShow = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(checkAndRelayout);
        setTimeout(checkAndRelayout, 60);
        setTimeout(checkAndRelayout, 180);
      });
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // Mobile 100vh fix
  useEffect(() => {
    const eng = getEngine();
    if (!eng) return;
    let raf = 0;
    const setVh = () => {
      const vh = (window.visualViewport?.height || window.innerHeight) * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => eng?.queueRelayout?.());
    };
    setVh();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', setVh);
    vv?.addEventListener('scroll', setVh);
    window.addEventListener('resize', setVh);
    window.addEventListener('orientationchange', setVh);
    return () => {
      vv?.removeEventListener('resize', setVh);
      vv?.removeEventListener('scroll', setVh);
      window.removeEventListener('resize', setVh);
      window.removeEventListener('orientationchange', setVh);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Keep 3D in sync with CSS grid size changes
  useEffect(() => {
    const eng = getEngine();
    const node = gridRef?.current;
    if (!eng || !node || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => eng?.queueRelayout?.());
    ro.observe(node);
    return () => ro.disconnect();
  }, [gridRef]);
}
