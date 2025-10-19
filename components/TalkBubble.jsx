// components/TalkBubble.jsx
'use client';
import { useEffect, useRef } from 'react';

export default function TalkBubble({ text, x, y, visible, clamped }) {
  const ref = useRef(null);
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

  return (
    <div
      ref={ref}
      className="talk-bubble-wrap"
      data-visible={isVisible ? '1' : '0'}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        transform: clamped ? 'translate(-50%, 0%)' : 'translate(-90%, 0%)',
        opacity: isVisible ? 1 : 0,
        visibility: isVisible ? 'visible' : 'hidden',
        pointerEvents: 'none',
        zIndex:1,          // ensure above the canvas
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
