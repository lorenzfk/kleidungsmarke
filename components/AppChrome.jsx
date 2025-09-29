// components/AppChrome.jsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useRef, useCallback } from 'react';

/* ========================= helpers ========================= */
function readCartCount() {
  try {
    const cart = JSON.parse(localStorage.getItem('km_cart') || '[]');
    return cart.reduce((n, l) => n + (l.qty || 1), 0);
  } catch { return 0; }
}

function getLockDebug() {
  if (typeof window !== 'undefined') {
    if (window.__KM_LOCK_DEBUG__ === true) return true;
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get('lock') === '1') return true;
    } catch {}
  }
  return process.env.NEXT_PUBLIC_LOCK_DEBUG === '1';
}
const LOCK_DEBUG = getLockDebug();

/* ================== iOS-style once-per-session overlay ================== */
function LockOverlay({ productTitle }) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const trackRef = useRef(null);
  const knobRef = useRef(null);
  const drag = useRef({ active: false, startX: 0, offset: 0 });

  const [message, setMessage] = useState('Ey wir haben miesen Rabatt!');
  useEffect(() => {
    const meta = document.querySelector('meta[name="km:welcome"]')?.content?.trim();
    const win  = (typeof window !== 'undefined' && window.__KM_WELCOME__) || '';
    let msg = meta || win || 'Ey wir haben miesen Rabatt!';
    const isProduct = pathname.startsWith('/products');
    if (isProduct && productTitle) msg = `Neu: ${productTitle}`;
    setMessage(msg);
  }, [pathname, productTitle]);

  useEffect(() => {
    try {
      if (LOCK_DEBUG) {
        setVisible(true);
        sessionStorage.removeItem('km_lock_seen');
      } else if (!sessionStorage.getItem('km_lock_seen')) {
        setVisible(true);
      }
    } catch {
      if (LOCK_DEBUG) setVisible(true);
    }
  }, [pathname]);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { clearInterval(id); document.body.style.overflow = prev; };
  }, [visible]);

  const unlock = useCallback(() => {
    setVisible(false);
    if (!LOCK_DEBUG) {
      try { sessionStorage.setItem('km_lock_seen', '1'); } catch {}
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    const track = trackRef.current;
    const knob  = knobRef.current;
    if (!track || !knob) return;

    function setX(px) { knob.style.setProperty('--x', `${Math.max(0, px)}px`); }
    function onDown(e) {
      drag.current.active = true;
      const clientX = (e.touches?.[0]?.clientX) ?? e.clientX;
      drag.current.startX = clientX;
      drag.current.offset = parseFloat(getComputedStyle(knob).getPropertyValue('--x')) || 0;
      knob.setPointerCapture?.(e.pointerId || 1);
    }
    function onMove(e) {
      if (!drag.current.active) return;
      const clientX = (e.touches?.[0]?.clientX) ?? e.clientX;
      const dx = clientX - drag.current.startX + drag.current.offset;
      const max = track.clientWidth - knob.clientWidth;
      setX(Math.min(max, Math.max(0, dx)));
    }
    function onUp() {
      if (!drag.current.active) return;
      drag.current.active = false;
      const max = track.clientWidth - knob.clientWidth;
      const x = parseFloat(getComputedStyle(knob).getPropertyValue('--x')) || 0;
      const progress = x / Math.max(1, max);
      if (progress > 0.85) {
        knob.style.transition = 'transform .18s ease';
        setX(max);
        setTimeout(unlock, 150);
      } else {
        knob.style.transition = 'transform .25s ease';
        setX(0);
      }
      setTimeout(() => { knob.style.transition = ''; }, 260);
    }

    const opts = { passive: true };
    knob.addEventListener('pointerdown', onDown, opts);
    window.addEventListener('pointermove', onMove, opts);
    window.addEventListener('pointerup', onUp, opts);
    knob.addEventListener('touchstart', onDown, opts);
    window.addEventListener('touchmove', onMove, opts);
    window.addEventListener('touchend', onUp, opts);
    const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') unlock(); };
    knob.addEventListener('keydown', onKey);

    setX(0);
    return () => {
      knob.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      knob.removeEventListener('touchstart', onDown);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      knob.removeEventListener('keydown', onKey);
    };
  }, [visible, unlock]);

  if (!visible) return null;

  const timeStr = new Intl.DateTimeFormat(navigator.language || 'de-DE', {
    hour: '2-digit', minute: '2-digit'
  }).format(now);
  const dateStr = new Intl.DateTimeFormat(navigator.language || 'de-DE', {
    weekday: 'long', day: 'numeric', month: 'long'
  }).format(now);

  return (
    <div className="km-lock" role="dialog" aria-modal="true" aria-label="Willkommen">
      <div className="km-lock-bg" />
      <div className="km-lock-clock" style={{ fontSize:'2rem' }}>
        <div className="km-lock-time">KLEIDUNGSMARKE.COM</div>
        <div className="km-lock-date">{dateStr}</div>
      </div>

      <div className="km-lock-notif" aria-live="polite">
        <div className="km-lock-notif-left" aria-hidden="true">
          <div className="km-lock-imsg-dot" />
        </div>
        <div className="km-lock-notif-body">
          <div className="km-lock-notif-title">Kleidungsmarke</div>
          <div className="km-lock-notif-text">{message}</div>
        </div>
      </div>

      <div className="km-lock-slider" ref={trackRef} aria-label="Zum Entsperren nach rechts schieben">
        <div className="km-lock-slide-text">slide to unlock</div>
        <button className="km-lock-knob" ref={knobRef} aria-label="Entsperren" tabIndex={0}>
          <span className="km-lock-arrow" aria-hidden="true">➜</span>
        </button>
      </div>
    </div>
  );
}

