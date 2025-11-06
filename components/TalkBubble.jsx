// components/TalkBubble.jsx
'use client';
import { useEffect, useRef } from 'react';

export default function TalkBubble({ text, x, y, visible, clamped, onPop }) {
  const ref = useRef(null);
  const anchorRef = useRef(clamped ? 0.5 : 0.9);
  const isVisible = visible && !!text;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // retrigger one-shot animation whenever text becomes visible/changes
    if (isVisible) {
      el.classList.remove('pop');   // reset
      // force reflow so the next add re-triggers the animation
      // eslint-disable-next-line no-unused-expressions
      el.offsetWidth;
      el.classList.add('pop');      // play
    } else {
      el.classList.remove('pop');
    }
  }, [isVisible, text]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const margin = 10;
    const width = el.offsetWidth || 0;
    const viewport = typeof window !== 'undefined' ? window.innerWidth || document.body.clientWidth || width : width;
    let anchor = clamped ? 0.5 : 0.9;
    if (width > 0) {
      const desiredLeft = x - width * anchor;
      if (desiredLeft < margin) {
        anchor = Math.max(0, Math.min(1, (x - margin) / width));
      } else if (desiredLeft + width > viewport - margin) {
        anchor = Math.max(0, Math.min(1, (x - (viewport - margin - width)) / width));
      }
    }
    anchorRef.current = anchor;
  }, [x, y, clamped, text, isVisible]);

  return (
    <div
      ref={ref}
      className="talk-bubble-wrap"
      data-visible={isVisible ? '1' : '0'}
      onClick={(event) => {
        if (!isVisible) return;
        event.stopPropagation();
        if (onPop) onPop();
      }}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        transform: `translate(${-anchorRef.current * 100}%, 0%)`,
        opacity: isVisible ? 1 : 0,
        visibility: isVisible ? 'visible' : 'hidden',
        pointerEvents: isVisible ? 'auto' : 'none',
        zIndex: 7,          // ensure above the canvas/content layers
      }}
      role="status"
      aria-live="polite"
      aria-hidden={isVisible ? 'false' : 'true'}
    >
      <div className="talk-bubble">
        <div className="talk-bubble__inner">{text}</div>
      </div>
    </div>
  );
}
