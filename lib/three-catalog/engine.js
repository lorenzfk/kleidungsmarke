'use client';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

import {
  DEFAULT_CAM_POS,
  SECTION_CAM_POS,
  OBJECT_PLANE_Z,
  BG_Z,
  BG_URL,
  ENV_URL,
  BARTOP_EXTRA,
} from '@/lib/three-catalog/constants';
import { applyDefaultRim } from '@/lib/three-catalog/rim';

class KMEngine {
  constructor() {
    this.initialized = false;
    this.container = null;

    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.clock = null;

    this.manager = new THREE.LoadingManager();
    this.manager.onStart    = (url, loaded, total) => this._emitProgress('start', loaded, total, url);
    this.manager.onProgress = (url, loaded, total) => this._emitProgress('progress', loaded, total, url);
    this.manager.onLoad     = ()                          => this._emitProgress('done', 1, 1, null);
    this.manager.onError    = (url)                       => this._emitProgress('error', 0, 0, url);

    this.bgContainer = null;
    this.bgRoot = null;
    this.bgMixer = null;
    this.bgLoaded = false;
    this.bgUrl = null;
    this._bgLoadToken = 0;
    this._bgInflight = null;

    this.barTop = null;
    this.shelfProto = null;
    this.shelfInstances = [];

    this.characterNode = null;      // original node from GLB
    this.characterWrapper = null;   // neutral wrapper we move (never bones)
    this._charLocalBottomY = null;  // cached bind-pose bottom (wrapper-local)
    this.actions = { idle: null, talk: null };
    this._talking = false;

    this.group = null;
    this.entries = new Map();
    this.loadingVersion = 0;

    this.contentEl = null;
    this.gridEl = null;

    this.selectedId = null;

    this.followScroll = true;
    this.prevScrollTop = 0;

    this.camTargetY = null;
    this.camTarget = null;
    this.cam3DMode = false;
    this._returning = false;

    this.SELECT_ANCHOR_FRAC = -0.5;
    this.SELECT_Y_OFFSET = 0.12;

    this.grid = { cols: 3, spacingX: 1, spacingY: 1, originX: 0, originY: -0.3, targetSize: 0.42 };

    // ⛳ grid-Y lock (no Y re-anchoring while selected/section)
    this.lockGridY = false;

    this._loop = this._loop.bind(this);
    this._onResize = this._onResize.bind(this);
  }

  setLockGridY(lock) {
    this.lockGridY = !!lock;
    if (!this.lockGridY) this.queueRelayout?.();
  }

  _emitProgress(phase, loaded, total, url) {
    try {
      window.dispatchEvent(new CustomEvent('km_loading_progress', {
        detail: { phase, loaded, total, url, ts: performance.now() }
      }));
    } catch {}
  }

  playTalkOnce() {
    if (!this.bgMixer || !this.actions || !this.actions.talk) return;
    const talk = this.actions.talk, idle = this.actions.idle;
    this._talking = true;
    idle?.fadeOut(0.1);
    talk.reset(); talk.setLoop(THREE.LoopOnce, 1); talk.clampWhenFinished = true; talk.play();
    if (this._talkCleanup) clearTimeout(this._talkCleanup);
    const dur = (talk.getClip?.().duration ?? 0.8) * 1000;
    this._talkCleanup = setTimeout(() => {
      this._talking = false;
      idle?.reset().fadeIn(0.15).play();
    }, Math.max(200, dur + 40));
  }

  _getCanvasSize() {
    const el = this.renderer?.domElement;
    let w = el?.clientWidth ?? window.innerWidth ?? 1;
    let h = el?.clientHeight ?? window.innerHeight ?? 1;
    if (!Number.isFinite(w) || w <= 0) w = window.innerWidth || 1;
    if (!Number.isFinite(h) || h <= 0) h = window.innerHeight || 1;
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }
  _isViewportStable() {
    const { w, h } = this._getCanvasSize();
    return w > 10 && h > 10 && (document.visibilityState !== 'hidden');
  }
  _safe(v, fb) { return Number.isFinite(v) ? v : fb; }

  _distAtZ(zWorld) { return Math.abs(this.camera.position.z - zWorld); }
  _distObj() { return this._distAtZ(OBJECT_PLANE_Z); }

