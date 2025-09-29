// components/TalkBubble.jsx
'use client';
import { useEffect, useRef } from 'react';

export default function TalkBubble({ text, x, y, visible }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // retrigger one-shot animation whenever text becomes visible/changes
    if (visible && text) {
      el.classList.remove('pop');   // reset
      // force reflow so the next add re-triggers the animation
      // eslint-disable-next-line no-unused-expressions
      el.offsetWidth;
      el.classList.add('pop');      // play
    } else {
      el.classList.remove('pop');
    }
  }, [visible, text]);

  return (
    <div
      ref={ref}
      className="talk-bubble-wrap"
      data-visible={visible && !!text ? '1' : '0'}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        transform: 'translate(-90%, 0%)',
        pointerEvents: 'none',
        zIndex:1,          // ensure above the canvas
      }}
      role="status"
      aria-live="polite"
    >
      <div className="talk-bubble">
        <div className="talk-bubble__inner">{text}</div>
      </div>
    </div>
  );
}
