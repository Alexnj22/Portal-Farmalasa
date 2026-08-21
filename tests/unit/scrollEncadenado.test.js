import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { permitirEscapeDelScroll } from '../../src/utils/scrollEncadenado';

// Estas pruebas anclan la única regla que distingue los DOS reportes opuestos
// del usuario sobre el scroll del tablero (ver el encabezado del módulo):
//
//   14-ago · «si scroleo y se acaba el scroll interno, hace scroll externo»
//   20-ago · «solo escrolea internamente, si quiero escrolear todo debo salir»
//   21-ago · «si hago scroll en el body y paso por un widget, también hace
//             scroll, no debería»
//
// La diferencia entre uno y otro NO es la posición del scroller: es si el gesto
// EMPEZÓ ahí. Un test que sólo mire el borde da verde con las dos versiones
// rotas, así que lo que se comprueba es la continuación del gesto.
//
// El del 21 no se ve en `overscrollBehavior` —el robo no pasa en un borde—:
// se ve en el atributo con el que la rejilla saca a sus baldosas del
// hit-testing mientras el gesto es de la página.

let raiz, baldosa, limpiar;

/** Un scroller con medidas reales: jsdom no hace layout. */
function medidas({ alto, contenido, arriba }) {
  Object.defineProperty(baldosa, 'clientHeight', { value: alto,       configurable: true });
  Object.defineProperty(baldosa, 'scrollHeight', { value: contenido,  configurable: true });
  baldosa.scrollTop = arriba;
}

/** Una rueda con el reloj puesto a mano: el hueco entre eventos ES la regla. */
function rodar({ deltaY, enMs, sobre = baldosa }) {
  const e = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: false });
  Object.defineProperty(e, 'timeStamp', { value: enMs });
  sobre.dispatchEvent(e);
  return baldosa.style.overscrollBehavior;
}

/** ¿La rejilla se quedó con el gesto? (o sea: sus baldosas no reciben rueda) */
const laPaginaMandaAhora = () => raiz.hasAttribute('data-gesto-de-la-pagina');

beforeEach(() => {
  raiz = document.createElement('div');
  baldosa = document.createElement('div');
  baldosa.className = 'overflow-y-auto overscroll-contain';
  raiz.appendChild(baldosa);
  document.body.appendChild(raiz);
  limpiar = permitirEscapeDelScroll(raiz);
});

afterEach(() => { limpiar?.(); raiz.remove(); });