  _unitsPerPxAtDepth(depth) {
    const { h } = this._getCanvasSize();
    const vFOV = THREE.MathUtils.degToRad(this.camera.fov);
    const viewH = 2 * Math.tan(vFOV / 2) * depth;
    return this._safe(viewH / Math.max(1, h), 0.001);
  }
  _wuppY() { return this._unitsPerPxAtDepth(this._distObj()); }
  _wuppX() {
    const d = this._distObj();
    const vFOV = THREE.MathUtils.degToRad(this.camera.fov);
    const viewH = 2 * Math.tan(vFOV / 2) * d;
    const viewW = viewH * this.camera.aspect;
    const { w } = this._getCanvasSize();
    return this._safe(viewW / Math.max(1, w), 0.001);
  }

  _worldYAtObjFromScreenY(screenY) {
    const { h } = this._getCanvasSize();
    const dyPx = screenY - h * 0.5;
    const wuppY = this._wuppY();
    return this.camera.position.y - dyPx * wuppY;
  }

  _viewportWidthAtDepth(depth) {
    const vFOV = THREE.MathUtils.degToRad(this.camera.fov);
    const viewH = 2 * Math.tan(vFOV / 2) * depth;
    const viewW = viewH * this.camera.aspect;
    return this._safe(viewW, 1);
  }
  _mapYFromObjPlaneToZ(yObj, zTarget) {
    const cy = this.camera.position.y;
    const r = this._safe(this._distAtZ(zTarget) / this._distObj(), 1);
    return this._safe(cy + (yObj - cy) * r, cy);
  }

  _currentWorldWidth(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    return Math.max(size.x, 1e-6);
  }
  _fitWidthTo(obj, targetW) {
    if (!obj) return;
    const cw = this._currentWorldWidth(obj);
    if (!Number.isFinite(cw) || cw <= 0) return;
    obj.scale.x *= (targetW / cw);
  }
  _fitWidthToViewport(obj) {
    if (!obj) return;
    const wp = new THREE.Vector3(); obj.getWorldPosition(wp);
    const depth = this._distAtZ(wp.z);
    const targetW = this._viewportWidthAtDepth(depth);
    this._fitWidthTo(obj, targetW);
  }
  _fitLargerThanViewport(obj, extraFrac = BARTOP_EXTRA) {
    if (!obj) return;
    const wp = new THREE.Vector3(); obj.getWorldPosition(wp);
    const depth = this._distAtZ(wp.z);
    const base = this._viewportWidthAtDepth(depth);
    const targetW = base * (1 + Math.max(0, extraFrac));
    this._fitWidthTo(obj, targetW);
  }
  _fitHeightTo(obj, targetH) {
    if (!obj) return;
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    const ch = Math.max(size.y, 1e-6);
    obj.scale.y *= (targetH / ch);
  }
  _setBottomWorldY(obj, yTarget) {
    if (!obj || !obj.parent) return;
    const box = new THREE.Box3().setFromObject(obj);
    const bottom = box.min.y;
    const deltaY = yTarget - bottom;
    const pos = new THREE.Vector3();
    obj.getWorldPosition(pos);
    pos.y += deltaY;
    obj.parent.worldToLocal(pos);
    obj.position.copy(pos);
  }

  _findByNameCI(root, name) {
    const needle = String(name).toLowerCase();
    let found = null;
    root.traverse(n => { if (!found && (n.name || '').toLowerCase() === needle) found = n; });
    return found;
  }
  ensureBgRefs() {
    const root = this.bgRoot;
    if (!root) return;
    if (!this.barTop || !this.barTop.parent)     this.barTop = this._findByNameCI(root, 'barTop') || null;
    if (!this.shelfProto || !this.shelfProto.parent) this.shelfProto = this._findByNameCI(root, 'shelf') || null;
    if (!this.characterNode || !this.characterNode.parent) this.characterNode = this._findByNameCI(root, 'character') || null;
  }

