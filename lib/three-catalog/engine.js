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
  TOPSTUFF_SCALE,
  clamp,
} from '@/lib/three-catalog/constants';
import { applyDefaultRim } from '@/lib/three-catalog/rim';

const AUTO_SPIN_SPEED = 4.9; // radians per second
const DRAG_SPIN_SCALE = 0.01; // radians per pixel dragged
const DRAG_MIN_DT = 0.008; // seconds
const SPIN_DAMPING_RATE = 3; // exponential damping factor
const AUTO_SPIN_RESUME_DELAY = 1.0; // seconds
const AUTO_SPIN_BLEND_RATE = 1.2; // how fast we blend back to auto spin
const AUTO_SPIN_THRESHOLD = 0.2; // velocity magnitude below which we resume auto spin

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
    this.backgroundTextureUrl = null;
    this._pendingBackgroundUrl = null;

    this.barTop = null;
    this.topStuff = null;
    this.shelfProto = null;
    this.shelfInstances = [];
    this._topStuffBaseScale = null;
    this._topStuffAppliedScale = null;

    this.characterNode = null;      // original node from GLB
    this.charPlacer = null;         // group that positions the character
    this.actions = { idle: null, talk: null };
    this._talking = false;
    this._talkCleanup = null;
    this._endingTalkAction = false;

    this.group = null;
    this.entries = new Map();
    this.loadingVersion = 0;
    this._contextLossHandled = false;

    this._spinControl = {
      dragging: false,
      lastX: 0,
      lastTime: 0,
      lastInput: 0,
      angularVelocity: 0,
      pendingDelta: 0,
      autoSpeed: AUTO_SPIN_SPEED,
    };

    this.contentEl = null;

    this.selectedId = null;

    this.followScroll = true;
    this.prevScrollTop = 0;

    this.camTargetY = null;
    this.camTarget = null;
    this.cam3DMode = false;
    this._returning = false;

    // Selection anchor config
    // We keep a target Z plane, but compute screen position from a DOM anchor rect.
    this.SELECT_VIEWPORT_FRAC = 0.35; // legacy, no longer used for selection
    this.SELECT_TARGET_Z = 2;
    this._selectTargetVec = new THREE.Vector3();
    this._gridShouldHide = false;
    this.activeSection = null;

    this.grid = {
      columns: 4,
      rowHeightPx: 0.2,
      topOffsetPx: 0.40,
      columnWidthPx: 0,
      totalRows: 0,
      contentHeightPx: 0,
      targetSize: 0.42,
      worldRowHeight: 1,
      worldColumnWidth: 1,
      worldTotalWidth: 1,
      firstRowWorldY: 0,
      unitsPerPxY: 0,
      viewportHeightPx: 0,
    };

    this.overlayRects = [];
    this.overlayVersion = 0;

    this._gridSlideOffsetWorld = 0;
    this._gridSlideTargetWorld = 0;
    this._wasSliding = false;
    this._overlayLocked = false;

    // ⛳ grid-Y lock (no Y re-anchoring while selected/section)
    this.lockGridY = false;

    this._loop = this._loop.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onContentScroll = this._onContentScroll.bind(this);
    this._cleanupScroll = null;
    this._bubbleScrollHidden = null;

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._onCanvasClick = this._onCanvasClick.bind(this);
    this._characterMeshes = [];
    this._clickCanvas = null;
    this._windowClickAttached = false;

    this._envMap = null;
    this._envMapPromise = null;
  }

  async setSceneBackground(url) {
    const target = url || '/galaxybg0.png';
    if (!this.scene) {
      this._pendingBackgroundUrl = target;
      return;
    }
    if (this.backgroundTextureUrl === target && this.scene?.background) return;
    this.backgroundTextureUrl = target;

    const loader = this.textureLoader || new THREE.TextureLoader(this.manager);
    this.textureLoader = loader;

    try {
      const texture = await loader.loadAsync(target);
      if (!texture?.image) throw new Error('Texture has no image data');
      texture.colorSpace = THREE.SRGBColorSpace;
      this.scene.background = texture;
    } catch (err) {
      console.warn('[KM] Failed to load background texture:', target, err);
      if (target !== '/galaxybg0.png') void this.setSceneBackground('/galaxybg0.png');
    }
  }

  setLockGridY(lock) {
    this.lockGridY = !!lock;
    this._overlayLocked = !!lock;
    this._updateGridSlideTarget();
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
    if (!this.bgMixer || !this.actions) return;
    const { talk, idle } = this.actions;
    if (!talk) return;
    this._talking = true;
    if (idle) {
      idle.enabled = true;
      idle.fadeOut?.(0.12);
    }
    talk.enabled = true;
    talk.reset();
    talk.setEffectiveWeight?.(1);
    talk.setLoop(THREE.LoopOnce, 1);
    talk.clampWhenFinished = true;
    talk.paused = false;
    talk.play();
    if (this._talkCleanup) clearTimeout(this._talkCleanup);
    const dur = (talk.getClip?.().duration ?? 0.8) * 1000;
    this._talkCleanup = setTimeout(() => {
      this._endTalkAction();
    }, Math.max(200, dur + 40));
  }

  _endTalkAction() {
    if (this._endingTalkAction) return;
    this._endingTalkAction = true;
    try {
      if (!this.actions) return;
      const { talk, idle } = this.actions;
      if (this._talkCleanup) { clearTimeout(this._talkCleanup); this._talkCleanup = null; }
      if (talk) {
        try { talk.stop?.(); } catch {}
        talk.clampWhenFinished = false;
        talk.reset?.();
        talk.enabled = false;
        talk.paused = true;
        talk.setEffectiveWeight?.(0);
      }
      if (idle) {
        idle.enabled = true;
        idle.reset?.();
        idle.setEffectiveWeight?.(1);
        idle.fadeIn?.(0.2);
        idle.play?.();
      }
      this._talking = false;
    } finally {
      this._endingTalkAction = false;
    }
  }

  async _ensureEnvMap() {
    if (this._envMap) return this._envMap;
    if (this._envMapPromise) return this._envMapPromise;
    if (!this.renderer) return null;
    const loader = this.textureLoader || new THREE.TextureLoader(this.manager);
    const run = async () => {
      try {
        const path = ENV_URL || '/env.png';
        const tex = await loader.loadAsync(path);
        if (!tex?.image) throw new Error('No image data');
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        this._envMap = tex;
        if (this.scene) this.scene.environment = tex;
        return tex;
      } catch (e) {
        console.warn('[KM] Failed to load env map:', e);
        return null;
      } finally {
        this._envMapPromise = null;
      }
    };
    this._envMapPromise = run();
    return this._envMapPromise;
  }

  _applyEnvMapToObject(obj) {
    if (!obj || !this._envMap) return;
    obj.traverse((child) => {
      if (child.isMesh || child.isSkinnedMesh) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((mat) => {
          if (mat && typeof mat === 'object') {
            mat.envMap = this._envMap;
            mat.needsUpdate = true;
          }
        });
      }
    });
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
  _now() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
    return Date.now();
  }

  _distAtZ(zWorld) { return Math.abs(this.camera.position.z - zWorld); }
  _distObj() { return this._distAtZ(OBJECT_PLANE_Z); }

  _cameraRefForTargets(sectionKey = null) {
    if (sectionKey && this.cam3DMode && this.camTarget) {
      return { y: this.camTarget.y, z: this.camTarget.z };
    }
    if (sectionKey === 'legal' && (!this.cam3DMode || !this.camTarget)) {
      const legal = this._getSectionTargetVec('legal');
      return { y: legal.y, z: legal.z };
    }
    const cam = this.camera;
    const y = this.camTargetY != null ? this.camTargetY : (cam?.position?.y ?? DEFAULT_CAM_POS.y);
    const z = cam?.position?.z ?? DEFAULT_CAM_POS.z;
    return { y, z };
  }

  _worldYAtObjFromScreenYFor(screenY, camY, camZ) {
    const { h } = this._getCanvasSize();
    const depth = Math.max(1e-6, Math.abs(camZ - OBJECT_PLANE_Z));
    const unitsPerPx = this._unitsPerPxAtDepth(depth);
    const dyPx = screenY - h * 0.5;
    return camY - dyPx * unitsPerPx;
  }

  _unitsPerPxAtDepth(depth) {
    const { h } = this._getCanvasSize();
    const vFOV = THREE.MathUtils.degToRad(this.camera.fov);
    const viewH = 2 * Math.tan(vFOV / 2) * depth;
    return this._safe(viewH / Math.max(1, h), 0.001);
  }
  _unitsPerPxXAtDepth(depth) {
    const { w } = this._getCanvasSize();
    const vFOV = THREE.MathUtils.degToRad(this.camera.fov);
    const viewH = 2 * Math.tan(vFOV / 2) * depth;
    const viewW = viewH * this.camera.aspect;
    return this._safe(viewW / Math.max(1, w), 0.001);
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
  _setWorldX(obj, xTarget) {
    if (!obj || !obj.parent) return;
    const pos = new THREE.Vector3();
    obj.getWorldPosition(pos);
    pos.x = xTarget;
    obj.parent.worldToLocal(pos);
    obj.position.x = pos.x;
  }

  _syncTopStuffToBarTop() {
    this.ensureBgRefs();
    if (!this.barTop || !this.topStuff) return;
    const parent = this.topStuff.parent || this.bgContainer;
    if (!parent) return;
    const pos = new THREE.Vector3();
    this.barTop.updateWorldMatrix?.(true, false);
    this.barTop.getWorldPosition(pos);
    parent.updateWorldMatrix?.(true, false);
    parent.worldToLocal(pos);
    this.topStuff.position.copy(pos);
    this.topStuff.updateMatrixWorld(true);
    this._updateTopStuffScale();
  }

  _syncCharPlacerToBarTop() {
    this.ensureBgRefs();
    if (!this.barTop || !this.charPlacer) return;
    const parent = this.charPlacer.parent || this.bgContainer;
    if (!parent) return;
    const pos = new THREE.Vector3();
    this.barTop.updateWorldMatrix?.(true, false);
    this.barTop.getWorldPosition(pos);
    parent.updateWorldMatrix?.(true, false);
    parent.worldToLocal(pos);
    this.charPlacer.position.copy(pos);
    this.charPlacer.updateMatrixWorld(true);
  }

  _updateTopStuffScale() {
    if (!this.topStuff) return;
    if (!this._topStuffBaseScale) {
      this._topStuffBaseScale = {
        x: this.topStuff.scale.x,
        y: this.topStuff.scale.y,
        z: this.topStuff.scale.z,
      };
    }

    const { minWidth, maxWidth, minScale, maxScale } = TOPSTUFF_SCALE;
    const { w } = this._getCanvasSize();
    const width = Math.max(1, w || window.innerWidth || 1);
    let targetScale;
    if (width <= minWidth) targetScale = minScale;
    else if (width >= maxWidth) targetScale = maxScale;
    else {
      const span = Math.max(1, maxWidth - minWidth);
      const t = (width - minWidth) / span;
      targetScale = minScale + t * (maxScale - minScale);
    }
    targetScale = clamp(targetScale, Math.min(minScale, maxScale), Math.max(minScale, maxScale));

    if (Math.abs((this._topStuffAppliedScale ?? -1) - targetScale) < 1e-4) return;
    this._topStuffAppliedScale = targetScale;
    const base = this._topStuffBaseScale;
    this.topStuff.scale.set(base.x * targetScale, base.y, base.z);
    this.topStuff.updateMatrixWorld(true);
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
    if (!this.topStuff || !this.topStuff.parent) this.topStuff = this._findByNameCI(root, 'topstuff') || null;
    if (!this.shelfProto || !this.shelfProto.parent) this.shelfProto = this._findByNameCI(root, 'shelf') || null;
    if (!this.charPlacer || !this.charPlacer.parent) this.charPlacer = this._findByNameCI(root, 'charplacer') || null;
    if (!this.characterNode || !this.characterNode.parent) this.characterNode = this._findByNameCI(root, 'character') || null;
  }

  /* ==== shelves & barTop layout ==== */
  _layoutBarTop() {
    this.ensureBgRefs();
    if (!this.barTop || !this._isViewportStable()) return;
    if (this._hasSkinnedDescendants(this.barTop)) return;
    const metrics = this._computeGridMetrics();
    const { columns, worldRowHeight, worldColumnWidth, firstRowWorldY } = metrics;
    const slideOffset = this._gridSlideOffsetWorld || 0;

    const targetWidth = worldColumnWidth * columns * (1 + BARTOP_EXTRA);
    this._fitWidthTo(this.barTop, targetWidth);
    this.barTop.scale.y = 1;
    this.barTop.scale.z = 1;
    this._setWorldX(this.barTop, DEFAULT_CAM_POS.x);
    const topWorld = firstRowWorldY + worldRowHeight * 0.5 + slideOffset;
    this._setBottomWorldY(this.barTop, topWorld);
    this._syncTopStuffToBarTop();
    this._syncCharPlacerToBarTop();
  }
  _hasSkinnedDescendants(obj) { let f=false; obj?.traverse(n=>{ if(n.isSkinnedMesh) f=true; }); return f; }
  _layoutShelfForRow(shelfObj, rowIndex) {
    if (!shelfObj || !this._isViewportStable()) return;
    if (this._hasSkinnedDescendants(shelfObj)) return;

    const metrics = this._computeGridMetrics();
    const { columns, worldRowHeight, worldColumnWidth, firstRowWorldY } = metrics;
    const slideOffset = this._gridSlideOffsetWorld || 0;

    const targetWidthWorld = worldColumnWidth * columns;
    const targetRowHeightWorld = worldRowHeight;

    this._fitWidthTo(shelfObj, targetWidthWorld);
    this._fitHeightTo(shelfObj, targetRowHeightWorld);
    this._setWorldX(shelfObj, DEFAULT_CAM_POS.x);
    const centerY = firstRowWorldY - rowIndex * worldRowHeight + slideOffset;
    const bottomY = centerY - targetRowHeightWorld * 0.5;
    this._setBottomWorldY(shelfObj, bottomY);
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
    this._computeGridMetrics();
    const totalItems = Math.max(1, this.entries.size || 1);
    const rows = Math.max(1, Math.ceil(totalItems / Math.max(1, this.grid.columns))) + 1;
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

    this.textureLoader = new THREE.TextureLoader(this.manager);
    if (this._pendingBackgroundUrl) {
      this.setSceneBackground(this._pendingBackgroundUrl);
      this._pendingBackgroundUrl = null;
    } else {
      void this.setSceneBackground('/galaxybg0.png');
    }

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
      if (!this._contextLossHandled) {
        this._contextLossHandled = true;
        try { window.dispatchEvent(new CustomEvent('km_webgl_context_lost')); } catch {}
        const now = Date.now();
        let last = 0;
        try { last = Number(sessionStorage.getItem('km_gl_reload_at') || '0'); } catch {}
        if (!Number.isFinite(last)) last = 0;
        if (typeof window !== 'undefined' && now - last > 5000) {
          try { sessionStorage.setItem('km_gl_reload_at', String(now)); } catch {}
          setTimeout(() => {
            try { window.location.reload(); } catch {}
          }, 250);
        }
      }
    }, { passive: false });
    canvas.addEventListener('webglcontextrestored', () => {
      try { renderer.setAnimationLoop(this._loop); } catch {}
      this._contextLossHandled = false;
      this._envMap = null;
      this._envMapPromise = null;
      const markForUpdate = () => {
        this.entries.forEach(({ root }) => {
          if (!root) return;
          root.traverse((node) => {
            if (!node || (!node.isMesh && !node.isSkinnedMesh)) return;
            const mats = Array.isArray(node.material) ? node.material : [node.material];
            mats.forEach((mat) => {
              if (!mat || typeof mat !== 'object') return;
              mat.needsUpdate = true;
              ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'].forEach((key) => {
                if (mat[key]) mat[key].needsUpdate = true;
              });
            });
          });
        });
      };
      this._ensureEnvMap()
        .then((env) => {
          if (env) {
            this.entries.forEach(({ root }) => this._applyEnvMapToObject(root));
          }
          markForUpdate();
        })
        .catch(() => markForUpdate());
      this._afterStable(() => {
        if (!this.bgContainer || this.bgContainer.children.length === 0) {
          this._clearBackground();
          this.bgLoaded = false;
          this.loadBackgroundOnce(this.bgUrl || BG_URL);
        }
        this.queueRelayout?.();
      });
    });

    if (this._clickCanvas) {
      try { this._clickCanvas.removeEventListener('click', this._onCanvasClick); } catch {}
    }
    this._clickCanvas = canvas;
    canvas.addEventListener('click', this._onCanvasClick);
    if (!this._windowClickAttached) {
      window.addEventListener('click', this._onCanvasClick, { passive: true });
      this._windowClickAttached = true;
    }

    this._ensureEnvMap();

    this.initialized = true;
    this.syncCameraToScroll();
  }

  _handleCharacterClick() {
    if (this.selectedId) return;
    try {
      window.dispatchEvent(new CustomEvent('km_character_click'));
    } catch {}
  }

  _onCanvasClick(event) {
    if (!this.renderer || !this.camera || !this.characterNode) return;
    const target = event.target;
    if (target?.closest?.('button, a, [role="button"], .overlay-grid, .buyui-bar, .chrome-topbar, #buyui, .collection-page')) return;
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._pointer.set(x, y);
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const targets = this._characterMeshes && this._characterMeshes.length ? this._characterMeshes : [this.characterNode];
    const hits = this._raycaster.intersectObjects(targets, true);
    if (hits && hits.length > 0) this._handleCharacterClick();
  }

  attachScroll(contentEl) {
    if (this.contentEl === contentEl) return;
    if (this._cleanupScroll) { this._cleanupScroll(); this._cleanupScroll = null; }
    this.contentEl = contentEl;
    if (!contentEl) return;
    contentEl.addEventListener('scroll', this._onContentScroll, { passive: true });
    this._cleanupScroll = () => contentEl.removeEventListener('scroll', this._onContentScroll);
    this._bubbleScrollHidden = null;
    this._onContentScroll();
  }

  _onContentScroll() {
    this.syncCameraToScroll();
    const { h } = this._getCanvasSize();
    const threshold = (h || window.innerHeight || 1) / 3;
    const scrolled = (this.contentEl?.scrollTop || 0) > threshold;
    if (typeof window !== 'undefined') window.__KM_BUBBLE_SCROLLED__ = scrolled;
    if (this._bubbleScrollHidden === scrolled) return;
    this._bubbleScrollHidden = scrolled;
    window.dispatchEvent(new CustomEvent('km_bubble_scrolled', { detail: { scrolled } }));
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
    this._endTalkAction();
    this.bgRoot = null; this.barTop = null; this.topStuff = null; this.shelfProto = null; this.shelfInstances = [];
    this.bgMixer = null; this.characterNode = null; this.charPlacer = null; this.actions = { idle: null, talk: null }; this._talking = false; this._talkCleanup = null;
    this._topStuffBaseScale = null;
    this._topStuffAppliedScale = null;
    this._characterMeshes = [];
    this.overlayRects = [];
    this.overlayVersion++;
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

      root.updateMatrixWorld(true);

      this.barTop     = this._findByNameCI(root, 'barTop');
      this.topStuff  = this._findByNameCI(root, 'topstuff') || null;
      this.charPlacer = this._findByNameCI(root, 'charplacer') || null;

      this._syncTopStuffToBarTop();
      this._syncCharPlacerToBarTop();

      this.shelfProto = this._findByNameCI(root, 'shelf');
      this.characterNode = this._findByNameCI(root, 'character') || null;
      this._characterMeshes = [];
      if (this.characterNode) {
        this.characterNode.traverse((n) => {
          if (n.isMesh || n.isSkinnedMesh) this._characterMeshes.push(n);
        });
      }

      const env = await this._ensureEnvMap();
      if (env) {
        this.scene.environment = env;
        this._applyEnvMapToObject(root);
      }

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
              this._endTalkAction();
            }
          });
        }
      }

      const envMapPath = '/env.png';
      try {
        const tex = await new THREE.TextureLoader(this.manager).loadAsync(envMapPath);
        if (!tex?.image) throw new Error('No image data');
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        this._envMap = tex;
        this.scene.environment = tex;
      } catch (err) {
        console.warn('[KM] Failed to load environment map:', envMapPath, err);
      }

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
  async loadProducts(items) {
    if (!this.initialized) return;
    const myVersion = ++this.loadingVersion;

    for (const { root } of this.entries.values()) this.group.remove(root);
    this.entries.clear();

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

        const targetSize = 1;
        this._normalize(node, targetSize);

        applyDefaultRim(node);

        const env = await this._ensureEnvMap();
        if (env) this._applyEnvMapToObject(node);

        const baseQuat = node.quaternion.clone();

        this.group.add(node);
        this.entries.set(it.id, { idx, root: node, baseQuat, pos: new THREE.Vector3(), targetSize, gridScaleTarget: targetSize, selectedScaleTarget: null, returningScale: false, handle: it.handle, isSpecial: !!it.__special });
      } catch (e) { console.error('GLB load error', it.modelUrl, e); }
      idx++;
    }

    this._layoutEntries();
    this._afterStable(() => { this._updateShelvesLayout(); this._layoutBarTop(); });
  }

  relayoutEntries() {
    this._layoutEntries();
    this._layoutBarTop();
    this._updateShelvesLayout();
  }

  _updateGridSlideTarget() {
    if (!this.initialized) return;
    const metrics = this._computeGridMetrics();
    const unitsPerPxY = metrics && metrics.rowHeightPx ? metrics.worldRowHeight / Math.max(1, metrics.rowHeightPx) : (this.grid.unitsPerPxY || 0);
    const viewportHeightPx = this.grid.viewportHeightPx || this._getCanvasSize().h || 0;
    if (!Number.isFinite(unitsPerPxY) || !Number.isFinite(viewportHeightPx) || unitsPerPxY === 0) return;
    const overlaySlide = -(viewportHeightPx * unitsPerPxY * 1.2);

    const gridTopWorldBase = metrics.firstRowWorldY + metrics.worldRowHeight * 0.5;

    if (this._gridShouldHide && metrics) {
      const { y: camY, z: camZ } = this._cameraRefForTargets();
      const targetScreenY = viewportHeightPx * 1.5;
      const targetWorldY = this._worldYAtObjFromScreenYFor(targetScreenY, camY, camZ);
      const desiredSlide = targetWorldY - gridTopWorldBase;
      this._gridSlideTargetWorld = desiredSlide;
    } else if (this.activeSection === 'legal') {
      this._gridSlideTargetWorld = 0;
    } else if (this._overlayLocked) {
      this._gridSlideTargetWorld = overlaySlide;
    } else {
      this._gridSlideTargetWorld = 0;
    }

  }

  getOverlayData() {
    return {
      rects: this.overlayRects,
      contentHeightPx: this.grid.contentHeightPx,
      topOffsetPx: this.grid.topOffsetPx,
      rowHeightPx: this.grid.rowHeightPx,
      version: this.overlayVersion,
    };
  }

  _layoutEntries() {
    if (!this.renderer || !this.camera) return;
    if (!this._isViewportStable()) return;

    const prevHeightPx = this.grid.contentHeightPx || 0;
    const prevTopPx = this.grid.topOffsetPx || 0;
    const metrics = this._computeGridMetrics();
    const { columns, rowHeightPx, topOffsetPx, columnWidthPx, worldRowHeight, worldColumnWidth, firstRowWorldY, targetSize } = metrics;
    const overlay = [];

    const entries = Array.from(this.entries.entries()).sort((a, b) => a[1].idx - b[1].idx);
    const slideOffset = this._gridSlideOffsetWorld || 0;
    entries.forEach(([id, entry]) => {
      const row = Math.floor(entry.idx / columns);
      const col = entry.idx % columns;

      const cellLeft = col * columnWidthPx;
      const cellTop = topOffsetPx + row * rowHeightPx;
      const cellWidth = columnWidthPx;
      const cellHeight = rowHeightPx;
      const centerPxX = cellLeft + cellWidth * 0.5;
      const centerPxY = cellTop + cellHeight * 0.5;

      const colOffset = col - (columns - 1) / 2;
      const worldX = DEFAULT_CAM_POS.x + colOffset * worldColumnWidth;
      const worldY = firstRowWorldY - row * worldRowHeight + slideOffset;

      entry.pos.set(worldX, worldY, OBJECT_PLANE_Z);
      const isSelected = this.selectedId && id === this.selectedId;
      if (!isSelected) entry.root.position.copy(entry.pos);

      const scaleTarget = targetSize * (entry.isSpecial ? 1.1 : 1);
      entry.gridScaleTarget = scaleTarget;
      // Snap non-selected, non-returning items to grid scale to keep grid tidy
      if (!isSelected && !entry.returningScale) {
        if (scaleTarget > 0 && entry.targetSize > 0 && Math.abs(scaleTarget - entry.targetSize) > 1e-4) {
          const ratio = scaleTarget / entry.targetSize;
          entry.root.scale.multiplyScalar(ratio);
          entry.targetSize = scaleTarget;
        } else if (entry.targetSize <= 0) {
          entry.targetSize = scaleTarget;
          entry.root.scale.setScalar(scaleTarget);
        }
      }

      overlay.push({
        id,
        index: entry.idx,
        left: cellLeft,
        top: cellTop,
        width: cellWidth,
        height: cellHeight,
      });
    });

    const totalRows = Math.ceil(Math.max(1, entries.length) / Math.max(1, columns));
    const bottomPadding = rowHeightPx * 0.35;
    this.grid.totalRows = totalRows;
    this.grid.contentHeightPx = totalRows * rowHeightPx + bottomPadding;

    const prevRects = this.overlayRects;
    let changed = overlay.length !== prevRects.length;
    if (!changed) {
      for (let i = 0; i < overlay.length; i++) {
        const a = overlay[i];
        const b = prevRects[i];
        if (!b || a.id !== b.id || a.left !== b.left || a.top !== b.top || a.width !== b.width || a.height !== b.height) {
          changed = true;
          break;
        }
      }
    }
    // Also bump version if key layout metrics changed
    if (!changed) {
      const heightChanged = Math.abs((this.grid.contentHeightPx || 0) - prevHeightPx) > 0.5;
      const topChanged = Math.abs((this.grid.topOffsetPx || 0) - prevTopPx) > 0.5;
      if (heightChanged || topChanged) changed = true;
    }
    if (changed) {
      this.overlayRects = overlay;
      this.overlayVersion++;
    }
  }

  _computeGridMetrics() {
    const { w, h } = this._getCanvasSize();
    const isMobile = w <= 700;
    const columns = isMobile ? 2 : 4;
    const rowHeightPx = h * (isMobile ? 0.30 : 0.20);
    const topOffsetPx = h * 0.50;
    const columnWidthPx = w / Math.max(1, columns);
    const distObj = this._distObj();
    const unitsPerPxX = this._unitsPerPxXAtDepth(distObj);
    const unitsPerPxY = this._unitsPerPxAtDepth(distObj);
    const worldColumnWidth = columnWidthPx * unitsPerPxX;
    const worldRowHeight = rowHeightPx * unitsPerPxY;
    const firstRowCenterPx = topOffsetPx + rowHeightPx * 0.5;
    const firstRowWorldY = DEFAULT_CAM_POS.y + (Math.max(1, h) * 0.5 - firstRowCenterPx) * unitsPerPxY;
    const worldTotalWidth = worldColumnWidth * columns;
    const targetSize = Math.min(worldRowHeight, worldColumnWidth) * 0.85;

    this.grid.columns = columns;
    this.grid.rowHeightPx = rowHeightPx;
    this.grid.topOffsetPx = topOffsetPx;
    this.grid.columnWidthPx = columnWidthPx;
    this.grid.targetSize = targetSize;
    this.grid.worldRowHeight = worldRowHeight;
    this.grid.worldColumnWidth = worldColumnWidth;
    this.grid.worldTotalWidth = worldTotalWidth;
    this.grid.firstRowWorldY = firstRowWorldY;
    this.grid.unitsPerPxY = unitsPerPxY;
    this.grid.viewportHeightPx = h;

    return { columns, rowHeightPx, topOffsetPx, columnWidthPx, targetSize, worldRowHeight, worldColumnWidth, worldTotalWidth, firstRowWorldY };
  }

  /* ---------- selection & camera ---------- */
  selectById(idOrNull) {
    const prev = this.selectedId;
    this.selectedId = idOrNull || null;
    if (this.selectedId) this.activeSection = null;
    this._gridShouldHide = !!this.selectedId;
    if (this.selectedId) {
      const e = this.entries.get(this.selectedId);
      if (e) {
        // Compute selection scale once based on anchor rect (front view fit)
        const s = this._computeSelectTargetScale();
        if (Number.isFinite(s) && s > 0) e.selectedScaleTarget = s;
        e.returningScale = false;
      }
    }
    // If we just deselected, mark previous entry to smoothly return to grid scale
    if (!this.selectedId && prev) {
      const e = this.entries.get(prev);
      if (e) { e.returningScale = true; e.selectedScaleTarget = null; }
    }
    const spin = this._spinControl;
    const now = this._now();
    if (this.selectedId) {
      spin.dragging = false;
      spin.pendingDelta = 0;
      spin.autoSpeed = AUTO_SPIN_SPEED;
      spin.angularVelocity = spin.autoSpeed;
      spin.lastInput = now - 3000;
      spin.lastTime = now;
    } else {
      spin.dragging = false;
      spin.pendingDelta = 0;
      spin.angularVelocity = 0;
      spin.lastInput = now;
      spin.lastTime = now;
    }
    this._updateGridSlideTarget();
  }
  setSelectionPlaneVisible(_) {}
  _unitsPerPxObj() { return this._wuppY(); }

  // Selection anchor helpers
  _getSelectAnchorRect() {
    try {
      const el = document.getElementById('km-select-target');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      return rect;
    } catch { return null; }
  }
  _worldXAtObjFromScreenX(screenX) {
    const { w } = this._getCanvasSize();
    const dxPx = screenX - w * 0.5;
    const wuppX = this._wuppX();
    return this.camera.position.x + dxPx * wuppX;
  }
  _mapXFromObjPlaneToZ(xObj, zTarget) {
    const cx = this.camera.position.x;
    const r = this._safe(this._distAtZ(zTarget) / this._distObj(), 1);
    return this._safe(cx + (xObj - cx) * r, cx);
  }

  onSelectionDragStart(clientX) {
    if (!this.selectedId) return;
    const s = this._spinControl;
    const now = this._now();
    s.dragging = true;
    s.lastX = Number.isFinite(clientX) ? clientX : 0;
    s.lastTime = now;
    s.lastInput = now;
    s.pendingDelta = 0;
    s.angularVelocity = 0;
  }
  onSelectionDragMove(clientX) {
    if (!this.selectedId) return;
    const s = this._spinControl;
    if (!s.dragging) return;
    const now = this._now();
    const x = Number.isFinite(clientX) ? clientX : 0;
    const dx = x - s.lastX;
    const dt = Math.max(DRAG_MIN_DT, (now - s.lastTime) / 1000);
    const delta = dx * DRAG_SPIN_SCALE;
    s.pendingDelta += delta;
    const limit = 6; // clamp to avoid wild spins
    const vel = delta / dt;
    if (Number.isFinite(vel)) {
      s.angularVelocity = Math.max(-limit, Math.min(limit, vel));
    }
    s.lastX = x;
    s.lastTime = now;
    s.lastInput = now;
  }
  onSelectionDragEnd() {
    const s = this._spinControl;
    if (!s.dragging) {
      s.lastInput = this._now();
      return;
    }
    s.dragging = false;
    const now = this._now();
    s.lastTime = now;
    s.lastInput = now;
  }

  _computeSelectTargetVec() {
    if (!this.renderer || !this.camera) return null;
    const rect = this._getSelectAnchorRect();
    const z = this.SELECT_TARGET_Z;
    if (rect) {
      const centerX = rect.left + rect.width * 0.5;
      const centerY = rect.top + rect.height * 0.5;
      const worldYAtObjPlane = this._worldYAtObjFromScreenY(centerY);
      const worldY = this._mapYFromObjPlaneToZ(worldYAtObjPlane, z);
      const worldXAtObjPlane = this._worldXAtObjFromScreenX(centerX);
      const worldX = this._mapXFromObjPlaneToZ(worldXAtObjPlane, z);
      this._selectTargetVec.set(worldX, worldY, z);
      return this._selectTargetVec;
    }
    // Fallback to center
    const { h } = this._getCanvasSize();
    const centerY = h * 0.5;
    const worldYAtObjPlane = this._worldYAtObjFromScreenY(centerY);
    const worldY = this._mapYFromObjPlaneToZ(worldYAtObjPlane, z);
    this._selectTargetVec.set(0, worldY, z);
    return this._selectTargetVec;
  }

  // Project a world position to pixel coordinates
  _projectWorldToPx(world) {
    if (!this.camera || !this.renderer) return { x: 0, y: 0 };
    const { w, h } = this._getCanvasSize();
    const v = world.clone().project(this.camera);
    const x = (v.x * 0.5 + 0.5) * w;
    const y = (-(v.y * 0.5 - 0.5)) * h;
    return { x, y };
  }

  // Compute projected pixel bounds of an object (tight AABB of its corners)
  _computeProjectedSizePx(obj) {
    if (!obj) return { w: 0, h: 0 };
    // World-aligned bounding box of the object with its current transform
    const box = new THREE.Box3().setFromObject(obj);
    if (!box || !isFinite(box.min.x) || !isFinite(box.max.x)) return { w: 0, h: 0 };
    const corners = [
      new THREE.Vector3(box.min.x, box.min.y, box.min.z),
      new THREE.Vector3(box.min.x, box.min.y, box.max.z),
      new THREE.Vector3(box.min.x, box.max.y, box.min.z),
      new THREE.Vector3(box.min.x, box.max.y, box.max.z),
      new THREE.Vector3(box.max.x, box.min.y, box.min.z),
      new THREE.Vector3(box.max.x, box.min.y, box.max.z),
      new THREE.Vector3(box.max.x, box.max.y, box.min.z),
      new THREE.Vector3(box.max.x, box.max.y, box.max.z),
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of corners) {
      const p = this._projectWorldToPx(c);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return { w: 0, h: 0 };
    const w = Math.max(0, maxX - minX);
    const h = Math.max(0, maxY - minY);
    return { w, h };
  }

  _computeSelectTargetScale() {
    if (!this.renderer || !this.camera) return null;
    const rect = this._getSelectAnchorRect();
    const z = this.SELECT_TARGET_Z;
    if (!rect) return null;
    const depth = Math.max(1e-6, Math.abs(this.camera.position.z - z));
    const unitsPerPxX = this._unitsPerPxXAtDepth(depth);
    const unitsPerPxY = this._unitsPerPxAtDepth(depth);
    const worldW = rect.width * unitsPerPxX;
    const worldH = rect.height * unitsPerPxY;
    const padding = 0.92; // small inset to ensure it sits inside
    const target = Math.max(1e-6, Math.min(worldW, worldH) * padding);
    return target;
  }

  focusSelectedToAnchor() {
    if (!this.renderer || !this.camera) return;
    this.camTarget = null;
    this.cam3DMode = false;
    this.prevScrollTop = this.contentEl?.scrollTop || 0;
    this.camTargetY = this.camera.position.y;
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
    let targetVec = this._getSectionTargetVec(sectionKey);
    if (sectionKey === 'legal') {
      const metrics = this._computeGridMetrics();
      const viewportHeightPx = this.grid.viewportHeightPx || this._getCanvasSize().h || 0;
      if (metrics && viewportHeightPx > 0) {
        const gridTopWorldBase = metrics.firstRowWorldY + metrics.worldRowHeight * 0.5;
        const targetScreenY = viewportHeightPx * 0.9;
        const targetWorldY = this._worldYAtObjFromScreenYFor(targetScreenY, targetVec.y, targetVec.z);
        const desiredSlide = targetWorldY - gridTopWorldBase;
        targetVec = targetVec.clone();
        targetVec.y -= desiredSlide;
      }
    }
    this.camTarget = targetVec;
    this.cam3DMode = true;
    this.followScroll = false;
    this._returning = false;
    this.activeSection = sectionKey || null;
    this._gridShouldHide = false;
    this._updateGridSlideTarget();
  }

  releaseSectionToScroll() {
    const unitsPerPx = this._wuppY();
    const yFromPrevScroll = -(this.prevScrollTop || 0) * unitsPerPx;
    this.camTargetY = null;
    this.camTarget = new THREE.Vector3(DEFAULT_CAM_POS.x, yFromPrevScroll, DEFAULT_CAM_POS.z);
    this.cam3DMode = true;
    this._returning = true;
    this.activeSection = null;
    this._updateGridSlideTarget();
  }

  forceRelayoutNow() {
    try {
      if (!this._isViewportStable()) { this._afterStable(() => this.forceRelayoutNow()); return; }
      this._layoutEntries();
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

    this._layoutEntries();
    this.syncCameraToScroll();

    this._updateShelvesLayout();
    this._layoutBarTop();
  }

  /* ================= loop ================= */
  _loop() {
    if (!this.initialized) return;
    const dt = this.clock.getDelta();
    const now = this._now();
    const spin = this._spinControl;

    const slideTarget = this._gridSlideTargetWorld || 0;
    const slideDelta = slideTarget - (this._gridSlideOffsetWorld || 0);
    if (Math.abs(slideDelta) > 1e-4) {
      const k = 1 - Math.exp(-6 * dt);
      this._gridSlideOffsetWorld = (this._gridSlideOffsetWorld || 0) + slideDelta * k;
      this._layoutEntries();
      this._updateShelvesLayout();
      this._layoutBarTop();
    }

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
          this._updateGridSlideTarget();
        } else {
          this.camTarget = null;
          this.cam3DMode = false;
          this._updateGridSlideTarget();
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
          // Set scrollTop exactly once before handing control back to scroll-follow
          try { if (this.contentEl) this.contentEl.scrollTop = (this.prevScrollTop || 0); } catch {}
          this.followScroll = true; this.camTargetY = null; this._returning = false;
          this.syncCameraToScroll();
          this._updateGridSlideTarget();
        } else {
          this.camTargetY = null;
          this._updateGridSlideTarget();
        }
      }
    }

    const selectTarget = this.selectedId ? this._computeSelectTargetVec() : null;
    for (const [id, entry] of this.entries) {
      const sel = this.selectedId && id === this.selectedId;
      const target = sel && selectTarget ? selectTarget : entry.pos;
      entry.root.position.lerp(target, 1 - Math.exp(-8 * dt));
      // Compute desired world-size target: selected uses precomputed one-time target; otherwise grid target
      const gridScale = (Number.isFinite(entry.gridScaleTarget) && entry.gridScaleTarget > 0) ? entry.gridScaleTarget : entry.targetSize;
      const desiredWorldSize = sel
        ? (Number.isFinite(entry.selectedScaleTarget) && entry.selectedScaleTarget > 0 ? entry.selectedScaleTarget : gridScale)
        : gridScale;
      // Smooth multiplicative scaling based on targetSize bookkeeping
      if (sel || entry.returningScale) {
        const kS = 1 - Math.exp(-8 * dt);
        const curSize = (Number.isFinite(entry.targetSize) && entry.targetSize > 0) ? entry.targetSize : gridScale || 1;
        const newSize = curSize + (desiredWorldSize - curSize) * kS;
        const ratio = (curSize > 0) ? (newSize / curSize) : 1;
        if (Number.isFinite(ratio) && ratio > 0) entry.root.scale.multiplyScalar(ratio);
        entry.targetSize = newSize;
        if (!sel && Math.abs(newSize - desiredWorldSize) < 1e-3) entry.returningScale = false;
      }
      if (sel) {
        if (spin.pendingDelta) {
          entry.root.rotation.y += spin.pendingDelta;
          spin.pendingDelta = 0;
        }
        if (!spin.dragging) {
          const idleFor = spin.lastInput ? (now - spin.lastInput) / 1000 : Infinity;
          const damping = Math.exp(-SPIN_DAMPING_RATE * dt);
          spin.angularVelocity *= damping;
          if (Math.abs(spin.angularVelocity) < 0.01) spin.angularVelocity = 0;
          if (idleFor > AUTO_SPIN_RESUME_DELAY || Math.abs(spin.angularVelocity) < AUTO_SPIN_THRESHOLD) {
            const blend = 1 - Math.exp(-AUTO_SPIN_BLEND_RATE * dt);
            spin.angularVelocity += (spin.autoSpeed - spin.angularVelocity) * blend;
          }
        }
        entry.root.rotation.y += spin.angularVelocity * dt;
      } else {
        entry.root.quaternion.slerp(entry.baseQuat, 1 - Math.exp(-6 * dt));
        if (entry.root.position.distanceToSquared(entry.pos) < 1e-6) {
          entry.root.position.copy(entry.pos);
        }
        if (entry.root.quaternion.angleTo(entry.baseQuat) < 1e-3) {
          entry.root.quaternion.copy(entry.baseQuat);
        }
      }
    }

    this._syncCharPlacerToBarTop();

    this.renderer.render(this.scene, this.camera);
  }
}

export function getEngine() {
  if (typeof window === 'undefined') return null;
  if (!window.__KM_ENGINE__) window.__KM_ENGINE__ = new KMEngine();
  return window.__KM_ENGINE__;
}

export default KMEngine;
