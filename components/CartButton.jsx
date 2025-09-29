'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';

function readCount() {
  try {
    const cart = JSON.parse(localStorage.getItem('km_cart') || '[]');
    return cart.reduce((n, l) => n + (l.qty || 1), 0);
  } catch { return 0; }
}

export default function CartButton() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const update = () => setCount(readCount());
    update();

    const onStorage = (e) => { if (e.key === 'km_cart') update(); };
    const onCustom  = () => update();

    window.addEventListener('storage', onStorage);
    window.addEventListener('km_cart_updated', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('km_cart_updated', onCustom);
    };
  }, []);

  const btn = (
    <button
      className="cart-fab"
      onClick={() => router.push('/cart')}
    >
      <span
        className="cart-badge"
        style={{ opacity: count === 0 ? 0 : 1, transition: 'opacity 0.2s' }}
      >
        {count}
      </span>
    </button>
  );

  // Render above everything, outside page stacking contexts
  return mounted ? createPortal(btn, document.body) : null;
}
