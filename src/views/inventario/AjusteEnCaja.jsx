import React, { useCallback, useEffect, useState } from 'react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { rotuloDeAjuste } from '@nucleo/utils/conteoDeInventario';

const ESTADO = {
    PENDIENTE: { label: 'En cola', variant: 'neutral' },
    APLICANDO: { label: 'Aplicando', variant: 'info' },
    HECHO: { label: 'Aplicado', variant: 'success' },
    ERROR: { label: 'No se aplicó', variant: 'danger' },
    INCIERTO: { label: 'Revisar', variant: 'warning' },
    // Quedó a medio contar (2026-11-06): no se aplica nada, para no ajustar
    // sólo una parte. La base ya no deja finalizar así; esto es la red.
    OMITIDO: { label: 'No se ajustó', variant: 'danger' },
};


/**
 * Lo que un conteo que corrige la caja aplicó, producto por producto
 * (2026-11-05). Lo aplica `aplicar-conteo-caja` en segundo plano después de
 * aprobar; esto se refresca solo mientras quede algo en cola.
 */
export default function AjusteEnCaja({ conteoId, puedeReintentar }) {
    const fetchConteoCaja = useStaffStore((s) => s.fetchConteoCaja);
    const reintentar = useStaffStore((s) => s.reintentarConteoCaja);
    const { showToast } = useToastStore();
    const [datos, setDatos] = useState(null);
    const [ocupado, setOcupado] = useState(null);

    const cargar = useCallback(() => fetchConteoCaja(conteoId).then(setDatos)
        .catch((e) => showToast('Error', mensajeAmigable(e), 'error')), [conteoId, fetchConteoCaja, showToast]);
    useEffect(() => { cargar(); }, [cargar]);

    const movs = datos?.movimientos ?? [];
    const cuenta = (e) => movs.filter((m) => m.estado === e).length;
    const enCola = cuenta('PENDIENTE') + cuenta('APLICANDO');
    useEffect(() => {
        if (!enCola) return undefined;
        const t = setInterval(cargar, 15_000);
        return () => clearInterval(t);
    }, [enCola, cargar]);

    if (!datos) return null;
    const problemas = movs.filter((m) => m.estado === 'ERROR' || m.estado === 'INCIERTO' || m.estado === 'OMITIDO');

    const otraVez = async (id) => {
        setOcupado(id);
        try { await reintentar(id); await cargar(); }
        catch (e) { showToast('Error', mensajeAmigable(e), 'error'); }
        finally { setOcupado(null); }
    };

    return (
        <div className="flex flex-col gap-3">
            {movs.length === 0 ? (
                <Notice variant="success">Sin diferencias: el inventario ya estaba como se contó.</Notice>
            ) : enCola ? (
                <Notice variant="info">
                    Ajustando el inventario: {cuenta('HECHO')} de {movs.length} productos listos. Sigue solo aunque
                    cierres esta pantalla.
                </Notice>
            ) : problemas.length ? (
                <Notice variant="warning">
                    {cuenta('HECHO')} de {movs.length} productos quedaron como se contaron. {problemas.length} no se
                    pudieron aplicar: revísalos abajo.
                </Notice>
            ) : (
                <Notice variant="success">
                    Los {movs.length} productos con diferencia quedaron en el inventario como se contaron.
                </Notice>
            )}

            {problemas.length > 0 && (
                <ul className="flex flex-col gap-2">
                    {problemas.map((m) => (
                        <li key={m.id} className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface-2 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-body font-bold text-content">{m.producto ?? `Producto ${m.erp_product_id}`}</span>
                                {m.is_vencidos && <Badge variant="neutral" size="sm" uppercase={false}>Área de vencidos</Badge>}
                                <Badge variant={ESTADO[m.estado]?.variant} size="sm" uppercase={false}>{ESTADO[m.estado]?.label}</Badge>
                            </div>
                            <ul className="text-caption text-content-2">
                                {(m.lineas ?? []).filter((l) => Number(l.unidades)).map((l) => (
                                    <li key={`${l.lote}|${l.vence}`}>
                                        {rotuloDeAjuste(l)} — {l.hecho ? 'aplicado' : (l.error ?? 'pendiente')}
                                    </li>
                                ))}
                            </ul>
                            {m.estado === 'INCIERTO' && (
                                <p className="text-caption font-semibold text-warning-text">
                                    Puede haber entrado una parte. Revisa los movimientos del producto antes de reintentar.
                                </p>
                            )}
                            {m.estado === 'OMITIDO' && m.error && (
                                <p className="text-caption text-content-2">{m.error}</p>
                            )}
                            {puedeReintentar && m.estado !== 'OMITIDO' && (
                                <div>
                                    <Button size="sm" variant="secondary" disabled={ocupado === m.id}
                                        loading={ocupado === m.id} onClick={() => otraVez(m.id)}>
                                        Reintentar
                                    </Button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
