// components/AppChrome.jsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useRef, useCallback } from 'react';
import { playSound, toggleMute, isMuted as getMutedState, onMuteChange, configureSoundEffects } from '@/lib/sound';

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
    try { if (new URLSearchParams(window.location.search).get('lock') === '1') return true; } catch {}
  }
  return process.env.NEXT_PUBLIC_LOCK_DEBUG === '1';
}
const LOCK_DEBUG = getLockDebug();
const titleCase = (s='') =>
  s.replace(/[-_]+/g,' ')
   .replace(/\s+/g,' ')
   .trim()
   .replace(/\b\p{L}/gu, m => m.toUpperCase());

/* ================== iOS-style once-per-session overlay ================== */
function LockOverlay({ productTitle }) {
  const pathname = usePathname();
  const router = useRouter();

  const [visible, setVisible] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const trackRef = useRef(null);
  const knobRef = useRef(null);
  const drag = useRef({ active: false, startX: 0, offset: 0 });

  const [message, setMessage] = useState('Ey wir haben miesen Rabatt!');
  const [backgroundUrl, setBackgroundUrl] = useState(() => {
    if (typeof window === 'undefined') return '';
    try {
      return sessionStorage.getItem('km_lock_bg') || '';
    } catch {
      return '';
    }
  });

  // CTA parsing state (for @collectionhandle)
  const [ctaHandle, setCtaHandle] = useState(null);
  const [msgPre, setMsgPre] = useState('');
  const [msgPost, setMsgPost] = useState('');

  const showLockscreen = useCallback(() => {
    setVisible(prev => {
      if (!prev) playSound('lock');
      return true;
    });
  }, []);

  // Load welcome text: session cache -> /api/settings -> meta/window fallback
  useEffect(() => {
    let mounted = true;

    const fallback = (() => {
      try {
        const meta = document.querySelector('meta[name="km:welcome"]')?.content?.trim();
        const win  = (typeof window !== 'undefined' && window.__KM_WELCOME__) || '';
        return meta || win || 'Ey wir haben miesen Rabatt!';
      } catch { return 'Ey wir haben miesen Rabatt!'; }
    })();

    try {
      const cached = sessionStorage.getItem('km_welcome_msg');
      if (cached && mounted) setMessage(cached);
      else if (mounted) setMessage(fallback);
    } catch { if (mounted) setMessage(fallback); }

    (async () => {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          const fromShop = (json?.welcome || '').trim();
          if (fromShop && mounted) {
            setMessage(fromShop);
            try { sessionStorage.setItem('km_welcome_msg', fromShop); } catch {}
          }
          const bg = (json?.backgroundUrl || '').trim();
          if (bg && mounted) {
            setBackgroundUrl(bg);
            try { sessionStorage.setItem('km_lock_bg', bg); } catch {}
          }
        }
      } catch { /* keep fallback */ }
    })();

    return () => { mounted = false; };
  }, []);

  // Extract @collectionhandle → split message into pre/CTA/post
  useEffect(() => {
    const m = message || '';
    const re = /@([a-z0-9][a-z0-9-_]*)/i;
    const match = m.match(re);
    if (match) {
      setCtaHandle(match[1]);
      const idx = match.index ?? 0;
      setMsgPre(m.slice(0, idx).trimEnd());
      setMsgPost(m.slice(idx + match[0].length).trimStart());
    } else {
      setCtaHandle(null);
      setMsgPre(m);
      setMsgPost('');
    }
  }, [message]);

  useEffect(() => {
    try {
      if (LOCK_DEBUG) {
        showLockscreen();
        sessionStorage.removeItem('km_lock_seen');
      } else if (!sessionStorage.getItem('km_lock_seen')) {
        showLockscreen();
      }
    } catch {
      if (LOCK_DEBUG) showLockscreen();
    }
  }, [pathname, showLockscreen]);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { clearInterval(id); document.body.style.overflow = prev; };
  }, [visible]);

  const unlock = useCallback(() => {
    playSound('unlock');
    setVisible(false);
    if (!LOCK_DEBUG) {
      try { sessionStorage.setItem('km_lock_seen', '1'); } catch {}
    }
  }, []);

  // Allow external trigger to re-show the lock overlay
  useEffect(() => {
    const show = () => {
      try { sessionStorage.removeItem('km_lock_seen'); } catch {}
      showLockscreen();
    };
    window.addEventListener('km_lock_show', show);
    return () => window.removeEventListener('km_lock_show', show);
  }, [showLockscreen]);

  // CTA click handler (whole notification becomes clickable)
  const openCTA = useCallback((e) => {
    if (!ctaHandle) return;
    e?.preventDefault?.();
    unlock();
    router.push(`/collections/${ctaHandle}`);
  }, [ctaHandle, unlock, router]);

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

  const dateStr = new Intl.DateTimeFormat(navigator.language || 'de-DE', {
    weekday: 'long', day: 'numeric', month: 'long'
  }).format(now);

  return (
    <div className="km-lock" role="dialog" aria-modal="true" aria-label="Willkommen">
      <div
        className="km-lock-bg"
        style={backgroundUrl ? { '--km-lock-img': `url(${backgroundUrl})` } : undefined}
      />
      <div className="km-lock-clock" style={{ fontSize:'2rem' }}>
        <div className="km-lock-time">KLEIDUNGSMARKE.COM</div>
        <div className="km-lock-date">{dateStr}</div>
      </div>

      <div
        className="km-lock-notif"
        aria-live="polite"
        onClick={ctaHandle ? openCTA : undefined}
        onKeyDown={ctaHandle ? (e) => { if (e.key === 'Enter' || e.key === ' ') openCTA(e); } : undefined}
        role={ctaHandle ? 'button' : undefined}
        tabIndex={ctaHandle ? 0 : undefined}
        style={ctaHandle ? { cursor: 'pointer' } : undefined}
      >
        <div className="km-lock-notif-left" aria-hidden="true">
          <div className="km-lock-imsg-dot" />
        </div>
        <div className="km-lock-notif-body">
          <div className="km-lock-notif-title">Kleidungsmarke</div>
          <div className="km-lock-notif-text">
            {msgPre}
            {ctaHandle && (
              <button
                className="km-lock-cta"
                onClick={openCTA}
                aria-label={`Kollektion ${ctaHandle} öffnen`}
                type="button"
              >
                öffnen
              </button>
            )}
            {msgPost ? ` ${msgPost}` : ''}
          </div>
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
  const isCollection = pathname.startsWith('/collections');
  const isProduct = pathname.startsWith('/products');

  const isCollectionsIndex = pathname === '/collections' || pathname === '/collections/';

  useEffect(() => {
    configureSoundEffects({
      cart: '/sounds/cart.mp3',
      unlock: '/sounds/unlock.mp3',
      lock: '/sounds/lock.mp3',
      bubble: '/sounds/bubble.mp3',
    });
  }, []);

  const [muted, setMuted] = useState(false);
  useEffect(() => {
    setMuted(getMutedState());
    const unsubscribe = onMuteChange(setMuted);
    return unsubscribe;
  }, []);
  const toggleSound = useCallback(() => { toggleMute(); }, []);

  // selection flag (only relevant on catalog)
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    const onSel = (e) => setHasSelection(!!(e && e.detail && e.detail.selected));
    window.addEventListener('km_selected_change', onSel);
    return () => window.removeEventListener('km_selected_change', onSel);
  }, []);

  /* ---------- SECTION param ---------- */
  const [section, setSection] = useState(null);
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
    const onEvt = (e) => setSection((e.detail?.section === 'about' || e.detail?.section === 'legal') ? e.detail.section : null);
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    window.addEventListener('km_section_changed', onEvt);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
      window.removeEventListener('km_section_changed', onEvt);
    };
  }, [readSection]);

  /* ---------- Back button behavior ---------- */
  const clearCatalogParams = useCallback(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('sel');
      url.searchParams.delete('section');
      window.history.pushState({}, '', url);
    } catch {}
  }, []);

  const backFallbackTimer = useRef(null);
  const handleBack = useCallback(() => {
    if (isCatalog) {
      // Home: if nothing active, re-show lockscreen; else clear selection/section
      if (!hasSelection && !section) {
        try { sessionStorage.removeItem('km_lock_seen'); } catch {}
        window.dispatchEvent(new Event('km_lock_show'));
        return;
      }
      window.dispatchEvent(new Event('km_clear_selection'));
      clearCatalogParams();
      window.dispatchEvent(new CustomEvent('km_section_changed', { detail: { section: null } }));
      return;
    }

    // Other pages: try history back with fallback
    try {
      const prevHref = window.location.href;
      const onPopOnce = () => {
        if (backFallbackTimer.current) { clearTimeout(backFallbackTimer.current); backFallbackTimer.current = null; }
        window.removeEventListener('popstate', onPopOnce);
      };
      window.addEventListener('popstate', onPopOnce, { once: true });
      router.back();

      backFallbackTimer.current = setTimeout(() => {
        if (window.location.href === prevHref) {
          router.push('/');
        }
        backFallbackTimer.current = null;
        window.removeEventListener('popstate', onPopOnce);
      }, 400);
    } catch {
      router.push('/');
    }
  }, [isCatalog, hasSelection, section, router, clearCatalogParams]);

  // New rules:
  // - On ANY collection route (/collections or /collections/[handle]) -> label "shop", click routes to "/"
  // - Everywhere else -> label "zurück", click handleBack (on home this may show lockscreen)
  const backText = isCollection ? 'shop' : 'zurück';
  const onBackClick = isCollection ? (() => router.push('/')) : handleBack;

  /* ---------- Dynamic title ---------- */
  const routeTitles = { '/cart': 'Warenkorb', '/games': 'Games' };
  const sectionTitle = section === 'about' ? 'Über Uns' : section === 'legal' ? 'Rechtliches' : null;

  // Collection title via DOM
  const [collectionTitle, setCollectionTitle] = useState(null);
  useEffect(() => {
    if (!isCollection) { setCollectionTitle(null); return; }

    const parts = pathname.split('/').filter(Boolean);
    const handle = parts[0] === 'collections' ? parts[1] || null : null;
    const squash = (val) => (typeof val === 'string' ? val.replace(/\s+/g, ' ').trim() : '');

    const readNow = () => {
      const titleEl = document.querySelector('.collection-title');
      const descEl = document.querySelector('.collection-description');
      const titleText = squash(titleEl?.textContent || '');
      const descText = squash(descEl?.textContent || '');

      if (handle === 'special' && descText) {
        setCollectionTitle(descText);
        return;
      }

      if (titleText) {
        setCollectionTitle(titleText);
        return;
      }

      if (handle) {
        setCollectionTitle(titleCase(handle));
        return;
      }

      setCollectionTitle('Kollektion');
    };

    readNow();
    const target = document.querySelector('.collection-page') || document.querySelector('.collection-title') || document.body;
    const obs = new MutationObserver(() => readNow());
    obs.observe(target, { subtree: true, childList: true, characterData: true });
    return () => obs.disconnect();
  }, [isCollection, pathname]);

  // Product title via DOM
  const [productTitle, setProductTitle] = useState(null);
  useEffect(() => {
    if (!isProduct) { setProductTitle(null); return; }
    const readNow = () => {
      const h = document.querySelector('.product-title');
      const text = (h?.textContent || '').trim();
      if (text) setProductTitle(text);
      else {
        const t = (document.title || '').split('–')[0].trim();
        setProductTitle(t || null);
      }
    };
    readNow();
    const obs = new MutationObserver(() => readNow());
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => obs.disconnect();
  }, [isProduct]);

  const displayTitle = isCatalog
    ? (sectionTitle || 'Shop')
    : isCollection
      ? (isCollectionsIndex ? 'Kollektionen' : (collectionTitle || 'Kollektion'))
      : isProduct
        ? (productTitle || 'Produkt')
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

  /* ---------- Bottom bar handlers (section param) ---------- */
  const pushSectionParam = useCallback((next) => {
    if (typeof window === 'undefined') return;

    if (isCatalog) {
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
      const q = next ? `?section=${encodeURIComponent(next)}` : '';
      router.push(`/${q}`);
    }
  }, [isCatalog, router]);

  const goShop  = () => {
    if (isCatalog) {
      pushSectionParam(null);
      window.dispatchEvent(new Event('km_clear_selection'));
      clearCatalogParams();
      window.dispatchEvent(new CustomEvent('km_section_changed', { detail: { section: null } }));
    } else {
      router.push('/');
    }
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
        <div className="chrome-topbar__inner">
          <button className="chrome-btn arrow" onClick={onBackClick} aria-label={backText}>
            <span>{backText}</span>
          </button>

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
      </div>

      {/* Bottom leather bar */}
      <nav className="chrome-bottombar" aria-label="Hauptnavigation">
        <button type="button" onClick={goShop}  className={`chrome-tab box ${isActive('shop')}`}>Shop</button>
        <button style={{display:'none'}} type="button" onClick={goAbout} className={`chrome-tab box ${isActive('about')}`}>Über Uns</button>
        <button type="button" onClick={goLegal} className={`chrome-tab box ${isActive('legal')}`}>Rechtliches</button>
        <button
          type="button"
          onClick={toggleSound}
          className={`chrome-tab sound ${muted ? 'is-muted' : ''}`}
          aria-pressed={muted ? 'true' : 'false'}
        >
          <span className="chrome-sound-label">Ton</span>
          <span className="chrome-sound-toggle" aria-hidden="true" />
        </button>
      </nav>

      <LockOverlay productTitle={productTitle || undefined} />
    </>
  );
}
