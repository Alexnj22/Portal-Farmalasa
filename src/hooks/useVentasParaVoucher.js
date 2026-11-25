/**
 * La otra venta que el mismo voucher pagó, encontrada sola (2026-11-25).
 *
 * Pedido del usuario: «¿por qué escribiría el número de la venta? ¿no puede
 * enlazar ya la venta y la inyección pagada con tarjeta? … ese mismo voucher a
 * las 2 cosas». Cuando el comprobante pasa de la deuda, lo que sobra se busca
 * entre las ventas de hoy o ayer de la sucursal que valen EXACTAMENTE eso
 * (`creditos-erp` → `ventas_para_completar_voucher`). Si hay una sola, queda
 * elegida; si hay varias, se elige; si no hay, se puede escribir el número.
 *
 * También encuentra INGRESOS de caja (2026-11-25): la aplicación de una
 * inyección no se factura, se anota como ingreso con tarjeta con el mismo
 * voucher (P8855 de Salud 1, $1.00 de un voucher de $10.35). Cada candidata
 * trae `clase` ('venta' | 'movimiento'); la que tiene el mismo total o número
 * del voucher viene con `coincide_voucher` y, si es una sola, queda elegida.
 *
 * Lo usan el portal (`CuentasPorCobrarView`) y la app (`cobrar-credito`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchVentasParaVoucher } from '@nucleo/data/creditos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

const NADA = { ventas: [], buscando: false, error: null };

const mismo = (a, b) => !!a && !!b && a.id === b.id && a.clase === b.clase;

/** La que se elige sola: la única del mismo voucher, o la única que hay. */
export function laQueSeElige(ventas) {
    const delVoucher = ventas.filter((v) => v.coincide_voucher);
    if (delVoucher.length === 1) return delVoucher[0];
    return ventas.length === 1 ? ventas[0] : null;
}

export function useVentasParaVoucher({ sala, sobra, activo, total = null, documento = null }) {
    const monto = activo && Number(sobra) > 0.004 ? Number(Number(sobra).toFixed(2)) : 0;
    const [estado, setEstado] = useState(NADA);
    const [elegida, setElegida] = useState(null);
    const vuelta = useRef(0);

    const buscar = useCallback(async () => {
        const mia = ++vuelta.current;
        if (!monto || !sala) { setEstado(NADA); return; }
        setEstado((e) => ({ ...e, buscando: true, error: null }));
        const r = await fetchVentasParaVoucher({ sala, monto, total: Number(total) > 0 ? Number(total) : null, documento: documento || null });
        // Una respuesta vieja (el monto cambió mientras se buscaba) no pisa a la nueva.
        if (mia !== vuelta.current) return;
        if (r?.error || r?.ok === false) {
            setEstado({ ventas: [], buscando: false, error: mensajeAmigable(r?.error || r) });
            return;
        }
        const ventas = Array.isArray(r?.ventas) ? r.ventas : [];
        setEstado({ ventas, buscando: false, error: null });
        // La elegida se queda si sigue en la lista; si hay una sola, es ésa.
        setElegida((prev) => (prev && ventas.some((v) => mismo(v, prev)) ? prev : laQueSeElige(ventas)));
    }, [sala, monto, total, documento]);

    // Se espera un momento: el monto cambia con cada tecla del reparto.
    useEffect(() => {
        if (!monto) { vuelta.current += 1; setEstado(NADA); setElegida(null); return undefined; }
        const t = setTimeout(buscar, 350);
        return () => clearTimeout(t);
    }, [monto, buscar]);

    return { ...estado, monto, elegida, elegir: setElegida, buscar };
}

/** «0000095931_COF» → «95931»: el número que sale en el ticket. */
export function numeroDeVenta(correlativo) {
    return String(correlativo ?? '').split('_')[0].replace(/^0+/, '') || String(correlativo ?? '');
}

/** Cómo se nombra una candidata en pantalla, sin la hora (la pantalla la formatea). */
export function rotuloDeCandidata(v) {
    if (v?.clase === 'movimiento') return `Ingreso ${v.numero} · ${v.descripcion || 'de caja'} · `;
    return `Venta ${v?.numero ?? numeroDeVenta(v?.documento)} · `;
}

/** La hora de la candidata sin fracciones: «11:58:03.336» → «11:58:03». */
export const horaDeCandidata = (v) => String(v?.hora ?? '').slice(0, 8);
