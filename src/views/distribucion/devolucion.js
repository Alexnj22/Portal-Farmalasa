import { PackageCheck, ShieldAlert } from 'lucide-react';

// La cuenta de una devolución en pantalla (borrador 0017). La base valida lo
// mismo (`dist_preparar_devolucion`): acá es para avisar antes de emitir.

export const DESTINOS_DEVOLUCION = [
    { value: 'reingreso', label: 'Vuelve a bodega', icon: PackageCheck },
    { value: 'cuarentena', label: 'Cuarentena', icon: ShieldAlert },
];

const entero = (t) => {
    const s = String(t ?? '').trim();
    return /^\d+$/.test(s) ? Number(s) : null;
};

/**
 * `pedidos`: los renglones disponibles con lo que se escribió (`pide`) y su
 * `destino`. Devuelve los renglones a mandar, el total con IVA (unidades ×
 * precio − su parte del descuento, igual que la base) y las claves con error.
 */
export function totalDevolucion(pedidos) {
    let centavos = 0;
    const renglones = [];
    const errores = [];
    for (const it of pedidos ?? []) {
        if (String(it.pide ?? '').trim() === '') continue;
        const u = entero(it.pide);
        if (u === null || u > Number(it.disponibles)) { errores.push(it.clave); continue; }
        if (u === 0) continue;
        const bruto = Math.round(u * Number(it.precio_unitario) * 100);
        const desc = Math.round(Number(it.descuento_unitario || 0) * u * 100);
        centavos += bruto - desc;
        renglones.push({ item_id: it.item_id, lote_id: it.lote_id ?? null, unidades: u, destino: it.destino === 'cuarentena' ? 'cuarentena' : 'reingreso' });
    }
    return { total: centavos / 100, renglones, errores };
}
