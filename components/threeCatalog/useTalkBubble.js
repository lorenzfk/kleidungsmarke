'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { getEngine } from '@/lib/three-catalog/engine';
import { readIdleText } from '@/components/threeCatalog/text';
import { playSound } from '@/lib/sound';

export default function useTalkBubble({ selectedId, section, copy = {} }) {
  const [bubble, setBubble] = useState({
    text: '',
    x: 0,
    y: 0,
    visible: false,
    clamped: false,
    hiddenByScroll: false,
    hiddenByClick: false,
    soundOverride: null,
  });
  const selectedRef = useRef(selectedId);
  const prevVisibleRef = useRef(false);
  const prevTextRef = useRef('');
  const { greeting = '', horseClickMessage = '' } = copy;

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  // Event bridge (km_say_set / km_say_clear)
  useEffect(() => {
    const set = (text, options = {}) => {
      if (selectedRef.current) return; // ignore incoming messages while a product is selected
      const eng = getEngine();
      const shouldTalk = options.playTalk !== false;
      if (eng && shouldTalk) eng.playTalkOnce();
      const sound = options.sound;
      setBubble((prev) => ({
        ...prev,
        text,
        hiddenByClick: false,
        visible: !prev.hiddenByScroll && !!text,
        soundOverride: sound || null,
      }));
      if (sound) playSound(sound);
    };
    const clear = () => setBubble((prev) => ({ ...prev, visible: false, text: '', soundOverride: null, hiddenByClick: false }));

    const onSaySet = (e) => set(e.detail?.text || '', e.detail?.options || {});
    const onSayClear = () => clear();

    window.addEventListener('km_say_set', onSaySet);
    window.addEventListener('km_say_clear', onSayClear);
    window.kmSaySet = (text, options) => window.dispatchEvent(new CustomEvent('km_say_set', { detail: { text, options } }));
    window.kmSayClear = () => window.dispatchEvent(new Event('km_say_clear'));

    return () => {
      window.removeEventListener('km_say_set', onSaySet);
      window.removeEventListener('km_say_clear', onSayClear);
      try {
        delete window.kmSaySet;
        delete window.kmSayClear;
      } catch {}
    };
  }, []);

  // Anchor bubble to character head-top
  useEffect(() => {
    let raf;
    const tick = () => {
      const eng = getEngine();
      if (eng && eng.characterNode && eng.camera && eng.renderer) {
        const box = new THREE.Box3().setFromObject(eng.characterNode);
        const top = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
        eng.characterNode.localToWorld(top);
        const v = top.clone().project(eng.camera);
        const el = eng.renderer.domElement;
        const w = el?.clientWidth || window.innerWidth || 1;
        const h = el?.clientHeight || window.innerHeight || 1;
        let x = (v.x * 0.5 + 0.5) * w;
        const cappedY = Math.max(100, (-v.y * 0.5 + 0.5) * h - 8);
        let clamped = false;
        const edgeGuard = Math.min(w * 0.4, 220);
        if (x < edgeGuard) { x = w * 0.5; clamped = true; }
        else if (x > w - edgeGuard) { x = w * 0.5; clamped = true; }
        x = Math.max(10, Math.min(w - 10, x));
        const ok = v.z > -1 && v.z < 1;
        if (ok) setBubble((prev) => ({ ...prev, x, y: cappedY, clamped }));
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  // Idle chatter when nothing selected
  useEffect(() => {
    if (selectedId || section) return;
    const idle = greeting || readIdleText();
    if (idle) window.kmSaySet?.(idle, { playTalk: false });
  }, [selectedId, section, greeting]);

  useEffect(() => {
    if (!horseClickMessage) return;
    const onClick = () => {
      if (selectedRef.current) return;
      window.kmSaySet?.(horseClickMessage, { playTalk: true, sound: 'talking' });
    };
    window.addEventListener('km_character_click', onClick);
    return () => window.removeEventListener('km_character_click', onClick);
  }, [horseClickMessage]);

  const popBubble = useCallback(() => {
    let popped = false;
    setBubble((prev) => {
      if (!prev.visible) return prev;
      popped = true;
      return { ...prev, visible: false, hiddenByClick: true, soundOverride: 'bubble-pop' };
    });
    if (popped) playSound('bubble-pop');
  }, []);

  // Hide bubble whenever a product is selected
  useEffect(() => {
    if (!selectedId) return;
    window.kmSayClear?.();
    setBubble((prev) => ({ ...prev, text: '', visible: false, soundOverride: null, hiddenByClick: false }));
  }, [selectedId]);

  useEffect(() => {
    const textChanged = bubble.text && bubble.text !== prevTextRef.current;
    if (bubble.visible && !bubble.soundOverride && textChanged) {
      playSound('bubble');
      prevTextRef.current = bubble.text;
    }
    if (!bubble.text) prevTextRef.current = '';
    prevVisibleRef.current = bubble.visible;
  }, [bubble.visible, bubble.text, bubble.soundOverride]);

  useEffect(() => {
    const onScrolled = (e) => {
      const scrolled = !!e.detail?.scrolled;
      setBubble((prev) => {
        const shouldBeVisible = !scrolled && !prev.hiddenByClick && !!prev.text;
        if (prev.hiddenByScroll === scrolled && prev.visible === shouldBeVisible) return prev;
        return { ...prev, hiddenByScroll: scrolled, visible: shouldBeVisible };
      });
    };
    window.addEventListener('km_bubble_scrolled', onScrolled);
    const current = typeof window !== 'undefined' ? window.__KM_BUBBLE_SCROLLED__ : undefined;
    if (typeof current === 'boolean') {
      setBubble((prev) => {
        const shouldBeVisible = !current && !prev.hiddenByClick && !!prev.text;
        if (prev.hiddenByScroll === current && prev.visible === shouldBeVisible) return prev;
        return { ...prev, hiddenByScroll: current, visible: shouldBeVisible };
      });
    }
    return () => window.removeEventListener('km_bubble_scrolled', onScrolled);
  }, []);

  return useMemo(() => ({ ...bubble, pop: popBubble }), [bubble, popBubble]);
}
