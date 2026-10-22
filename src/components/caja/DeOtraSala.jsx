import { useEffect, useMemo, useState } from 'react';
import { usePedirTraslado } from '@nucleo/hooks/usePedirTraslado';

// ── No hay en la sala: ¿lo tiene otra? ──────────────────────────────────────
// Usa el MISMO armado que «Pedir a otra sala» (`usePedirTraslado`): la sala,
// el estante y el reparto por lote salen de ahí, así que la solicitud es igual
// a la que se haría desde Inventario. Sólo manda ESTE renglón (`enviarSoloEsta`)
// y no toca lo que la persona venía juntando para otro traslado.
export default function DeOtraSala({ producto, factor, cantidad, disponibles = null, apiRef, onCambio,
    rotulo = null, opcionNo = { titulo: 'No pedir: encargar a Compras', detalle: 'Compras confirma el precio y la fecha' } }) {
    const productoInicial = useMemo(() => ({ erp_product_id: producto.id, descripcion: producto.nombre }), [producto.id, producto.nombre]);
    const h = usePedirTraslado({ productoInicial });
    const { setCantidad, setPresIdx, setOrigenId, presentaciones } = h;
    const necesita = cantidad * factor;
    // Sólo el estante de operación (lo próximo a vencer no se aparta) y sólo quien alcanza.
    const candidatos = useMemo(() => h.donde.filter((d) => !d.vencidos && d.branch_id && Number(d.unidades) >= necesita), [h.donde, necesita]);
    const [eleccion, setEleccion] = useState(null);

    useEffect(() => { setCantidad(String(cantidad)); }, [cantidad, setCantidad]);
    useEffect(() => {
        const i = (presentaciones ?? []).findIndex((p) => Number(p.factor || 1) === Number(factor));
        if (i >= 0) setPresIdx(String(i));
    }, [presentaciones, factor, setPresIdx]);
    // Sugerida mientras nadie elija: la primera que alcanza (la de más unidades).
    const efectiva = eleccion ?? (candidatos[0] ? String(candidatos[0].erp_sucursal_id) : null);
    const elegido = candidatos.find((d) => String(d.erp_sucursal_id) === efectiva) ?? null;
    useEffect(() => { if (elegido) setOrigenId(`${elegido.erp_sucursal_id}`); }, [elegido, setOrigenId]);

    const { enviarSoloEsta } = h;
    useEffect(() => { apiRef.current = { enviar: enviarSoloEsta }; });
    const lista = Boolean(elegido && h.lineaLista && String(h.origenId) === String(elegido.erp_sucursal_id));
    useEffect(() => {
        onCambio(elegido ? { branch_id: elegido.branch_id, sala: elegido.sala, lista } : null);
    }, [elegido, lista, onCambio]);

    const aqui = disponibles == null ? 'Ninguna sala' : disponibles > 0 ? `En esta sala hay sólo ${disponibles} y ninguna otra` : 'En esta sala no hay y ninguna otra';
    if (h.donde.length === 0 && !candidatos.length) {
        return <p className="text-caption text-content-3">Revisando qué salas lo tienen…</p>;
    }
    if (!candidatos.length) {
        return <p className="text-caption text-content-3">{aqui} sala tiene {necesita}.</p>;
    }
    return (
        <div className="space-y-1.5">
            <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1">
                {rotulo ?? `${disponibles > 0 ? `Aquí hay sólo ${disponibles}` : 'Aquí no hay'} · ¿Lo pedimos a otra sala?`}
            </p>
            <ul className="space-y-1.5">
                {[...candidatos.map((d) => ({ value: String(d.erp_sucursal_id), titulo: `Pedir a ${d.sala}${disponibles == null ? '' : ' y apartar'}`, detalle: `Tiene ${Number(d.unidades)} unidades` })),
                    ...(opcionNo ? [{ value: 'encargo', ...opcionNo }] : [])].map((o) => (
                    <li key={o.value}>
                        <button type="button" onClick={() => setEleccion(o.value)} data-surface="card" aria-pressed={efectiva === o.value}
                            className={`w-full text-left rounded-xl p-2.5 min-h-[var(--tap-min)] active:scale-[0.97] ${efectiva === o.value ? 'ring-2 ring-accent' : 'ring-1 ring-border-card'}`}>
                            <p className="text-body-sm font-semibold text-content">{o.titulo}</p>
                            <p className="text-caption text-content-3">{o.detalle}</p>
                        </button>
                    </li>
                ))}
            </ul>
            {elegido && h.avisoVence && <p className={`text-caption ${h.avisoVence.grave ? 'text-danger-text' : 'text-warning-text'}`}>{h.avisoVence.texto}</p>}
        </div>
    );
}
