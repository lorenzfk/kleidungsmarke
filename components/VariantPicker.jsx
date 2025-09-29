'use client';

import { useMemo } from 'react';

// Compute which values are available for each option given current partial selection
function computeAvailability(options, variants, selected) {
  const selMap = new Map(selected.map(o => [o.name, o.value]));
  const avail = {};

  for (const opt of options) {
    avail[opt.name] = new Set();

    // Try every value of this option while keeping other selections
    for (const val of opt.values || []) {
      const hypotSel = new Map(selMap);
      hypotSel.set(opt.name, val);

      const match = variants.some(v => {
        if (!v.availableForSale) return false;
        return v.selectedOptions.every(
          o => (hypotSel.has(o.name) ? hypotSel.get(o.name) === o.value : true)
        );
      });

      if (match) avail[opt.name].add(val);
    }
  }

  return avail; // { OptionName: Set(values) }
}

export default function VariantPicker({ options, variants, selected, onChange }) {
  const avail = useMemo(
    () => computeAvailability(options, variants, selected),
    [options, variants, selected]
  );

  function setValue(optName, value) {
    const next = selected.map(o => (o.name === optName ? { ...o, value } : o));
    onChange(next);
  }

  return (
    <div className="variant-picker">
      {options.map(opt => {
        const sel = selected.find(o => o.name === opt.name)?.value || '';
        const availableValues = avail[opt.name] || new Set();

        return (
          <div key={opt.name} className="option-group">
            <div className="option-label">{opt.name}</div>
            <div className="option-values">
              {(opt.values || []).map(v => {
                const isSelected = v === sel;
                const isAvailable = availableValues.has(v);
                return (
                  <button
                    key={v}
                    type="button"
                    className={`option-value ${isSelected ? 'is-selected' : ''} ${!isAvailable ? 'is-disabled' : ''}`}
                    onClick={() => isAvailable && setValue(opt.name, v)}
                    disabled={!isAvailable}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
