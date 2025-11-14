'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'km_store_unlock';

function getTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

export default function StoreClosedOverlay() {
  const [lockUntil, setLockUntil] = useState(null);
  const [lockPassword, setLockPassword] = useState(null);
  const [backgroundUrl, setBackgroundUrl] = useState(null);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [passwordError, setPasswordError] = useState('');
  const [promptOpen, setPromptOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' });
        if (!res.ok) throw new Error('SETTINGS_FETCH_FAILED');
        const json = await res.json();
        if (!active) return;
        setLockUntil(json?.lockUntil || null);
        setLockPassword(json?.lockPassword || null);
        setBackgroundUrl(json?.backgroundUrl || null);
      } catch (err) {
        console.error('[StoreClosedOverlay] Failed to load lock settings', err);
      } finally {
        if (active) setDataLoaded(true);
      }
    };
    load();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(interval);
  }, []);

  const hasPassword = !!(lockPassword && lockPassword.length);
  const signature = hasPassword ? `${lockPassword}__${lockUntil || ''}` : null;

  useEffect(() => {
    if (!signature) {
      setUnlocked(false);
      setPromptOpen(false);
      setPasswordInput('');
      setPasswordError('');
      return;
    }
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      setUnlocked(stored === signature);
    } catch {
      setUnlocked(false);
    }
  }, [signature]);

  useEffect(() => {
    if (!promptOpen) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus?.());
    return () => cancelAnimationFrame(id);
  }, [promptOpen]);

  const lockTimestamp = useMemo(() => getTimestamp(lockUntil), [lockUntil]);
  const lockIsActive = typeof lockTimestamp === 'number' && now < lockTimestamp;
  const showOverlay = dataLoaded && lockIsActive && !(hasPassword && unlocked);

  useEffect(() => {
    if (!showOverlay) return;
    if (typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, [showOverlay]);

  const rememberUnlock = useCallback(() => {
    setUnlocked(true);
    if (signature) {
      try { sessionStorage.setItem(STORAGE_KEY, signature); } catch {}
    }
  }, [signature]);

  const handleOpenPrompt = useCallback(() => {
    if (!hasPassword) return;
    setPromptOpen(true);
    setPasswordInput('');
    setPasswordError('');
  }, [hasPassword]);

  const handlePasswordSubmit = useCallback((event) => {
    event.preventDefault();
    if (!hasPassword) return;
    const normalized = passwordInput.trim();
    if (!normalized) {
      setPasswordError('Bitte Passwort eingeben.');
      return;
    }
    if (normalized === lockPassword) {
      setPasswordError('');
      rememberUnlock();
      setPromptOpen(false);
      setPasswordInput('');
    } else {
      setPasswordError('Falsches Passwort. Bitte erneut versuchen.');
    }
  }, [hasPassword, lockPassword, passwordInput, rememberUnlock]);

  if (!showOverlay) return null;

  const overlayStyle = backgroundUrl ? { '--km-store-closed-bg': `url(${backgroundUrl})` } : undefined;

  return (
    <div
      className="km-store-closed"
      role="dialog"
      aria-live="assertive"
      aria-label="Shop geschlossen"
      style={overlayStyle}
    >
      <div className="km-store-closed-card">
        <img src="/favicon.png" alt="Kleidungsmarke" className="km-store-closed-logo" width={96} height={96} />
        <p className="km-store-closed-text">Der Shop ist aktuell geschlossen.</p>
        <img
          src="/horsecycle.gif"
          alt="Galoppierendes Pferd"
          className="km-store-closed-horse"
          width={220}
          height={220}
        />
        {hasPassword && (
          <div className="km-store-closed-password-area">
            {promptOpen ? (
              <form className="km-store-closed-form" onSubmit={handlePasswordSubmit}>
                <input
                  ref={inputRef}
                  type="password"
                  className="km-store-closed-input"
                  placeholder="Passwort"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  aria-label="Passwort eingeben"
                />
                <button type="submit" className="km-store-closed-password km-store-closed-password--submit">
                  Entsperren
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="km-store-closed-password"
                onClick={handleOpenPrompt}
              >
                Passwort eingeben
              </button>
            )}
            {passwordError && <p className="km-store-closed-error">{passwordError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
