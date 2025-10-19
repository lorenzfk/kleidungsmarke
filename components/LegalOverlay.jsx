// components/LegalOverlay.jsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function LegalOverlay({ message, visible }) {
  const router = useRouter();
  const [mount, setMount] = useState(false);

  useEffect(() => { setMount(true); }, []);

  if (!mount) return null;

  const onCancel = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('section');
      window.history.replaceState({}, '', url);
    } catch {}
    window.dispatchEvent(new CustomEvent('km_section_changed', { detail: { section: null } }));
  };

  const onView = () => {
    router.push('/legal');
  };

  return (
    <div className="legal-overlay" data-visible={visible ? '1' : '0'} aria-hidden={visible ? 'false' : 'true'}>
      <div className="legal-overlay-box">
        <h2>Kleidungsmarke</h2>
        <p>{message}</p>
        <div className="legal-overlay-actions">
          <button type="button" className="chrome-btn box" onClick={onCancel}>schließen</button>
          <button type="button" className="chrome-btn box" onClick={onView}>ansehen</button>
        </div>
      </div>
    </div>
  );
}
