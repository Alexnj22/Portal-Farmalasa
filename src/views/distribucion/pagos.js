// Las cuentas de las formas de pago, sin pantalla: la usan `FormasDePago` y la
// vista de venta (y así un componente no exporta funciones sueltas).
import { formatMoney } from '@nucleo/utils/formatNumber';
import { leerMonto } from './comun';

let siguienteClave = 1;
export const filaNueva = (forma = '01') => ({ clave: siguienteClave++, forma, monto: '', referencia: '', recibido: '', adjunto: null, existente: null });

export const redondear = (n) => Math.round(n * 100) / 100;

/** El monto de cada fila: el escrito, o lo que falta si es la última. */
export function montosDePagos(filas, total) {
    const fijas = filas.slice(0, -1).reduce((a, f) => a + (leerMonto(f.monto) ?? 0), 0);
    const resto = Math.max(0, redondear(total - fijas));
    return filas.map((f, i) => (i === filas.length - 1 ? resto : leerMonto(f.monto) ?? 0));
}

/** El cambio del efectivo: lo entregado menos lo que se paga en efectivo. */
export function cambioDePagos(filas, total) {
    const montos = montosDePagos(filas, total);
    return filas.reduce((a, f, i) => {
        const r = leerMonto(f.recibido);
        return f.forma === '01' && r ? a + Math.max(0, redondear(r - montos[i])) : a;
    }, 0);
}

/** Lo que falta para que las formas de pago se puedan guardar, o null. */
export function problemaDePagos(filas, total, { cliente, plazo }) {
    const fijas = filas.slice(0, -1);
    for (const f of fijas) {
        const m = leerMonto(f.monto);
        if (!m || m <= 0) return 'Escribe el monto de cada forma de pago, menos la última (se calcula sola).';
    }
    const suma = fijas.reduce((a, f) => a + leerMonto(f.monto), 0);
    if (total > 0 && suma >= total - 0.005) return `Las formas de pago ya suman ${formatMoney(suma)}: la última no tiene nada que cobrar. Quítala.`;
    const montos = montosDePagos(filas, total);
    for (const [i, f] of filas.entries()) {
        if (f.forma !== '01' || !String(f.recibido ?? '').trim()) continue;
        const r = leerMonto(f.recibido);
        if (r == null) return 'El efectivo que entrega el cliente no es un monto.';
        if (r < montos[i] - 0.005) return `El efectivo que entrega (${formatMoney(r)}) no alcanza para ${formatMoney(montos[i])}.`;
    }
    const conCredito = filas.some(f => f.forma === '13');
    if (conCredito) {
        if (!(cliente?.plazo_dias > 0) || !(Number(cliente?.limite_credito) > 0)) return 'Este cliente no tiene crédito aprobado.';
        const p = leerMonto(plazo);
        if (!p || !Number.isInteger(p) || p > cliente.plazo_dias) return `El plazo del crédito tiene que ser de 1 a ${cliente.plazo_dias} días.`;
    }
    return null;
}

