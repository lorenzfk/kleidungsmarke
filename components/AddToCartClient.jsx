'use client';

import { useState } from 'react';
import { variantGidToNumeric } from '@/lib/shopify';

export default function AddToCartClient({ variantId, disabled = false }) {
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  function add() {
    if (!variantId || disabled) return;
    const cart = JSON.parse(localStorage.getItem('km_cart') || '[]');
    const i = cart.findIndex(l => l.id === variantId);
    if (i >= 0) cart[i].qty += qty;
    else cart.push({ id: variantId, qty });
    localStorage.setItem('km_cart', JSON.stringify(cart));
    window.dispatchEvent(new Event('km_cart_updated'));
    setAdded(true);
  }

  function checkout() {
    const domain = process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN;
    const cart = JSON.parse(localStorage.getItem('km_cart') || '[]');
    const parts = cart
      .map(l => {
        const num = variantGidToNumeric(l.id);
        return num ? `${num}:${l.qty}` : null;
      })
      .filter(Boolean);
    if (parts.length) window.location.href = `https://${domain}/cart/${parts.join(',')}`;
  }

  return (
    <div>
      <div className="qty-row" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <label style={{ color: '#fff' }}>Menge</label>
        <input
          type="number"
          min={1}
          value={qty}
          onChange={e => setQty(Math.max(1, Number(e.target.value || 1)))}
          style={{ width: 80, padding: 8, borderRadius: 8 }}
          disabled={disabled}
        />
      </div>
        <div className='btn-row'>
            <button className="btn-aqua btn-buy" onClick={add} disabled={disabled || !variantId}>
        {disabled ? 'Ausverkauft' : 'In den Warenkorb'}
      </button>
      {' '}
      <button className="btn-aqua btn-menu" onClick={checkout}>Zur Kasse</button>

     </div>
       {added && (
        <div style={{ marginTop: 12, color: '#fff', fontStyle: 'Italic' }}>
          Hinzugefügt! Öffne den Warenkorb oben rechts oder gehe direkt zur Kasse.
        </div>
      )}
    </div>
  );
}
