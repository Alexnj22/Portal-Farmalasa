import { useCallback, useEffect, useRef, useState } from 'react';
import { kioscoCajaCola, kioscoCajaEstado } from '@nucleo/data/kiosco';
import { estadoDeCaja } from '@nucleo/data/bolsas';
import { fetchPreventasDeSala } from '@nucleo/data/preventas';
import { colaDeMuestra, esDemo } from './demoDelKiosco';

// La cola del kiosco de caja: leerla y describirla. Sin nada de cómo se ve,
// para que la usen los dos diseños del kiosco (2026-11-17).

const CADA_MS = 10_000;
export const MAX_RENGLONES = 3;

export const PAGO = { tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Crédito', cheque: 'Cheque' };

export function minutosDesde(fecha, ahora) {
    const t = fecha ? new Date(fecha).getTime() : NaN;
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.floor((ahora - t) / 60_000));
}

export function esperaTexto(min) {
    if (min == null) return '';
    if (min < 1) return 'recién llegada';
    if (min < 60) return `espera ${min} min`;
    const h = Math.floor(min / 60);
    return `espera ${h} h ${min % 60} min`;
}

// Cuánto lleva esperando, con color: es un cliente parado en el mostrador.
export function tonoDeEspera(min) {
    if (min == null || min < 5) return 'success';
    return min < 10 ? 'warning' : 'danger';
}

export function resumenDeProductos(renglones) {
    if (!renglones.length) return '';
    const nombres = renglones.slice(0, MAX_RENGLONES).map((r) => `${Number(r.cantidad)}× ${r.nombre}`);
    const sobran = renglones.length - MAX_RENGLONES;
    return sobran > 0 ? `${nombres.join(' · ')} · y ${sobran} más` : nombres.join(' · ');
}

/**
 * Se relee cada 10 s mientras la pestaña está a la vista. Una lectura que
 * falla NO vacía la lista: deja la última y lo dice, porque una cola vacía por
 * un corte de internet se leería como «no hay nada que cobrar».
 */
/**
 * En el portal (sin equipo de kiosco) la cola sale de las preventas de la
 * sucursal, con la sesión de quien mira. Trae la venta entera: el cobro abre
 * sin otra lectura.
 */
async function colaDeSala(sala) {
    try {
        const filas = await fetchPreventasDeSala(sala, 2);
        const vivas = filas.filter((p) => ['viva', 'sin_enlace', 'enviando'].includes(p.estado))
            .sort((a, b) => String(a.enviada_at ?? a.created_at).localeCompare(String(b.enviada_at ?? b.created_at)));
        return {
            ok: true,
            cola: vivas.map((p) => ({
                id: p.id, referencia: p.externo_ref, codigo: p.venta?.codigo ?? p.codigo, estado: p.estado, origen: 'directa', total: p.total,
                enviada_at: p.enviada_at ?? p.created_at, documento: p.venta?.documento, pago: p.venta?.pago,
                puntos: Number(p.venta?.puntos) || 0, cliente: p.venta?.cliente?.generico ? null : p.cliente,
                vendedor_id: p.enviada_por, vendedor: p.vendedor, venta: p.venta, customer_id: p.customer_id,
                renglones: (p.venta?.renglones ?? []).map((r) => ({ nombre: r.nombre, cantidad: r.cantidad, subtotal: r.subtotal })),
            })),
        };
    } catch {
        return { ok: false };
    }
}