  /* ==== shelves & barTop layout ==== */
  _layoutBarTop() {
    this.ensureBgRefs();
    if (!this.barTop || !this._isViewportStable()) return;
    if (this._hasSkinnedDescendants(this.barTop)) return;
    this._fitLargerThanViewport(this.barTop, BARTOP_EXTRA);
    const yTopObj = this.grid.originY + this.grid.spacingY * 0.5; // "top of CSS grid" (top shelf line)
    const wp = new THREE.Vector3(); this.barTop.getWorldPosition(wp);
    const yTopAtBar = this._mapYFromObjPlaneToZ(yTopObj, wp.z);
    this._setBottomWorldY(this.barTop, yTopAtBar);
  }
  _hasSkinnedDescendants(obj) { let f=false; obj?.traverse(n=>{ if(n.isSkinnedMesh) f=true; }); return f; }
  _layoutShelfForRow(shelfObj, rowIndex) {
    if (!shelfObj || !this._isViewportStable()) return;
    if (this._hasSkinnedDescendants(shelfObj)) return;
    this._fitWidthToViewport(shelfObj);
    const wp = new THREE.Vector3(); shelfObj.getWorldPosition(wp);
    const depthShelf = this._distAtZ(wp.z);
    const targetRowHeightWorld = this.grid.spacingY * (depthShelf / Math.max(1e-6, this._distObj()));
    this._fitHeightTo(shelfObj, targetRowHeightWorld);
    const rowCenterObj = -rowIndex * this.grid.spacingY + this.grid.originY;
    const rowBottomObj = rowCenterObj - this.grid.spacingY * 0.5;
    const rowBottomAtShelf = this._mapYFromObjPlaneToZ(rowBottomObj, wp.z);
    this._setBottomWorldY(shelfObj, rowBottomAtShelf);
  }
  _ensureShelfInstances(rowCount) {
    if (!this.shelfProto || !this.shelfProto.parent) return;
    this.shelfInstances = (this.shelfInstances || []).filter(n => n && n.parent);
    if (this.shelfInstances.length === 0 || this.shelfInstances[0] !== this.shelfProto) this.shelfInstances = [this.shelfProto];
    while (this.shelfInstances.length < rowCount) { const clone = this.shelfProto.clone(true); this.shelfProto.parent.add(clone); this.shelfInstances.push(clone); }
    while (this.shelfInstances.length > rowCount) {
      const inst = this.shelfInstances.pop();
      if (!inst || inst === this.shelfProto) { if (inst) this.shelfInstances.unshift(inst); break; }
      inst.parent && inst.parent.remove(inst);
      inst.traverse(n => {
        if (n.isMesh) {
          n.geometry?.dispose?.();
          const mats = Array.isArray(n.material) ? n.material : [n.material];
          mats.forEach(m => m?.dispose?.());
        }
      });
    }
  }
  _updateShelvesLayout() {
    this.ensureBgRefs();
    if (!this.shelfProto || !this._isViewportStable()) return;
    const totalItems = Math.max(1, this.entries.size || 1);
    const rows = Math.max(1, Math.ceil(totalItems / Math.max(1, this.grid.cols))) + 1;
    this._ensureShelfInstances(rows);
    for (let r = 0; r < rows; r++) this._layoutShelfForRow(this.shelfInstances[r], r);
  }

  /* ==== init & loaders ==== */
  init(container) {
    if (this.initialized && this.container === container) return;

    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    const DPR = window.devicePixelRatio || 1;
    renderer.setPixelRatio(DPR);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    renderer.domElement.classList.add('webgl');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 1000);
    camera.position.set(DEFAULT_CAM_POS.x, DEFAULT_CAM_POS.y, DEFAULT_CAM_POS.z);

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(3, 2, 5); scene.add(dir);

    if (!this.bgContainer) { this.bgContainer = new THREE.Group(); this.bgContainer.name = 'KM_BG_CONTAINER'; }
    scene.add(this.bgContainer);

    const group = new THREE.Group(); scene.add(group);

    const tloader = new THREE.TextureLoader(this.manager);
    tloader.load('/galaxybg0.png', (texture) => { this.scene.background = texture; });

