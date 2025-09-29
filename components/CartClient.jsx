'use client';

import { useEffect, useMemo, useState } from 'react';

const SHOP_DOMAIN = process.env.NEXT_PUBLIC_SHOPIFY_DOMAIN;

function readCart() {
  try { return JSON.parse(localStorage.getItem('km_cart') || '[]'); }
  catch { return []; }
}
function writeCart(lines) {
  localStorage.setItem('km_cart', JSON.stringify(lines));
  window.dispatchEvent(new Event('km_cart_updated'));
}
function toMoney(p) {
  if (!p) return '';
  const val = Number(p.amount || 0);
  const cur = p.currencyCode || 'EUR';
  try { return new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur }).format(val); }
  catch { return `${val.toFixed(2)} ${cur}`; }
}

export default function CartClient() {
  const [lines, setLines] = useState([]);       // [{id, qty}]
  const [variants, setVariants] = useState({}); // id -> variant

  useEffect(() => {
    const l = readCart();
    setLines(l);
    const ids = l.map(x => x.id);
    if (ids.length) {
      fetch('/api/variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
        .then(r => r.json())
        .then(({ variants }) => {
          const map = {};
          for (const v of variants) map[v.id] = v;
          setVariants(map);
        })
        .catch(() => {});
    }
  }, []);

  const items = useMemo(
    () => lines.map(l => ({ ...l, v: variants[l.id] })).filter(x => !!x.v),
    [lines, variants]
  );

  const total = useMemo(
    () => items.reduce((sum, it) => sum + (Number(it.v.price?.amount || 0) * (it.qty || 1)), 0),
    [items]
  );
  const currency = items[0]?.v?.price?.currencyCode || 'EUR';

  function setQty(id, q) {
    const next = lines.map(l => (l.id === id ? { ...l, qty: Math.max(1, q) } : l));
    setLines(next); writeCart(next);
  }
  function remove(id) {
    const next = lines.filter(l => l.id !== id);
    setLines(next); writeCart(next);
  }
  function checkout() {
    if (!items.length) return;
    const parts = items.map(it => `${it.v.id.match(/ProductVariant\/(\d+)/)[1]}:${it.qty}`);
    window.location.href = `https://${SHOP_DOMAIN}/cart/${parts.join(',')}`;
  }

  return (
    <div className="cart-page">
      <div className="container" style={{ maxWidth: 600, paddingTop: 80, paddingBottom: 80 }}>
        
        <h1 style={{ display: 'none' }} className="cart-title">Warenkorb</h1>

        {!items.length ? (
          <p style={{ color: '#fff' }}>Dein Warenkorb ist leer.</p>
        ) : (
          <>
            <ul className="cart-list">
              {items.map(({ id, qty, v }) => (
                <li key={id} className="cart-item">
                  <img className="cart-img" src={v.product.image || '/placeholder.png'} alt={v.product.title} />
                  <div className="cart-main">
                    <div className="cart-lineTitle">{v.product.title}</div>
                    <div className="cart-variant">{v.title}</div>

                    <div className="cart-controls">
                      <div className="qty">
                        <button onClick={() => setQty(id, qty - 1)}>-</button>
                        <input
                          type="number"
                          min={1}
                          value={qty}
                          onChange={e => setQty(id, Number(e.target.value || 1))}
                        />
                        <button onClick={() => setQty(id, qty + 1)}>+</button>
                      </div>
                      <div className="line-price">
                        {toMoney({ amount: (Number(v.price.amount) * qty), currencyCode: v.price.currencyCode })}
                      </div>
                    </div>

                    <button className="remove" onClick={() => remove(id)}>Entfernen</button>
                  </div>
                </li>
              ))}
            </ul>

            <div className="cart-summary">
              <div>Zwischensumme</div>
              <div className="sum">{toMoney({ amount: total, currencyCode: currency })}</div>
            </div>

            <div className="cart-actions">
              <button className="btn-aqua btn-buy" onClick={checkout}>Zur Kasse</button>
              
            </div>
          </>
        )}
      </div>
    </div>
  );
}