// ── Aviso con sonido al llegar una preventa (usuario, 2026-11-18: «sonido
// bonito»). Dos notas suaves y cortas, hechas con el sintetizador del
// navegador: sin archivo que descargar. El navegador sólo deja sonar después
// de un primer toque en la página; antes de eso, calla sin error.
let audio = null;
function contexto() {
    if (typeof window === 'undefined') return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audio) audio = new AC();
    return audio;
}
if (typeof window !== 'undefined') {
    // El primer toque «despierta» el audio, para que el aviso pueda sonar luego.
    window.addEventListener('pointerdown', () => { try { contexto()?.resume?.(); } catch { /* sin audio */ } }, { once: true, capture: true });
}
export function sonarLlegada() {
    try {
        const ac = contexto();
        if (!ac || ac.state !== 'running') return;
        const t0 = ac.currentTime + 0.02;
        // Mi y La agudos (campanita), con caída exponencial.
        [[659.25, 0], [880, 0.16]].forEach(([f, d]) => {
            const o = ac.createOscillator();
            const g = ac.createGain();
            o.type = 'sine';
            o.frequency.value = f;
            g.gain.setValueAtTime(0.0001, t0 + d);
            g.gain.exponentialRampToValueAtTime(0.22, t0 + d + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.9);
            o.connect(g).connect(ac.destination);
            o.start(t0 + d);
            o.stop(t0 + d + 1);
        });
    } catch { /* sin audio: el aviso es la lista */ }
}

/** Las preventas que no estaban en la lectura anterior (la primera lectura no avisa). */
export function llegadasNuevas(antes, ahora) {
    if (antes == null) return [];
    return (ahora ?? []).filter((p) => p.estado !== 'enviando' && !antes.has(p.id));
}

export function useColaDeCaja({ sala = null } = {}) {
    const [cola, setCola] = useState(null);
    const [problema, setProblema] = useState(null);
    const [leyendo, setLeyendo] = useState(false);
    const [ahora, setAhora] = useState(() => Date.now());
    const vistas = useRef(null);

    const leer = useCallback(async () => {
        if (esDemo()) { setCola(colaDeMuestra()); setProblema(null); setAhora(Date.now()); return; }
        setLeyendo(true);
        const r = sala ? await colaDeSala(sala) : await kioscoCajaCola();
        setLeyendo(false);
        setAhora(Date.now());
        if (r.ok) {
            if (llegadasNuevas(vistas.current, r.cola).length) sonarLlegada();
            vistas.current = new Set(r.cola.filter((p) => p.estado !== 'enviando').map((p) => p.id));
            setCola(r.cola);
            setProblema(null);
        } else {
            setProblema(r.motivo === 'NO_ES_CAJA'
                ? 'Este equipo es un marcador. La cola sólo se ve en el kiosco de caja.'
                : r.networkError ? 'Sin conexión. Muestra la última lista.' : 'No se pudo leer la cola. Intenta de nuevo.');
            setCola((c) => c ?? []);
        }
    }, [sala]);

    useEffect(() => {
        // La primera lectura sale en el próximo tick, no dentro del efecto.
        const primera = setTimeout(leer, 0);
        const id = setInterval(() => { if (document.visibilityState === 'visible') leer(); }, CADA_MS);
        // Al volver a la pestaña se lee en el acto: la lista no espera 10 s vieja.
        const alVolver = () => { if (document.visibilityState === 'visible') leer(); };
        document.addEventListener('visibilitychange', alVolver);
        return () => { clearTimeout(primera); clearInterval(id); document.removeEventListener('visibilitychange', alVolver); };
    }, [leer]);

    return { cola, problema, leyendo, ahora, leer };
}

// ── Lo que toca ahora (pedido del usuario, 2026-11-17) ───────────────────
// «Que sea inteligente: si no hay apertura, que salga para hacerlo.» El
// estado de la caja se lee sin montos: el inicio del kiosco no tiene sesión.

// 20 s: con 60, el inicio seguía diciendo «la caja no está abierta» un minuto
// después de abrirla, y el botón invitaba a abrirla otra vez (2026-11-18).
const ESTADO_CADA_MS = 20_000;