    const gltf  = new GLTFLoader(this.manager);
    const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    gltf.setDRACOLoader(draco);
    const ktx2  = new KTX2Loader(this.manager)
      .setTranscoderPath('https://unpkg.com/three@0.160.0/examples/jsm/libs/basis/')
      .detectSupport(renderer);
    gltf.setKTX2Loader(ktx2);
    gltf.setCrossOrigin('anonymous');

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.group = group;
    this.gltf = gltf;

    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(this._loop);

    window.addEventListener('resize', this._onResize, { passive: true });

    const canvas = renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      try { renderer.setAnimationLoop(null); } catch {}
    }, { passive: false });
    canvas.addEventListener('webglcontextrestored', () => {
      try { renderer.setAnimationLoop(this._loop); } catch {}
      this._afterStable(() => {
        if (!this.bgContainer || this.bgContainer.children.length === 0) {
          this._clearBackground();
          this.bgLoaded = false;
          this.loadBackgroundOnce(this.bgUrl || BG_URL);
        }
        this.queueRelayout?.();
      });
    });

    this.initialized = true;
    this.syncCameraToScroll();
  }

  attachScroll(contentEl) {
    if (this.contentEl === contentEl) return;
    if (this._cleanupScroll) this._cleanupScroll();
    this.contentEl = contentEl;
    const onScroll = () => this.syncCameraToScroll();
    contentEl.addEventListener('scroll', onScroll, { passive: true });
    this._cleanupScroll = () => contentEl.removeEventListener('scroll', onScroll);
    this.syncCameraToScroll();
  }

  attachGrid(gridEl) {
    if (this.gridEl === gridEl && this._gridAttachedOnce) {
      this.syncGridFromDOM(); this.relayoutEntries(); this._updateShelvesLayout(); this._layoutBarTop();
      return;
    }
    this.gridEl = gridEl;
    this._gridAttachedOnce = true;
    this.syncGridFromDOM();
    this.relayoutEntries();

    if (this._cleanupGridImgs) this._cleanupGridImgs();
    const imgs = this.gridEl?.querySelectorAll('img') || [];
    const handlers = [];
    imgs.forEach(img => {
      const h = () => { this.syncGridFromDOM(); this.relayoutEntries(); this._updateShelvesLayout(); this._layoutBarTop(); };
      img.addEventListener('load', h, { once: true });
      handlers.push([img, h]);
    });
    this._cleanupGridImgs = () => handlers.forEach(([img, h]) => img.removeEventListener('load', h));
  }

  _afterStable(fn) {
    const tryRun = (attempt = 0) => {
      if (this._isViewportStable()) { fn(); return; }
      if (attempt > 14) { fn(); return; }
      requestAnimationFrame(() => tryRun(attempt + 1));
    };
    tryRun(0);
  }
  _normalize(root, target) {
    const b = new THREE.Box3().setFromObject(root);
    const s = b.getSize(new THREE.Vector3());
    const scale = target / (Math.max(s.x, s.y, s.z) || 1);
    root.scale.setScalar(scale);
    const c = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
    root.position.sub(c);
  }
  _clearBackground() {
    if (!this.bgContainer) return;
    const toDispose = [];
    this.bgContainer.traverse(n => { if (n.isMesh) toDispose.push(n); });
    this.bgContainer.clear();
    toDispose.forEach(n => {
      try { n.geometry?.dispose?.(); const mats = Array.isArray(n.material) ? n.material : [n.material]; mats.forEach(m => m?.dispose?.()); } catch {}
    });
    this.bgRoot = null; this.barTop = null; this.shelfProto = null; this.shelfInstances = [];
    this.bgMixer = null; this.characterNode = null; this.actions = { idle: null, talk: null }; this._talking = false;
    this.characterWrapper = null; this._charLocalBottomY = null;
  }

  async loadBackgroundOnce(url) {
    if (!this.initialized) return;

    this.bgUrl = url;

    if (this.bgContainer && this.bgContainer.children.length > 0) {
      this.bgLoaded = true;
      this._emitProgress('done', 1, 1, null);
      return;
    }

    const token = ++this._bgLoadToken;
    const run = async () => {
      const m = await this.gltf.loadAsync(url);
      const src = (m.scene || m.scenes?.[0]);
      const root = src ? cloneSkinned(src) : null;
      if (!root) return;

      this._normalize(root, 3.3);
      root.position.set(0, -0.3, BG_Z + 0.3);
      root.traverse(n => { if (n.isMesh || n.isSkinnedMesh) n.frustumCulled = false; });

      if (token !== this._bgLoadToken) return;

      this._clearBackground();
      this.bgContainer.add(root);
      this.bgRoot = root;
      this.bgLoaded = true;

      this.barTop     = this._findByNameCI(root, 'barTop');
      this.shelfProto = this._findByNameCI(root, 'shelf');
      this.characterNode = this._findByNameCI(root, 'character') || null;

      applyDefaultRim(root);

      // animations
      if (m.animations?.length) {
        const mixer = new THREE.AnimationMixer(root);
        this.bgMixer = mixer;
        const idleClip = m.animations.find(a => /idle|loop/i.test(a.name || '')) || m.animations[0];
        const talkClip = m.animations.find(a => /talk/i.test(a.name || ''));
        if (idleClip) {
          const a = mixer.clipAction(idleClip, root);
          a.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).fadeIn(0.2).play();
          this.actions.idle = a;
        }
        if (talkClip) {
          const t = mixer.clipAction(talkClip, root);
          t.setLoop(THREE.LoopOnce, 1);
          t.clampWhenFinished = true;
          this.actions.talk = t;
          mixer.addEventListener('finished', (e) => {
            if (e.action === this.actions.talk && this.actions.idle) {
              this.actions.idle.reset().fadeIn(0.2).play();
            }
          });
        }
      }

      if (ENV_URL) {
        try {
          const pmrem = new THREE.PMREMGenerator(this.renderer);
          pmrem.compileEquirectangularShader();
          const hdr = await new RGBELoader(this.manager).setDataType(THREE.FloatType).loadAsync(ENV_URL);
          const envTex = pmrem.fromEquirectangular(hdr).texture;
          hdr.dispose(); pmrem.dispose();
          this.scene.environment = envTex;
        } catch {}
      }

      // ensure wrapper + cache bind bottom once character is present
      this._ensureCharacterWrapper();
      this._cacheCharBindBottomY();

      this._afterStable(() => { this._updateShelvesLayout(); this._layoutBarTop(); });
    };

    if (this._bgInflight) {
      try { await this._bgInflight; } catch {}
      if (token !== this._bgLoadToken) return;
    }
    this._bgInflight = run();
    try { await this._bgInflight; } finally {
      if (token === this._bgLoadToken) this._bgInflight = null;
    }
  }

  /* ==== grid sync ==== */
  syncGridFromDOM() {
    if (!this.gridEl || !this.renderer || !this.camera) return;
    if (!this._isViewportStable()) return;

    const figs = Array.from(this.gridEl.querySelectorAll('figure'));
    let cols = 1;
    if (figs.length) {
      const top0 = figs[0].offsetTop;
      cols = figs.filter(f => f.offsetTop === top0).length || 1;
    }
    const w = figs[0] ? (figs[0].clientWidth || figs[0].offsetWidth || 280) : 280;
    const h = figs[0] ? (figs[0].clientHeight || figs[0].offsetHeight || 280) : 280;

    const wuppX = this._wuppX();
    const wuppY = this._wuppY();

    const prevSpacingY = this.grid.spacingY;
    const prevOriginY  = this.grid.originY;

    this.grid.cols = Math.max(1, cols);
    this.grid.spacingX = this._safe(w * wuppX, this.grid.spacingX || 0.5);

    if (!this.lockGridY) this.grid.spacingY = this._safe(h * wuppY, this.grid.spacingY || 0.5);
    else this.grid.spacingY = prevSpacingY;

    const rectGrid = this.gridEl.getBoundingClientRect?.() || { left: 0, width: 0 };
    const { w: vpw } = this._getCanvasSize();
    const gridCenterX = rectGrid.left + rectGrid.width / 2;
    const offsetPx = gridCenterX - vpw / 2;
    this.grid.originX = this._safe(offsetPx * wuppX, 0);

    if (!this.lockGridY) {
      if (figs[0] && this.camera && this.renderer) {
        const r0 = figs[0].getBoundingClientRect?.() || { top: 0, height: 0 };
        const centerY = r0.top + r0.height * 0.5;
        const yObj = this._worldYAtObjFromScreenY(centerY);
        if (Number.isFinite(yObj)) this.grid.originY = yObj;
      }
    } else {
      this.grid.originY = prevOriginY;
    }

    const cellWorldMin = Math.max(0.0001, Math.min(this.grid.spacingX, this.grid.spacingY));
    this.grid.targetSize = cellWorldMin * 0.65;
  }

  async loadProducts(items) {
    if (!this.initialized) return;
    const myVersion = ++this.loadingVersion;

    for (const { root } of this.entries.values()) this.group.remove(root);
    this.entries.clear();

    this.syncGridFromDOM();

    let idx = 0;
    for (const it of items) {
      if (myVersion !== this.loadingVersion) return;
      try {
        if (!it.modelUrl) { idx++; continue; }
        const m = await this.gltf.loadAsync(it.modelUrl);
        if (myVersion !== this.loadingVersion) return;
        const root = (m.scene || m.scenes?.[0]);
        if (!root) { idx++; continue; }

        const node = root.clone(true);
        node.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; n.frustumCulled = false; } });

        const targetSize = it.__special ? this.grid.targetSize * 1.1 : this.grid.targetSize;
        this._normalize(node, targetSize);

        applyDefaultRim(node);

        const pos = this._gridPos(idx);
        node.position.copy(pos);
        const baseQuat = node.quaternion.clone();

        this.group.add(node);
        this.entries.set(it.id, { idx, root: node, baseQuat, pos, targetSize, handle: it.handle });
      } catch (e) { console.error('GLB load error', it.modelUrl, e); }
      idx++;
    }

    this._afterStable(() => { this._updateShelvesLayout(); this._layoutBarTop(); });
  }

  relayoutEntries() {
    for (const entry of this.entries.values()) {
      const newPos = this._gridPos(entry.idx);
      entry.pos.copy(newPos);
      const newTarget = this.grid.targetSize;
      if (newTarget > 0 && entry.targetSize > 0 && Math.abs(newTarget - entry.targetSize) > 1e-6) {
        const ratio = newTarget / entry.targetSize;
        entry.root.scale.multiplyScalar(ratio);
        entry.targetSize = newTarget;
      }
    }
    this._layoutBarTop();
    this._updateShelvesLayout();
  }

  _gridPos(i) {
    const col = i % this.grid.cols;
    const row = Math.floor(i / this.grid.cols);
    const centeredCol = col - (this.grid.cols - 1) / 2;
    return new THREE.Vector3(
      centeredCol * this.grid.spacingX + this.grid.originX,
      -row * this.grid.spacingY + this.grid.originY,
      OBJECT_PLANE_Z
    );
  }

  /* ---------- selection & camera ---------- */
  selectById(idOrNull) { this.selectedId = idOrNull || null; }
  setSelectionPlaneVisible(_) {}
  _unitsPerPxObj() { return this._wuppY(); }
  _camYForDesiredWorldY(desiredWorldY) { return desiredWorldY - this.SELECT_Y_OFFSET; }

  focusSelectedToAnchor() {
    if (!this.renderer || !this.camera) return;
    this.camTarget = null;
    this.cam3DMode = false;
    this.prevScrollTop = this.contentEl?.scrollTop || 0;
    const { h } = this._getCanvasSize();
    const screenY = h * this.SELECT_ANCHOR_FRAC;
    const unitsPerPx = this._unitsPerPxAtDepth(this._distObj());
    const desiredWorldY = this.camera.position.y + ((h * 0.5) - screenY) * unitsPerPx;
    this.camTargetY = this._camYForDesiredWorldY(desiredWorldY);
    this.followScroll = false;
    this._returning = false;
  }

  releaseSelectedToScroll() {
    const unitsPerPx = this._unitsPerPxObj();
    const yFromPrevScroll = -(this.prevScrollTop || 0) * unitsPerPx;
    this.camTargetY = yFromPrevScroll;
    this._returning = true;
  }

  _getSectionTargetVec(sectionKey) {
    const cfg = (SECTION_CAM_POS[sectionKey] || SECTION_CAM_POS.default || DEFAULT_CAM_POS);
    const x = Number(cfg.x); const y = Number(cfg.y); const z = Number(cfg.z);
    return new THREE.Vector3(
      Number.isFinite(x) ? x : DEFAULT_CAM_POS.x,
      Number.isFinite(y) ? y : DEFAULT_CAM_POS.y,
      Number.isFinite(z) ? z : DEFAULT_CAM_POS.z
    );
  }

  focusSectionToFixed(sectionKey) {
    if (!this.renderer || !this.camera) return;
    this.prevScrollTop = this.contentEl?.scrollTop || 0;
    this.camTargetY = null;
    this.camTarget = this._getSectionTargetVec(sectionKey);
    this.cam3DMode = true;
    this.followScroll = false;
    this._returning = false;
  }

  releaseSectionToScroll() {
    const unitsPerPx = this._wuppY();
    const yFromPrevScroll = -(this.prevScrollTop || 0) * unitsPerPx;
    this.camTargetY = null;
    this.camTarget = new THREE.Vector3(DEFAULT_CAM_POS.x, yFromPrevScroll, DEFAULT_CAM_POS.z);
    this.cam3DMode = true;
    this._returning = true;
  }

  forceRelayoutNow() {
    try {
      if (!this._isViewportStable()) { this._afterStable(() => this.forceRelayoutNow()); return; }
      this.syncGridFromDOM();
      this.relayoutEntries();
      this._layoutBarTop();
      this._updateShelvesLayout();
      this.syncCameraToScroll();
    } catch (e) {
      console.warn('[KM] forceRelayoutNow failed:', e);
    }
  }
  queueRelayout() {
    const run = () => this.forceRelayoutNow();
    requestAnimationFrame(() => { run(); requestAnimationFrame(run); });
    setTimeout(run, 0);
    setTimeout(run, 60);
    setTimeout(run, 180);
    try { if (document?.fonts?.ready) document.fonts.ready.then(() => { setTimeout(run, 0); requestAnimationFrame(run); }); } catch {}
  }

  syncCameraToScroll() {
    if (!this.contentEl || !this.renderer || !this.camera) return;
    if (!this.followScroll) return;
    const d = this._distObj();
    const vFOV = THREE.MathUtils.degToRad(this.camera.fov);
    const viewH = 2 * Math.tan(vFOV / 2) * d;
    const { h } = this._getCanvasSize();
    const unitsPerPx = this._safe(viewH / Math.max(1, h), 0.001);
    this.camera.position.y = -this.contentEl.scrollTop * unitsPerPx;
    this.camera.position.x = DEFAULT_CAM_POS.x;
    this.camera.position.z = DEFAULT_CAM_POS.z;
  }

  _onResize() {
    if (!this.renderer || !this.camera) return;

    const DPR = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(DPR);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    if (!this._isViewportStable()) { this._afterStable(() => this._onResize()); return; }

    this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera.updateProjectionMatrix();

    this.syncGridFromDOM();   // respects lockGridY
    this.relayoutEntries();
    this.syncCameraToScroll();

    this._updateShelvesLayout();
    this._layoutBarTop();
    // character stick happens every frame in _loop, so no need here
  }

  /* ================= Character: wrapper that sticks to grid top ================= */
  _ensureCharacterWrapper() {
    this.ensureBgRefs();
    if (!this.characterNode) return;

    if (this.characterWrapper && this.characterWrapper.parent) return;

    // If character node is already a neutral group, use it as wrapper
    if (this.characterNode.isGroup && !this.characterNode.isSkinnedMesh && !this.characterNode.isBone) {
      this.characterWrapper = this.characterNode;
      return;
    }

    // Else, create a wrapper and reparent under it (no bone touched)
    const wrapper = new THREE.Group();
    wrapper.name = 'KM_characterWrapper';
    const parent = this.characterNode.parent || this.bgContainer || this.scene;
    parent.add(wrapper);
    wrapper.add(this.characterNode);
    this.characterWrapper = wrapper;
  }

  _cacheCharBindBottomY() {
    this._ensureCharacterWrapper();
    const root = this.characterWrapper || this.characterNode;
    if (!root) return;

    const invRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const worldBox = new THREE.Box3();
    const tmp = new THREE.Box3();

    root.traverse((n) => {
      if (!(n.isMesh || n.isSkinnedMesh) || !n.geometry) return;
      if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
      if (!n.geometry.boundingBox) return;
      tmp.copy(n.geometry.boundingBox);
      tmp.applyMatrix4(n.matrixWorld);   // ignores skinning movement
      worldBox.union(tmp);
    });

    worldBox.applyMatrix4(invRoot);
    this._charLocalBottomY = worldBox.min.y; // fixed in wrapper-local space
  }

  // Called every frame: keeps wrapper bottom pinned to top-of-grid (top shelf line)
  _stickCharacterToGridTop(offset = 0) {
    this._ensureCharacterWrapper();
    if (!this.characterWrapper || !this.gridEl || !this.camera) return;
    if (this._charLocalBottomY == null) this._cacheCharBindBottomY();

    // Top of CSS grid in object-plane coords
    const yTopObj = this.grid.originY + this.grid.spacingY * 0.5;

    // Map that Y to the character wrapper's Z depth
    const wp = new THREE.Vector3();
    this.characterWrapper.getWorldPosition(wp);
    const targetWorldY = this._mapYFromObjPlaneToZ(yTopObj, wp.z) + offset;

    // Current wrapper bottom (from cached bind bottom)
    const bottomWorldY = new THREE.Vector3(0, this._charLocalBottomY, 0)
      .applyMatrix4(this.characterWrapper.matrixWorld).y;

    const dy = targetWorldY - bottomWorldY;
    if (Math.abs(dy) > 1e-6) {
      this.characterWrapper.position.y += dy;         // move whole skeleton object
      this.characterWrapper.updateMatrixWorld(true);  // no bones touched
    }
  }

  /* ================= loop ================= */
  _loop() {
    if (!this.initialized) return;
    const dt = this.clock.getDelta();

    if (this.bgMixer) this.bgMixer.update(dt);

    if (this.cam3DMode && this.camTarget) {
      const k = 1 - Math.exp(-4.5 * dt);
      this.camera.position.lerp(this.camTarget, k);
      if (this.camera.position.distanceTo(this.camTarget) < 1e-3) {
        this.camera.position.copy(this.camTarget);
        if (this._returning) {
          this.followScroll = true;
          this.cam3DMode = false;
          this.camTarget = null;
          this._returning = false;
          this.syncCameraToScroll();
        } else {
          this.camTarget = null;
          this.cam3DMode = false;
        }
      }
    }
    else if (!this.followScroll && this.camTargetY != null) {
      const k = 1 - Math.exp(-6 * dt);
      this.camera.position.y += (this.camTargetY - this.camera.position.y) * k;
      this.camera.position.x = DEFAULT_CAM_POS.x;
      this.camera.position.z = DEFAULT_CAM_POS.z;
      if (Math.abs(this.camera.position.y - this.camTargetY) < 1e-3) {
        this.camera.position.y = this.camTargetY;
        if (this._returning) {
          this.followScroll = true; this.camTargetY = null; this._returning = false;
          this.syncCameraToScroll();
        } else {
          this.camTargetY = null;
        }
      }
    }

    const SELECT_TARGET = new THREE.Vector3(0, this.camera.position.y + this.SELECT_Y_OFFSET, OBJECT_PLANE_Z + 1.5);
    for (const [id, entry] of this.entries) {
      const sel = this.selectedId && id === this.selectedId;
      const target = sel ? SELECT_TARGET : entry.pos;
      entry.root.position.lerp(target, 1 - Math.exp(-8 * dt));
      if (sel) entry.root.rotation.y += 1.9 * dt;
      else entry.root.quaternion.slerp(entry.baseQuat, 1 - Math.exp(-6 * dt));
    }

    // ⛳ keep character stuck to the top-of-grid at all times (wrapper-level, never bones)
    this._stickCharacterToGridTop(0.0);

    this.renderer.render(this.scene, this.camera);
  }
}

export function getEngine() {
  if (typeof window === 'undefined') return null;
  if (!window.__KM_ENGINE__) window.__KM_ENGINE__ = new KMEngine();
  return window.__KM_ENGINE__;
}

export default KMEngine;
