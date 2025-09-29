'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';

export default function MenuContainer() {
  const router = useRouter();
  const pathname = usePathname();

  const [mounted, setMounted] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [open, setOpen] = useState(false);

  // Mount + listen for catalog selection changes
  useEffect(() => {
    setMounted(true);
    const onSel = (e) => setHasSelection(!!e?.detail?.selected);
    window.addEventListener('km_selected_change', onSel);
    return () => window.removeEventListener('km_selected_change', onSel);
  }, []);

  // Body scroll lock while menu open
  useEffect(() => {
    if (!mounted) return;
    const cls = 'lock-scroll';
    if (open) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [open, mounted]);

  // Close on ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const onCloseClick = () => {
    if (pathname === '/') {
      // Clear selected product on the catalog
      window.dispatchEvent(new Event('km_clear_selection'));
    } else {
      if (window.history.length > 1) router.back();
      else router.push('/');
    }
  };

  // Hide close ONLY on landing page when nothing is selected
  const hideClose = pathname === '/' && !hasSelection;

  // Actions in the sheet
  const goShop = () => {
    setOpen(false);
    if (pathname === '/') {
      // optional: also clear selection to reveal grid
      window.dispatchEvent(new Event('km_clear_selection'));
    } else {
      router.push('/');
    }
  };
  const goAbout = () => { setOpen(false); router.push('/about'); };
  const goLegal = () => { setOpen(false); router.push('/legal'); };

  const ui = (
    <>
      {/* Floating buttons (always visible) */}
      <div className={'menu-button-container' + (hideClose ? ' menu-center' : '')}>
        <button
          className={'btn-aqua btn-close' + (hideClose ? ' hide-btn-close' : '')}
          onClick={onCloseClick}
          aria-label={pathname === '/' ? 'Auswahl schließen' : 'Zurück'}
        >
          ↩︎
        </button>

        <button
          className="btn-aqua btn-menu"
          onClick={() => setOpen(true)}
          aria-label="Menü"
        >
          ⌘
        </button>
      </div>

      {/* Slide-up Menu (overlay) */}
      <div className={'km-menu-wrap ' + (open ? 'open' : '')} aria-hidden={!open}>
        <div className="km-menu-backdrop" onClick={() => setOpen(false)} />
        <div className="km-menu-sheet" role="dialog" aria-modal="true">
          <div className="km-menu-handle" />
          <nav className="km-menu-list">
            <button className="btn-aqua km-menu-item" onClick={goShop}>Shop</button>
            <button className="btn-aqua km-menu-item" onClick={goAbout}>About</button>
            <button className="btn-aqua km-menu-item" onClick={goLegal}>Legal BS</button>
            <button className="btn-aqua km-menu-item close" onClick={() => setOpen(false)}>↩︎</button>
          </nav>
        </div>
      </div>
    </>
  );

  return mounted ? createPortal(ui, document.body) : null;
}