describe('permitirEscapeDelScroll', () => {
  it('contiene mientras la baldosa tenga lista por recorrer', () => {
    medidas({ alto: 100, contenido: 500, arriba: 200 });
    expect(rodar({ deltaY: 50, enMs: 1000 })).toBe('contain');
  });

  it('deja pasar el gesto que EMPIEZA en el borde de abajo (reporte del 20-ago)', () => {
    medidas({ alto: 100, contenido: 500, arriba: 400 });
    expect(rodar({ deltaY: 50, enMs: 1000 })).toBe('auto');
  });

  it('deja pasar hacia arriba con la lista en su tope', () => {
    medidas({ alto: 100, contenido: 500, arriba: 0 });
    expect(rodar({ deltaY: -50, enMs: 1000 })).toBe('auto');
  });

  it('desde el tope, hacia ABAJO todavía contiene: hay lista que recorrer', () => {
    medidas({ alto: 100, contenido: 500, arriba: 0 });
    expect(rodar({ deltaY: 50, enMs: 1000 })).toBe('contain');
  });

  it('NO deja pasar cuando la lista se acaba a mitad del gesto (reporte del 14-ago)', () => {
    medidas({ alto: 100, contenido: 500, arriba: 200 });
    expect(rodar({ deltaY: 50, enMs: 1000 })).toBe('contain');
    // el mismo gesto sigue y la lista llega a su fin
    medidas({ alto: 100, contenido: 500, arriba: 400 });
    expect(rodar({ deltaY: 50, enMs: 1050 })).toBe('contain');
    expect(rodar({ deltaY: 50, enMs: 1100 })).toBe('contain');
  });

  // El que se llevó puesta la primera versión: reponer `contain` en cada evento
  // de continuación deja el escape sin efecto, porque una rueda emite decenas de
  // eventos por empujón y el segundo ya volvía a trabar el gesto.
  it('el gesto que empezó en el borde sigue pasando en sus eventos siguientes', () => {
    medidas({ alto: 100, contenido: 500, arriba: 400 });
    expect(rodar({ deltaY: 50, enMs: 1000 })).toBe('auto');
    expect(rodar({ deltaY: 50, enMs: 1016 })).toBe('auto');
    expect(rodar({ deltaY: 50, enMs: 1032 })).toBe('auto');
  });

  it('y el gesto SIGUIENTE, con la lista ya en el fin, sí pasa', () => {
    medidas({ alto: 100, contenido: 500, arriba: 400 });
    rodar({ deltaY: 50, enMs: 1000 });
    expect(rodar({ deltaY: 50, enMs: 1000 + 201 })).toBe('auto');
  });

  it('una baldosa sin nada que recorrer nunca retiene el gesto', () => {
    medidas({ alto: 300, contenido: 300, arriba: 0 });
    expect(rodar({ deltaY: 50, enMs: 1000 })).toBe('auto');
  });

  it('no toca lo que está fuera de la rejilla', () => {
    const fuera = document.createElement('div');
    fuera.className = 'overscroll-contain';
    document.body.appendChild(fuera);
    const e = new WheelEvent('wheel', { deltaY: 50, bubbles: true });
    fuera.dispatchEvent(e);
    expect(fuera.style.overscrollBehavior).toBe('');
    fuera.remove();
  });

  it('la limpieza suelta el oyente', () => {
    medidas({ alto: 100, contenido: 500, arriba: 400 });
    limpiar();
    limpiar = null;
    expect(rodar({ deltaY: 50, enMs: 1000 })).toBe('');
  });

  // ── El dueño del gesto (reporte del 21-ago) ────────────────────────────
  // Esto NO se ve en `overscrollBehavior`: el robo no ocurre en un borde, sino
  // porque el navegador vuelve a elegir a quién scrollear en cada evento
  // mirando qué hay bajo el puntero — y el puntero está quieto, es la página la
  // que le mete la baldosa debajo. Lo que se ancla es que la rejilla se quede
  // con el gesto mientras dure.

  it('el gesto que empieza FUERA de una baldosa es de la página', () => {
    const fondo = document.createElement('div');
    raiz.appendChild(fondo);
    medidas({ alto: 100, contenido: 500, arriba: 200 });   // baldosa con recorrido
    rodar({ deltaY: 50, enMs: 1000, sobre: fondo });
    expect(laPaginaMandaAhora()).toBe(true);
  });

  it('y la baldosa que le pasa por debajo NO se lo quita', () => {
    const fondo = document.createElement('div');
    raiz.appendChild(fondo);
    medidas({ alto: 100, contenido: 500, arriba: 200 });
    rodar({ deltaY: 50, enMs: 1000, sobre: fondo });
    // el gesto sigue y ahora los eventos caen sobre la baldosa
    expect(rodar({ deltaY: 50, enMs: 1050 })).toBe('');   // no la hizo dueña
    expect(laPaginaMandaAhora()).toBe(true);
  });

  it('la baldosa en su tope cede el gesto ENTERO, no sólo el borde', () => {
    medidas({ alto: 100, contenido: 500, arriba: 400 });
    rodar({ deltaY: 50, enMs: 1000 });
    expect(laPaginaMandaAhora()).toBe(true);
  });

  it('la baldosa con recorrido se queda con el gesto', () => {
    medidas({ alto: 100, contenido: 500, arriba: 200 });
    rodar({ deltaY: 50, enMs: 1000 });
    expect(laPaginaMandaAhora()).toBe(false);
  });

  it('la marca se suelta al terminar el gesto — en reposo apagaría el clic', () => {
    vi.useFakeTimers();
    try {
      const fondo = document.createElement('div');
      raiz.appendChild(fondo);
      rodar({ deltaY: 50, enMs: 1000, sobre: fondo });
      expect(laPaginaMandaAhora()).toBe(true);
      vi.advanceTimersByTime(199);
      expect(laPaginaMandaAhora()).toBe(true);   // el gesto todavía puede seguir
      vi.advanceTimersByTime(2);
      expect(laPaginaMandaAhora()).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('un gesto NUEVO sobre una baldosa con recorrido se la devuelve', () => {
    vi.useFakeTimers();
    try {
      const fondo = document.createElement('div');
      raiz.appendChild(fondo);
      medidas({ alto: 100, contenido: 500, arriba: 200 });
      rodar({ deltaY: 50, enMs: 1000, sobre: fondo });
      vi.advanceTimersByTime(201);                 // el gesto terminó
      expect(rodar({ deltaY: 50, enMs: 1300 })).toBe('contain');
      expect(laPaginaMandaAhora()).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('la limpieza también suelta la marca', () => {
    const fondo = document.createElement('div');
    raiz.appendChild(fondo);
    rodar({ deltaY: 50, enMs: 1000, sobre: fondo });
    expect(laPaginaMandaAhora()).toBe(true);
    limpiar();
    limpiar = null;
    expect(laPaginaMandaAhora()).toBe(false);
  });
});