/* ============================== AppChrome ============================== */
export default function AppChrome({ title = 'Shop' }) {
  const pathname = usePathname();
  const router = useRouter();

  const isCatalog = pathname === '/' || pathname === '/shop';
  const isProduct = pathname.startsWith('/products');

  // selection flag (for showing back button)
  const [hasSelection, setHasSelection] = useState(false);

  // track selection changes from catalog
  useEffect(() => {
    const onSel = (e) => {
      const selected = !!(e && e.detail && e.detail.selected);
      setHasSelection(selected);
    };
    window.addEventListener('km_selected_change', onSel);
    return () => window.removeEventListener('km_selected_change', onSel);
  }, []);

  /* ---------- SECTION param (read from URL & custom event) ---------- */
  const [section, setSection] = useState(null); // 'about' | 'legal' | null
  const readSection = useCallback(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const s = sp.get('section');
      setSection(s === 'about' || s === 'legal' ? s : null);
    } catch { setSection(null); }
  }, []);
  useEffect(() => {
    readSection();
    const onPop = () => readSection();
    const onEvt = (e) => {
      const s = e.detail?.section || null;
      setSection(s === 'about' || s === 'legal' ? s : null);
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    window.addEventListener('km_section_changed', onEvt);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
      window.removeEventListener('km_section_changed', onEvt);
    };
  }, [readSection]);

  /* ---------- Back button: deselect on catalog; clear section if set ---------- */
  const handleBack = useCallback(() => {
    if (isCatalog) {
      if (hasSelection) {
        window.dispatchEvent(new Event('km_clear_selection'));
        return;
      }
      if (section) {
        const cur = new URL(window.location.href);
        cur.searchParams.delete('section');
        window.history.pushState({}, '', cur);
        window.dispatchEvent(new CustomEvent('km_section_changed', { detail: { section: null } }));
        return;
      }
      return;
    }
    if (document.referrer && window.history.length > 1) router.back();
    else router.push('/');
  }, [isCatalog, hasSelection, section, router]);

  /* ---------- Titles ---------- */
  const routeTitles = { '/cart': 'Warenkorb', '/games': 'Games' };
  const sectionTitle = section === 'about' ? 'Über Uns' : section === 'legal' ? 'Rechtliches' : null;
  const displayTitle = isCatalog
    ? (sectionTitle || 'Shop')
    : (routeTitles[pathname] || title || 'Shop');

  /* ---------- Cart count ---------- */
  const [cartCount, setCartCount] = useState(0);
  useEffect(() => {
    const update = () => setCartCount(readCartCount());
    update();
    const onStorage = (e) => { if (e.key === 'km_cart') update(); };
    const onCustom  = () => update();
    const onFocus   = () => update();
    window.addEventListener('storage', onStorage);
    window.addEventListener('km_cart_updated', onCustom);
    window.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('km_cart_updated', onCustom);
      window.removeEventListener('visibilitychange', onFocus);
    };
  }, []);
  const cartAria = cartCount > 0 ? `Warenkorb (${cartCount} Artikel)` : 'Warenkorb';

  /* ---------- Bottom bar handlers (set section as URL param or navigate) ---------- */
  const pushSectionParam = useCallback((next) => {
    if (typeof window === 'undefined') return;

    if (isCatalog) {
      // In-place update on catalog
      const cur = new URL(window.location.href);
      if (next) {
        cur.searchParams.set('section', next);
        cur.searchParams.delete('sel');
      } else {
        cur.searchParams.delete('section');
      }
      window.history.pushState({}, '', cur);
      window.dispatchEvent(new CustomEvent('km_section_changed', { detail: { section: next || null } }));
      if (next) window.dispatchEvent(new Event('km_clear_selection'));
    } else {
      // Not on catalog -> navigate to "/" with the param
      const q = next ? `?section=${encodeURIComponent(next)}` : '';
      router.push(`/${q}`);
    }
  }, [isCatalog, router]);

  const goShop  = () => {
    if (isCatalog) {
        pushSectionParam(null);
        handleBack();
    }
    else router.push('/');
  };
  const goAbout = () => pushSectionParam('about');
  const goLegal = () => pushSectionParam('legal');

  const isActive = (key) => {
    if (key === 'shop')  return isCatalog && !section ? 'is-active' : '';
    if (key === 'about') return isCatalog && section === 'about' ? 'is-active' : '';
    if (key === 'legal') return isCatalog && section === 'legal' ? 'is-active' : '';
    if (key === 'games') return pathname === '/games' ? 'is-active' : '';
    return '';
  };

  return (
    <>
      {/* Top leather bar */}
      <div className="chrome-topbar">
        {(!isCatalog || hasSelection || !!section) ? (
          <button className="chrome-btn arrow" onClick={handleBack} aria-label="Zurück">
            <span>zurück</span>
          </button>
        ) : (
          <span />
        )}

        <div className="chrome-title" aria-live="polite">{displayTitle}</div>

        <Link href="/cart" className="chrome-btn box chrome-cart" aria-label={cartAria}>
          <span>Warenkorb</span>
          <span
            className="cart-badge"
            aria-hidden={cartCount === 0}
            style={{ opacity: cartCount === 0 ? 0 : 1, transition: 'opacity .2s' }}
          >
            {cartCount}
          </span>
        </Link>
      </div>

      {/* Bottom leather bar */}
      <nav className="chrome-bottombar" aria-label="Hauptnavigation">
        <button type="button" onClick={goShop}  className={`chrome-tab box ${isActive('shop')}`}>Shop</button>
        <button type="button" onClick={goAbout} className={`chrome-tab box ${isActive('about')}`}>Über Uns</button>
        <button type="button" onClick={goLegal} className={`chrome-tab box ${isActive('legal')}`}>Rechtliches</button>
        {/* <Link href="/games" className={`chrome-tab box ${isActive('games')}`}>Games</Link> */}
      </nav>

      <LockOverlay />
    </>
  );
}
