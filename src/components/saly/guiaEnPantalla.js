// Vive en components y no en el núcleo: lee el DOM (gate:nucleo).
/* ── Guía en pantalla (punto 1) ────────────────────────────────────────────
 * Una pregunta frecuente con `guia` se puede HACER con Saly al lado: marca el
 * botón o el campo real de cada paso y avanza cuando la persona lo toca. Se
 * busca por el RÓTULO que se ve (o su `aria-label`), no por un atributo
 * puesto a mano: así la guía no exige tocar los componentes compartidos, y si
 * un botón cambia de nombre el paso simplemente espera en vez de marcar otro.
 * Entre varios iguales gana el último visible: el diálogo de arriba está al
 * final del documento. */
const normal = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const sinMarcas = (t) => normal(t).replace(/\s+/g, ' ').trim();
const visible = (el) => !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

export function buscarObjetivo(paso, raiz) {
    if (!paso || typeof document === 'undefined') return null;
    const propio = (el) => raiz?.contains(el);
    if (paso.boton) {
        const quiero = paso.boton.map(sinMarcas);
        const todos = [...document.querySelectorAll('button, [role="button"], a[href]')]
            .filter((el) => !propio(el) && visible(el) && !el.disabled);
        for (const q of quiero) {
            const hallados = todos.filter((el) => sinMarcas(el.getAttribute('aria-label')) === q || sinMarcas(el.innerText) === q);
            if (hallados.length) return hallados[hallados.length - 1];
        }
        return null;
    }
    if (paso.campo) {
        const q = sinMarcas(paso.campo);
        const labels = [...document.querySelectorAll('label')].filter((el) => !propio(el) && visible(el) && sinMarcas(el.innerText).startsWith(q));
        const l = labels[labels.length - 1];
        return l ? (l.parentElement || l) : null;
    }
    return null;
}
