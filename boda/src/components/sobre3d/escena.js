import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import gsap from 'gsap';
import * as tx from './texturas';

/*
 * El sobre en WebGL: papel con grano y relieve, lámina que refleja de verdad,
 * sombras reales entre capas, la solapa se curva al abrir, el lacre se parte
 * con chispas de oro y la tarjeta vuela a la cámara. Toda la coreografía es UN
 * timeline de GSAP sobre números (`st`, `pose`); el cuadro sólo los lee, así
 * que corre igual a 60 o a 120 Hz y se puede rebobinar.
 */
const { W, H, L } = tx.SOBRE;
const TW = 1.27; const TH = 0.89; const TD = 0.004;
const Z = { tarjeta: 0.006, izq: 0.0105, der: 0.012, abajo: 0.0145, solapa: 0.019, lacre: 0.024 };
const LACRE_R = 0.1; const LACRE_UV = 0.13;
const FOV = 30;
const CHISPAS = 64;

async function cargarLetras() {
  if (!document.fonts?.load) return;
  const fuentes = ['400 100px "Bodoni Moda"', 'italic 400 100px "Bodoni Moda"', '400 40px "Inter Tight"', '500 40px "Inter Tight"'];
  await Promise.race([Promise.all(fuentes.map((f) => document.fonts.load(f))), new Promise((r) => { setTimeout(r, 2500); })]).catch(() => {});
}

