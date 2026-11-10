import { useRef } from 'react';

/**
 * Plano del salón. Con `editable`, las mesas se arrastran (mouse o dedo) y
 * `alMover(id, x, y)` recibe la posición en % al soltar.
 * ocupacion: { [mesaId]: n }   resaltar: id de la mesa del invitado
 */
export default function PlanoMesas({ mesas, ocupacion = {}, seleccionada, alElegir, editable, alMover, resaltar }) {
  const caja = useRef(null);

  function arrastrar(e, m) {
    if (!editable) return;
    e.preventDefault();
    const el = e.currentTarget;
    const r = caja.current.getBoundingClientRect();
    let x = m.x; let y = m.y; let movio = false;
    const mover = (ev) => {
      movio = true;
      x = Math.min(96, Math.max(4, ((ev.clientX - r.left) / r.width) * 100));
      y = Math.min(95, Math.max(5, ((ev.clientY - r.top) / r.height) * 100));
      el.style.left = `${x}%`; el.style.top = `${y}%`;
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      if (movio) alMover?.(m.id, Math.round(x * 10) / 10, Math.round(y * 10) / 10);
      else alElegir?.(m.id);
    };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  }

  return (
    <div className="plano" ref={caja}>
      {mesas.map((m) => {
        const n = ocupacion[m.id] || 0;
        const clase = [
          'mesa', m.forma,
          n > m.capacidad ? 'excedida' : n === m.capacidad ? 'llena' : '',
          seleccionada === m.id ? 'sel' : '',
          resaltar === m.id ? 'mia' : '',
        ].join(' ');
        return (
          <div
            key={m.id} className={clase} style={{ left: `${m.x}%`, top: `${m.y}%`, cursor: editable ? 'grab' : alElegir ? 'pointer' : 'default' }}
            onPointerDown={(e) => arrastrar(e, m)}
            onClick={() => !editable && alElegir?.(m.id)}
            title={m.nombre}
          >
            <div><b>{m.nombre}</b>{!resaltar && <div>{n}/{m.capacidad}</div>}</div>
          </div>
        );
      })}
    </div>
  );
}
