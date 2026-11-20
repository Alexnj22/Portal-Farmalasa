// La pluma que escribe las piezas del diseñador (Save the Date, ornamento).
const NS = 'http://www.w3.org/2000/svg';

/**
 * La pluma: una sola punta encendida recorre los trazos uno detrás de otro,
 * de izquierda a derecha y a velocidad pareja (cada trazo dura lo que mide),
 * dejando la línea dorada y soltando chispas de luz. La usan el Save the
 * Date de la portada y el ornamento del cierre. Devuelve la limpieza.
 */
export function escribir(svg, { selector, elementos, escritura: ESCRITURA = 1900, inicio: INICIO = 250, cadencia = 26, ordenar = (a, b) => a.x - b.x }) {
  const trazos = [...(elementos || svg.querySelectorAll(selector))]
    .map((p) => { const b = p.getBBox(); return { p, x: b.x, fin: b.x + b.width, largo: p.getTotalLength() }; })
    .sort(ordenar);
  const total = trazos.reduce((s, t) => s + t.largo, 0) || 1;
  let t = INICIO;
  trazos.forEach((tr) => {
    tr.dura = Math.max(90, ESCRITURA * (tr.largo / total));
    tr.desde = t;
    t += tr.dura * 0.92; // se encadenan, apenas montados
    // Largos reales (pathLength="1" deja restos visibles en trazos complejos).
    const l = (tr.largo + 2).toFixed(1);
    tr.p.style.strokeDasharray = `${l} ${l}`;
    tr.anim = tr.p.animate([{ strokeDashoffset: l }, { strokeDashoffset: 0 }],
      { duration: tr.dura, delay: tr.desde, easing: 'cubic-bezier(.35, 0, .65, 1)', fill: 'both' });
  });
  const fin = t + 120;

  const chispas = document.createElementNS(NS, 'g');
  chispas.setAttribute('class', 'std-chispas');
  const punta = document.createElementNS(NS, 'circle');
  punta.setAttribute('class', 'std-punta');
  punta.setAttribute('r', '3.2');
  svg.appendChild(chispas);
  svg.appendChild(punta);

  const t0 = performance.now();
  let ultima = 0;
  let cuadro = 0;
  const paso = (ahora) => {
    const e = ahora - t0;
    if (e > fin) { punta.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: 'forwards' }); return; }
    const tr = trazos.findLast((x) => e >= x.desde) || trazos[0];
    const q = Math.min(1, Math.max(0, (e - tr.desde) / tr.dura));
    // La misma curva que el trazo, para que la punta vaya justo en la tinta.
    const k = tr.anim.effect.getComputedTiming().progress ?? q;
    const pt = tr.p.getPointAtLength(k * tr.largo);
    punta.setAttribute('cx', pt.x.toFixed(1));
    punta.setAttribute('cy', pt.y.toFixed(1));
    punta.style.opacity = e < INICIO ? '0' : '1';
    if (e > INICIO && ahora - ultima > cadencia) {
      ultima = ahora;
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', pt.x.toFixed(1)); c.setAttribute('cy', pt.y.toFixed(1));
      c.setAttribute('r', (0.7 + Math.random() * 1.4).toFixed(2));
      chispas.appendChild(c);
      const dx = (Math.random() - 0.5) * 26; const dy = 6 + Math.random() * 22;
      c.animate([{ transform: 'translate(0,0)', opacity: 0.95 }, { transform: `translate(${dx}px, ${dy}px)`, opacity: 0 }],
        { duration: 650 + Math.random() * 500, easing: 'cubic-bezier(.2, .7, .3, 1)', fill: 'forwards' }).onfinish = () => c.remove();
    }
    cuadro = requestAnimationFrame(paso);
  };
  cuadro = requestAnimationFrame(paso);
  return () => { cancelAnimationFrame(cuadro); trazos.forEach((x) => x.anim.cancel()); chispas.remove(); punta.remove(); };
}


/**
 * Lleva un número de `desde` a `hasta` cuadro a cuadro y se lo pasa a `poner`.
 * Para máscaras: Safari no aplica una máscara CSS a un elemento DENTRO de un
 * SVG, así que esas piezas usan un <mask> de SVG y esto le mueve el
 * rectángulo; y en HTML, Safari tampoco repinta una máscara animada por CSS
 * con @property. Escrito en cada cuadro, anda en todos.
 */
export function animarValor(poner, { desde, hasta, duracion, retraso = 0 }) {
  const curva = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  poner(desde);
  const t0 = performance.now() + retraso;
  let cuadro = 0;
  const paso = (ahora) => {
    const q = Math.min(1, Math.max(0, (ahora - t0) / duracion));
    poner(desde + (hasta - desde) * curva(q));
    if (q < 1) cuadro = requestAnimationFrame(paso);
  };
  cuadro = requestAnimationFrame(paso);
  return () => cancelAnimationFrame(cuadro);
}

/** animarValor sobre una propiedad personalizada de CSS (p. ej. '--barrido'). */
export const barrer = (el, prop, opciones, unidad = '%') =>
  animarValor((v) => el.style.setProperty(prop, `${v.toFixed(2)}${unidad}`), opciones);
