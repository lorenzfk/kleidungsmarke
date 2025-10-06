// components/threeCatalog/text.js

export function readSectionText(section) {
  if (!section) return '';
  const key = section === 'about' ? 'about' : 'legal';
  try {
    const meta = document.querySelector(`meta[name="km:${key}"]`)?.content?.trim();
    if (meta) return meta;
  } catch {}
  try {
    const win = section === 'about' ? window.__KM_ABOUT__ : window.__KM_LEGAL__;
    if (typeof win === 'string' && win.trim()) return win.trim();
  } catch {}
  if (section === 'about') return 'Wir sind Kleidungsmarke. Lorem ipsum dolor sit amet, consetetur sadipscing elitr. ';
  return 'Rechtliches Gedöns: Lorem ipsum dolor sit amet, consetetur sadipscing elitr.';
}

export function readIdleText() {
  try {
    const meta = document.querySelector('meta[name="km:idle"]')?.content?.trim();
    if (meta) return meta;
  } catch {}
  try {
    const win = typeof window !== 'undefined' ? window.__KM_IDLE__ : '';
    if (typeof win === 'string' && win.trim()) return win.trim();
  } catch {}
  return 'Willkommen im Kleidungsmarke Shop, Fremder!';
}