export async function crearEscena(contenedor, datos) {
  await cargarLetras();
  const canvas = document.createElement('canvas');
  canvas.className = 'sobre-lienzo';
  contenedor.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const entorno = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = entorno;
  scene.environmentIntensity = 0.32;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 60);

  const desechos = [entorno];
  const tex = (canvasTex, { color = false, rep } = {}) => {
    const t = new THREE.CanvasTexture(canvasTex);
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (rep) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
    desechos.push(t);
    return t;
  };
  const relieve = (rep) => tex(tx.ruido(), { rep });
  const material = ({ color, orm }, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({
      map: tex(color, { color: true }), roughnessMap: tex(orm), metalnessMap: tex(orm), roughness: 1, metalness: 1,
      bumpMap: relieve([4, 2.8]), bumpScale: 0.9, ...extra,
    });
    desechos.push(m);
    return m;
  };

  // ── Luces: una principal cálida desde arriba a la izquierda, un contraluz frío y dos de efecto.
  const llave = new THREE.DirectionalLight('#fff3e2', 1.9);
  llave.position.set(-1.3, 2.2, 3.2);
  llave.castShadow = true;
  llave.shadow.mapSize.set(2048, 2048);
  Object.assign(llave.shadow.camera, { left: -1.3, right: 1.3, top: 1.3, bottom: -1.3, near: 0.5, far: 9 });
  llave.shadow.bias = -0.0004; llave.shadow.normalBias = 0.012;
  scene.add(llave, llave.target);
  const contra = new THREE.DirectionalLight('#cfd8ff', 0.7);
  contra.position.set(1.8, 1.2, -1.5);
  scene.add(contra);
  scene.add(new THREE.HemisphereLight('#fff6e8', '#1a1c14', 0.18));
  const destello = new THREE.PointLight('#ffd9a6', 0, 0.9, 2);
  const brillo = new THREE.PointLight('#fff3dc', 0, 3.5, 2);
  scene.add(brillo);

  // ── Geometría
  const raiz = new THREE.Group(); scene.add(raiz);
  const sobre = new THREE.Group(); raiz.add(sobre);

  const uvSobre = (g) => {
    const p = g.attributes.position; const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / W + 0.5; uv[i * 2 + 1] = p.getY(i) / H + 0.5; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  };
  const malla = (g, m, z = 0) => {
    const o = new THREE.Mesh(g, m); o.position.z = z; o.castShadow = true; o.receiveShadow = true;
    desechos.push(g);
    return o;
  };

  const texForro = tx.forro();
  const mForro = material(texForro, { bumpScale: 0.4 });
  const mCarbon = material(tx.bolsillo({ para: datos.para, etiqueta: datos.etiquetaPara }));
  const mSolapa = material(tx.solapa());
  const mDorsoSobre = new THREE.MeshStandardMaterial({ color: tx.COLOR.carbon, roughness: 0.85 }); desechos.push(mDorsoSobre);

  // Fondo: el forro por dentro, carbón por fuera.
  const fondo = malla(uvSobre(new THREE.PlaneGeometry(W, H)), mForro, 0);
  const fondoAtras = malla(new THREE.PlaneGeometry(W, H), mDorsoSobre, -0.001); fondoAtras.rotation.y = Math.PI;
  sobre.add(fondo, fondoAtras);

  // La tarjeta: un pivote que se mueve y la hoja que se mece adentro.
  const tarjeta = new THREE.Group(); tarjeta.position.set(0, -0.035, Z.tarjeta);
  const mOro = new THREE.MeshStandardMaterial({ color: '#caa463', metalness: 1, roughness: 0.28 }); desechos.push(mOro);
  const frente = material(tx.tarjeta({ ella: datos.ella, el: datos.el, monograma: datos.monograma, texto: datos.invitan, fecha: datos.fecha, para: datos.para }), { bumpScale: 0.35, envMapIntensity: 2.6 });
  const atras = material(tx.dorso({ monograma: datos.monograma }), { bumpScale: 0.35 });
  const hoja = malla(new THREE.BoxGeometry(TW, TH, TD), [mOro, mOro, mOro, mOro, frente, atras]);
  tarjeta.add(hoja); sobre.add(tarjeta);

  // El bolsillo: dos hojas laterales y la de abajo encima, cada una con su sombra.
  const forma = (pts, curva) => {
    const s = new THREE.Shape(); s.moveTo(...pts[0]);
    pts.slice(1).forEach((p) => s.lineTo(...p));
    if (curva) s.quadraticCurveTo(...curva);
    s.closePath();
    return uvSobre(new THREE.ShapeGeometry(s, 16));
  };
  const izq = malla(forma([[-W / 2, H / 2], [-W / 2, -H / 2], [0.035, -0.035]]), mCarbon, Z.izq);
  const der = malla(forma([[W / 2, -H / 2], [W / 2, H / 2], [-0.035, -0.035]]), mCarbon, Z.der);
  const abajo = malla(forma([[-W / 2, -H / 2], [W / 2, -H / 2], [0.1, 0.025]], [0, 0.085, -0.1, 0.025]), mCarbon, Z.abajo);
  sobre.add(izq, der, abajo);

  // La solapa: una malla que se dobla en cada cuadro (curvatura de papel, no bisagra rígida).
  const SU = 22; const SS = 30;
  const gSolapa = new THREE.BufferGeometry();
  const nV = (SU + 1) * (SS + 1);
  const posS = new Float32Array(nV * 3); const uvS = new Float32Array(nV * 2); const baseX = new Float32Array(nV); const baseT = new Float32Array(nV);
  for (let j = 0; j <= SS; j++) {
    for (let i = 0; i <= SU; i++) {
      const k = j * (SU + 1) + i; const t = j / SS; const u = (i / SU) * 2 - 1;
      baseX[k] = u * (W / 2) * (1 - t) ** 0.94; baseT[k] = t;
      uvS[k * 2] = baseX[k] / W + 0.5; uvS[k * 2 + 1] = (H / 2 - t * L) / H + 0.5;
    }
  }
  const idx = [];
  for (let j = 0; j < SS; j++) {
    for (let i = 0; i < SU; i++) {
      const a = j * (SU + 1) + i; const b = a + 1; const c = a + SU + 1; const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  gSolapa.setIndex(idx);
  gSolapa.setAttribute('position', new THREE.BufferAttribute(posS, 3));
  gSolapa.setAttribute('uv', new THREE.BufferAttribute(uvS, 2));
  desechos.push(gSolapa);
  const mForroSolapa = material(texForro, { side: THREE.BackSide, bumpScale: 0.4 });
  const solapaFuera = new THREE.Mesh(gSolapa, mSolapa); solapaFuera.castShadow = true; solapaFuera.receiveShadow = true;
  const solapaDentro = new THREE.Mesh(gSolapa, mForroSolapa); solapaDentro.receiveShadow = true;
  mSolapa.shadowSide = THREE.DoubleSide;
  sobre.add(solapaFuera, solapaDentro);

  let ultimoDoblez = -1;
  const doblar = (p) => {
    if (p === ultimoDoblez) return;
    ultimoDoblez = p;
    const th = Math.PI * p;
    const ka = -1.35 * Math.sin(Math.PI * p);
    const zh = THREE.MathUtils.lerp(Z.solapa, 0.0012, THREE.MathUtils.smoothstep(th, Math.PI * 0.4, Math.PI * 0.85));
    for (let k = 0; k < nV; k++) {
      const s = baseT[k] * L;
      let y; let z;
      if (Math.abs(ka) < 1e-4) { y = -s * Math.cos(th); z = s * Math.sin(th); } else {
        y = -(Math.sin(th + ka * s) - Math.sin(th)) / ka;
        z = -(Math.cos(th + ka * s) - Math.cos(th)) / ka;
      }
      posS[k * 3] = baseX[k]; posS[k * 3 + 1] = H / 2 + y; posS[k * 3 + 2] = zh + z;
    }
    gSolapa.attributes.position.needsUpdate = true;
    gSolapa.computeVertexNormals();
    gSolapa.computeBoundingSphere();
  };
  doblar(0);

  // El lacre: cera con borde irregular, partida en dos por una grieta en zigzag.
  const fase = Math.random() * 6;
  const radio = (a) => LACRE_R * (1 + 0.04 * Math.sin(a * 5 + fase) + 0.022 * Math.sin(a * 11 + fase * 2) + 0.012 * Math.sin(a * 23 + 1));
  const borde = (a) => [Math.cos(a) * radio(a), Math.sin(a) * radio(a)];
  const aArriba = Math.PI / 2 - 0.08; const aAbajo = -Math.PI / 2 - 0.05;
  const pA = borde(aArriba); const pB = borde(aAbajo);
  const grieta = [];
  for (let i = 1; i < 7; i++) {
    const t = i / 7;
    grieta.push([THREE.MathUtils.lerp(pA[0], pB[0], t) + (i % 2 ? 1 : -1) * (0.007 + Math.random() * 0.006), THREE.MathUtils.lerp(pA[1], pB[1], t)]);
  }
  const arco = (a0, a1) => { const pts = []; const n = 36; for (let i = 0; i <= n; i++) pts.push(borde(a0 + ((a1 - a0) * i) / n)); return pts; };
  const mitadIzq = [...arco(aArriba, aAbajo + Math.PI * 2), ...[...grieta].reverse()];
  const mitadDer = [...arco(aAbajo, aArriba), ...grieta];
  const texLacre = tx.lacre({ monograma: datos.monograma });
  const uvLacre = (t) => { t.repeat.set(1 / (2 * LACRE_UV), 1 / (2 * LACRE_UV)); t.offset.set(0.5, 0.5); return t; };
  const mLacre = new THREE.MeshPhysicalMaterial({
    map: uvLacre(tex(texLacre.color, { color: true })), roughnessMap: uvLacre(tex(texLacre.orm)), metalnessMap: uvLacre(tex(texLacre.orm)),
    bumpMap: uvLacre(tex(texLacre.relieve)), bumpScale: 3, roughness: 1, metalness: 1, clearcoat: 0.55, clearcoatRoughness: 0.32,
  });
  desechos.push(mLacre);
  const lacre = new THREE.Group(); lacre.position.set(0, H / 2 - L + 0.05, Z.lacre);
  const mitades = [mitadIzq, mitadDer].map((pts) => {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b))), {
      depth: 0.008, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.006, bevelSegments: 5, curveSegments: 1,
    });
    g.computeBoundingBox();
    const centro = new THREE.Vector3(); g.boundingBox.getCenter(centro); centro.z = 0;
    g.translate(-centro.x, -centro.y, 0);
    const m = malla(g, mLacre);
    m.position.copy(centro); m.userData.base = centro.clone();
    lacre.add(m);
    return m;
  });
  destello.position.set(0, 0, 0.12); lacre.add(destello);
  sobre.add(lacre);

  // Chispas de lámina que saltan al partirse el lacre.
  const gChispa = new THREE.PlaneGeometry(0.013, 0.02); desechos.push(gChispa);
  const mChispa = new THREE.MeshStandardMaterial({ color: '#d9b878', metalness: 1, roughness: 0.22, side: THREE.DoubleSide }); desechos.push(mChispa);
  const chispas = new THREE.InstancedMesh(gChispa, mChispa, CHISPAS);
  chispas.position.copy(lacre.position); chispas.frustumCulled = false;
  const datosChispa = Array.from({ length: CHISPAS }, () => {
    const a = Math.random() * Math.PI * 2; const v = 0.7 + Math.random() * 1.5;
    return { v: new THREE.Vector3(Math.cos(a) * v, Math.sin(a) * v * 0.8 + 0.5, 0.4 + Math.random() * 1.4), giro: new THREE.Vector3(Math.random() * 14, Math.random() * 14, Math.random() * 6), fase: Math.random() * 6, escala: 0.6 + Math.random() * 0.8 };
  });
  sobre.add(chispas);

  // Sombra blanda sobre la "mesa", detrás del sobre.
  const mSombra = new THREE.MeshBasicMaterial({ map: tex(tx.sombra()), transparent: true, depthWrite: false, opacity: 0.8 });
  const gSombra = new THREE.PlaneGeometry(2.6, 1.9);
  desechos.push(mSombra, gSombra);
  const sombra = new THREE.Mesh(gSombra, mSombra); scene.add(sombra);

  // ── Estado animable
  const pose = { y: 0, z: 0, rx: 0, ry: 0, rz: 0, quieto: 0 };
  const st = { solapa: 0, sube: 0, rompe: -1, sombra: 1, giro: 0, flota: 0, aprieta: 1 };
  const ajuste = { d: 5, dc: 3 };
  const ptr = { x: 0, y: 0 }; const meta = { x: 0, y: 0 };

  const ajustar = () => {
    const w = contenedor.clientWidth; const h = contenedor.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tan = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    ajuste.d = Math.max(W / (0.8 * tan * camera.aspect), H / (0.38 * tan));
    ajuste.dc = Math.max(TW / (0.86 * tan * camera.aspect), TH / (0.56 * tan));
    camera.position.set(0, 0, ajuste.d); camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  };
  ajustar();
  const ro = new ResizeObserver(ajustar); ro.observe(contenedor);

  const fino = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
  const mover = (e) => { meta.x = e.clientX / window.innerWidth - 0.5; meta.y = e.clientY / window.innerHeight - 0.5; };
  if (fino) window.addEventListener('pointermove', mover);

  const muñeco = new THREE.Object3D();
  const romper = (t) => {
    const roto = t >= 0;
    mitades.forEach((m, i) => {
      const lado = i ? 1 : -1;
      if (!roto) { m.position.copy(m.userData.base); m.rotation.set(0, 0, 0); return; }
      const b = m.userData.base;
      m.position.set(b.x + lado * (0.05 * t + 0.32 * t), b.y + 0.55 * t - 2.4 * t * t, b.z + 0.55 * t);
      m.rotation.set(-2.2 * t, lado * 1.4 * t, lado * 2.6 * t);
    });
    const k = 2.4; const g = -1.6;
    for (let i = 0; i < CHISPAS; i++) {
      const c = datosChispa[i];
      if (!roto) { muñeco.scale.setScalar(0); } else {
        const e = (1 - Math.exp(-k * t)) / k;
        muñeco.position.set(c.v.x * e + Math.sin(t * 7 + c.fase) * 0.02, c.v.y * e + (g / k) * (t - e), c.v.z * e);
        muñeco.rotation.set(c.giro.x * t, c.giro.y * t, c.giro.z * t);
        muñeco.scale.setScalar(c.escala * (1 - THREE.MathUtils.smoothstep(t, 0.7, 1.5)));
      }
      muñeco.updateMatrix();
      chispas.setMatrixAt(i, muñeco.matrix);
    }
    chispas.instanceMatrix.needsUpdate = true;
  };
  romper(-1);

  const reloj = new THREE.Clock();
  let cuadro = 0;
  const bucle = () => {
    const t = reloj.getElapsedTime();
    ptr.x += (meta.x - ptr.x) * 0.05; ptr.y += (meta.y - ptr.y) * 0.05;
    const q = pose.quieto;
    raiz.position.set(0, pose.y + q * Math.sin(t * 1.1) * 0.02, pose.z);
    raiz.rotation.set(
      pose.rx + q * (Math.sin(t * 0.8) * 0.035 + ptr.y * 0.24),
      pose.ry + q * (Math.sin(t * 0.55) * 0.06 + ptr.x * 0.34),
      pose.rz + q * Math.sin(t * 0.45) * 0.014,
    );
    lacre.scale.setScalar(st.aprieta);
    doblar(st.solapa);
    romper(st.rompe);
    if (tarjeta.parent === sobre) tarjeta.position.y = -0.035 + st.sube;
    hoja.rotation.set(0, st.giro, 0);
    hoja.position.y = st.flota * Math.sin(t * 1.3) * 0.012;
    sombra.position.set(0.08, -0.14 + pose.y * 0.6, pose.z - 0.42);
    mSombra.opacity = 0.8 * st.sombra;
    renderer.render(scene, camera);
    cuadro = requestAnimationFrame(bucle);
  };
  bucle();

  // Llegada: cae girando desde arriba y se asienta.
  const llegada = gsap.timeline({ delay: 0.15 });
  llegada.from(pose, { y: 0.9, z: -2.6, rx: 1.15, ry: -0.6, rz: -0.32, duration: 2.3, ease: 'expo.out' }, 0)
    .from(st, { sombra: 0, duration: 1.6, ease: 'power2.out' }, 0.3)
    .to(pose, { quieto: 1, duration: 1.6, ease: 'sine.inOut' }, 1.2);

  let tl = null;
  const abrir = () => new Promise((listo) => {
    llegada.progress(1);
    const zFinal = ajuste.d - ajuste.dc;
    tl = gsap.timeline({ onComplete: listo });
    if (import.meta.env.DEV) window.__sobre = tl;
    tl.to(pose, { quieto: 0, duration: 0.6, ease: 'power2.out' }, 0)
      // 1. El lacre se aprieta… y se parte, con destello y chispas.
      .to(st, { aprieta: 0.9, duration: 0.14, ease: 'power2.out' }, 0)
      .to(st, { aprieta: 1, duration: 0.3, ease: 'power2.out' }, 0.14)
      .fromTo(st, { rompe: 0 }, { rompe: 1.6, duration: 1.6, ease: 'none', immediateRender: false }, 0.14)
      .to(destello, { intensity: 0.9, duration: 0.06, ease: 'power2.out' }, 0.14)
      .to(destello, { intensity: 0, duration: 0.5, ease: 'power2.out' }, 0.2)
      // 2. El sobre se echa atrás y baja; la solapa se curva y se abre.
      .to(pose, { y: -0.34, z: -0.25, rx: -0.16, ry: 0, rz: 0, duration: 1.6, ease: 'power3.inOut' }, 0.3)
      .to(st, { solapa: 1, duration: 1.2, ease: 'power2.inOut' }, 0.36)
      // 3. La tarjeta sube del bolsillo con un asentamiento de papel.
      .to(st, { sube: 0.985, duration: 1.15, ease: 'back.out(1.05)' }, 1.3)
      // 4. Vuela al centro de la cámara mientras el sobre cae fuera de cuadro.
      .call(() => { scene.attach(tarjeta); }, null, 2.35)
      .to(tarjeta.position, { x: 0, y: 0, z: zFinal, duration: 1.45, ease: 'power3.inOut' }, 2.35)
      .to(tarjeta.rotation, { x: 0, y: 0, z: 0, duration: 1.45, ease: 'power3.inOut' }, 2.35)
      .to(st, { giro: 0.06, duration: 1.45, ease: 'power2.inOut' }, 2.35)
      .to(pose, { y: -3.1, z: -1.2, rx: 0.9, duration: 1.3, ease: 'power2.in' }, 2.45)
      .to(st, { sombra: 0, duration: 0.8, ease: 'power1.in' }, 2.45)
      // 5. Un brillo de luz pasa por la lámina de oro; la tarjeta respira.
      .to(st, { flota: 1, duration: 1, ease: 'sine.inOut' }, 3.6)
      .to(st, { giro: -0.03, duration: 1.6, ease: 'sine.inOut' }, 3.8)
      .fromTo(brillo.position, { x: -1.3, y: 0.35, z: zFinal + 0.55 }, { x: 1.3, y: -0.15, z: zFinal + 0.55, duration: 1.5, ease: 'power1.inOut', immediateRender: false }, 3.6)
      .fromTo(brillo, { intensity: 0 }, { intensity: 3.2, duration: 0.5, ease: 'power1.out', yoyo: true, repeat: 1, repeatDelay: 0.5, immediateRender: false }, 3.6)
      .to({}, { duration: 0.3 }, 4.8);
  });

  const salir = () => {
    tl?.kill();
    gsap.to(tarjeta.position, { z: '+=0.5', duration: 0.8, ease: 'power2.in' });
  };

  const destruir = () => {
    cancelAnimationFrame(cuadro);
    llegada.kill(); tl?.kill(); gsap.killTweensOf([pose, st, tarjeta.position, tarjeta.rotation, destello, brillo, brillo.position]);
    ro.disconnect();
    window.removeEventListener('pointermove', mover);
    chispas.dispose();
    desechos.forEach((d) => d.dispose?.());
    pmrem.dispose();
    renderer.dispose();
    canvas.remove();
    if (import.meta.env.DEV) delete window.__sobre;
  };

  return { abrir, salir, destruir };
}