export function useEstadoDeCaja({ sala = null } = {}) {
    const [estado, setEstado] = useState(null);
    const leer = useCallback(async () => {
        if (esDemo()) { const e = { abierta: false, turno_corriendo: false, cerrado: false, cortes: 0 }; setEstado(e); return e; }
        if (sala) {
            const r = await estadoDeCaja(sala);
            if (r?.error) return null;
            const e = {
                abierta: Boolean(r.abierta), turno: r.turno ?? null, turno_corriendo: Boolean(r.turno_corriendo),
                cerrado: (r.cortes ?? []).some((c) => c.tipo === 'Z'),
                cortes: (r.cortes ?? []).filter((c) => c.tipo !== 'Z').length,
            };
            setEstado(e);
            return e;
        }
        const r = await kioscoCajaEstado();
        if (r.ok) { setEstado(r.estado); return r.estado; }
        return null;
    }, [sala]);

    useEffect(() => {
        const primera = setTimeout(leer, 0);
        const id = setInterval(() => { if (document.visibilityState === 'visible') leer(); }, ESTADO_CADA_MS);
        const alVolver = () => { if (document.visibilityState === 'visible') leer(); };
        document.addEventListener('visibilitychange', alVolver);
        return () => { clearTimeout(primera); clearInterval(id); document.removeEventListener('visibilitychange', alVolver); };
    }, [leer]);

    return { estado, leer };
}

const ESPERA_LARGA_MIN = 10;

/**
 * Las sugerencias del inicio, de la más urgente a la menos. Cada una:
 * `{ clave, tono: 'warning'|'info'|'success', titulo, detalle, boton, ir }`,
 * con `ir` = `{ dialogo: 'abrir' }` (a Caja con ese diálogo), `{ vista: 'caja' }`
 * o `{ ticket: id }` (cobrar ese ticket).
 */
export function queToca({ estado, cola, ahora }) {
    const out = [];
    const vivas = (cola ?? []).filter((p) => p.estado !== 'enviando');
    const masVieja = vivas[0] ?? null;
    const espera = masVieja ? (minutosDesde(masVieja.enviada_at, ahora) ?? 0) : 0;

    if (estado && !estado.abierta && !estado.cerrado) {
        out.push({
            clave: 'abrir', tono: 'warning', titulo: 'La caja no está abierta',
            detalle: vivas.length ? `Hay ${vivas.length} por cobrar. Ábrela para empezar.` : 'Ábrela para empezar a cobrar.',
            boton: 'Abrir la caja', ir: { dialogo: 'abrir' },
        });
    } else if (estado?.abierta && !estado.turno_corriendo) {
        out.push({
            clave: 'turno', tono: 'warning', titulo: 'El turno no ha empezado',
            detalle: 'La caja está abierta pero sin turno. Inícialo para cobrar.',
            boton: 'Ir a la caja', ir: { vista: 'caja' },
        });
    } else if (estado?.cerrado) {
        out.push({
            clave: 'cerrado', tono: 'info', titulo: 'El cierre del día ya está hecho',
            detalle: 'La caja de hoy ya se cerró.', boton: 'Ver la caja', ir: { vista: 'caja' },
        });
    }

    // Una preventa que lleva rato esperando es un cliente parado: se avisa
    // aunque la caja no esté lista (usuario, 2026-11-18).
    const largas = vivas.filter((p) => (minutosDesde(p.enviada_at, ahora) ?? 0) >= ESPERA_LARGA_MIN).length;
    if (masVieja && (espera >= ESPERA_LARGA_MIN || (estado?.abierta && estado.turno_corriendo))) {
        out.push(espera >= ESPERA_LARGA_MIN ? {
            clave: 'espera', tono: 'warning', titulo: `La #${masVieja.referencia} lleva ${espera} min esperando`,
            detalle: largas > 1 ? `${largas} preventas llevan más de ${ESPERA_LARGA_MIN} min sin cobrar.`
                : vivas.length > 1 ? `Y ${vivas.length - 1} más en la cola.` : 'Es la única en la cola.',
            boton: `Cobrar la #${masVieja.referencia}`, ir: { ticket: masVieja.id },
        } : {
            clave: 'cola', tono: 'info', titulo: vivas.length === 1 ? '1 venta espera cobro' : `${vivas.length} ventas esperan cobro`,
            detalle: `La siguiente es la #${masVieja.referencia}.`,
            boton: `Cobrar la #${masVieja.referencia}`, ir: { ticket: masVieja.id },
        });
    }
    return out;
}
