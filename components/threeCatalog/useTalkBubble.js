'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

import { getEngine } from '@/lib/three-catalog/engine';
import { readIdleText } from '@/components/threeCatalog/text';
import { playSound } from '@/lib/sound';

export default function useTalkBubble({ selectedId, section }) {
  const [bubble, setBubble] = useState({ text: '', x: 0, y: 0, visible: false });
  const selectedRef = useRef(selectedId);
  const prevVisibleRef = useRef(false);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  // Event bridge (km_say_set / km_say_clear)
  useEffect(() => {
    const set = (text) => {
      if (selectedRef.current) return; // ignore incoming messages while a product is selected
      const eng = getEngine();
      if (eng) eng.playTalkOnce();
      setBubble((prev) => ({ ...prev, text, visible: !!text }));
    };
    const clear = () => setBubble((prev) => ({ ...prev, visible: false, text: '' }));

    const onSaySet = (e) => set(e.detail?.text || '');
    const onSayClear = () => clear();

    window.addEventListener('km_say_set', onSaySet);
    window.addEventListener('km_say_clear', onSayClear);
    window.kmSaySet = (text) => window.dispatchEvent(new CustomEvent('km_say_set', { detail: { text } }));
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
        const x = (v.x * 0.5 + 0.5) * w;
        const y = (-v.y * 0.5 + 0.5) * h - 8;
        const ok = v.z > -1 && v.z < 1;
        if (ok) setBubble((prev) => ({ ...prev, x, y }));
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  // Idle chatter when nothing selected
  useEffect(() => {
    if (selectedId || section) return;
    const idle = readIdleText();
    if (idle) window.kmSaySet?.(idle);
  }, [selectedId, section]);

  // Hide bubble whenever a product is selected
  useEffect(() => {
    if (!selectedId) return;
    window.kmSayClear?.();
    setBubble((prev) => ({ ...prev, text: '', visible: false }));
  }, [selectedId]);

  useEffect(() => {
    if (bubble.visible && !prevVisibleRef.current) playSound('bubble');
    prevVisibleRef.current = bubble.visible;
  }, [bubble.visible]);

  return bubble;
}
