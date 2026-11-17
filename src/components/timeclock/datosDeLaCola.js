import { useCallback, useEffect, useState } from 'react';
import { kioscoCajaCola } from '@nucleo/data/kiosco';
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

export function useColaDeCaja({ sala = null } = {}) {
    const [cola, setCola] = useState(null);
    const [problema, setProblema] = useState(null);
    const [leyendo, setLeyendo] = useState(false);
    const [ahora, setAhora] = useState(() => Date.now());

    const leer = useCallback(async () => {
        if (esDemo()) { setCola(colaDeMuestra()); setProblema(null); setAhora(Date.now()); return; }
        setLeyendo(true);
        const r = sala ? await colaDeSala(sala) : await kioscoCajaCola();
        setLeyendo(false);
        setAhora(Date.now());
        if (r.ok) {
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
