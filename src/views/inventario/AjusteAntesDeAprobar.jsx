import React, { useEffect, useState } from 'react';
import { X, ShieldCheck, AlertTriangle, PackageX } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PortalTextarea from '../../components/common/PortalTextarea';
import { SkeletonText } from '../../components/common/StateViews';
import { useStaffStore } from '@nucleo/store/staffStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { PROBLEMA_DE_AJUSTE, rotuloDeAjuste } from '@nucleo/utils/conteoDeInventario';

import TituloDeSeccion from '../../components/common/TituloDeSeccion';
/**
 * El conteo que ajusta el inventario, antes de firmarlo (2026-11-06).
 *
 * Aprobar manda las diferencias a la caja en ese mismo momento y no hay vuelta
 * atrás: antes se aprobaba con un «quedará como se contó» y nada más. Acá se
 * ve exactamente qué entra y qué sale, producto por producto y lote por lote,
 * y los avisos que conviene mirar antes (una venta pegada al momento en que se
 * contó, una presentación sin contenido conocido).
 *
 * El plan lo calcula la base (`get_conteo_caja_plan`) con la MISMA función que
 * después arma la cola: lo que se aprueba es lo que se aplica.
 */
export default function AjusteAntesDeAprobar({ open, conteoId, busy, onClose, onConfirm }) {
    const fetchConteoCajaPlan = useStaffStore((s) => s.fetchConteoCajaPlan);
    const [plan, setPlan] = useState(null);
    const [error, setError] = useState(null);
    const [nota, setNota] = useState('');

    // Se monta al abrirlo (la pantalla lo pone con `{abierto && …}`): así cada
    // apertura lee el plan de nuevo, sin arrastrar el de la vez anterior.
    useEffect(() => {
        let vivo = true;
        fetchConteoCajaPlan(conteoId)
            .then((p) => { if (vivo) setPlan(p); })
            .catch((e) => { if (vivo) setError(mensajeAmigable(e)); });
        return () => { vivo = false; };
    }, [conteoId, fetchConteoCajaPlan]);

    const productos = plan?.productos ?? [];
    const problemas = plan?.problemas ?? [];
    const porProducto = new Map();
    problemas.forEach((p) => {
        const k = `${p.erp_product_id}|${p.is_vencidos}`;
        porProducto.set(k, [...(porProducto.get(k) ?? []), p]);
    });
    const lineas = productos.flatMap((p) => p.lineas ?? []);
    const entra = lineas.reduce((n, l) => n + Math.max(0, Number(l.unidades) || 0), 0);
    const sale = lineas.reduce((n, l) => n + Math.max(0, -(Number(l.unidades) || 0)), 0);
    const avisos = problemas.filter((p) => !p.bloquea);

    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-2xl" ariaLabel="Aprobar y ajustar el inventario">
            <div className="flex-none bg-transparent px-6 py-5 border-b border-border-card flex items-center justify-between gap-3 relative z-base">
                <div className="min-w-0">
                    <TituloDeSeccion nivel="tarjeta">Aprobar y ajustar el inventario</TituloDeSeccion>
                    <p className="text-caption text-content-3">Esto es lo que se va a cargar y descontar, en unidades.</p>
                </div>
                <Button variant="ghost" size="sm" icon={X} iconOnly aria-label="Cerrar" onClick={onClose} />
            </div>

            <div className="px-6 py-5 max-h-[60vh] overflow-y-auto flex flex-col gap-3 relative z-base">
                {error ? (
                    <Notice variant="danger">{error}</Notice>
                ) : !plan ? (
                    <SkeletonText lines={5} className="w-full" />
                ) : productos.length === 0 ? (
                    <Notice variant="success">Sin diferencias: al aprobarlo el inventario no cambia.</Notice>
                ) : (
                    <>
                        <p className="text-body-sm text-content-2">
                            <strong>{productos.length}</strong> {productos.length === 1 ? 'producto' : 'productos'}:
                            entran <strong className="tabular-nums">{entra}</strong> y salen <strong className="tabular-nums">{sale}</strong> unidades.
                        </p>
                        {avisos.length > 0 && (
                            <Notice variant="warning" icon={AlertTriangle}>
                                {avisos.length === 1 ? 'Hay un producto' : `Hay ${avisos.length} productos`} para mirar antes de aprobar
                                (marcados abajo). Si se vendió justo cuando se contó, recuéntalo: el número del sistema pudo no
                                tener esa venta todavía.
                            </Notice>
                        )}
                        <ul className="flex flex-col gap-2">
                            {productos.map((p) => {
                                const suyos = porProducto.get(`${p.erp_product_id}|${p.is_vencidos}`) ?? [];
                                return (
                                    <li key={`${p.erp_product_id}|${p.is_vencidos}`}
                                        className="flex flex-col gap-1 rounded-lg border border-line bg-surface-2 px-3 py-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-body font-bold text-content">{p.producto ?? `Producto ${p.erp_product_id}`}</span>
                                            {p.is_vencidos && <Badge variant="neutral" size="sm" uppercase={false}>Área de vencidos</Badge>}
                                            {p.a_medio_contar && <Badge variant="danger" size="sm" uppercase={false} icon={PackageX}>No se ajusta: a medio contar</Badge>}
                                            {suyos.filter((q) => !q.bloquea).map((q) => (
                                                <Badge key={q.tipo} variant="warning" size="sm" uppercase={false}>{PROBLEMA_DE_AJUSTE[q.tipo] ?? q.tipo}</Badge>
                                            ))}
                                        </div>
                                        <ul className="text-caption text-content-2 tabular-nums">
                                            {(p.lineas ?? []).map((l) => (
                                                <li key={`${l.lote}|${l.vence}`} className={Number(l.unidades) > 0 ? 'text-success-text' : 'text-danger-text'}>
                                                    {rotuloDeAjuste(l)}
                                                </li>
                                            ))}
                                        </ul>
                                        {suyos.filter((q) => !q.bloquea).map((q) => (
                                            <p key={`${q.tipo}-d`} className="text-micro text-content-3">{q.detalle}</p>
                                        ))}
                                    </li>
                                );
                            })}
                        </ul>
                    </>
                )}
                <PortalTextarea
                    aria-label="Nota de aprobación"
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    placeholder="Nota de aprobación (opcional)"
                    rows={2}
                />
            </div>

            <div className="flex-none px-6 py-4 border-t border-border-card flex flex-wrap items-center justify-end gap-2 relative z-base">
                <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                <Button tone="success" icon={ShieldCheck} loading={busy} disabled={busy || !plan}
                    onClick={() => onConfirm(nota)}>
                    {productos.length ? 'Aprobar y ajustar' : 'Aprobar'}
                </Button>
            </div>
        </LiquidModal>
    );
}

/**
 * Lo que impide finalizar un conteo que ajusta: productos a medio contar, de
 * más sin lote, o de más sin vencimiento. Se muestra en vez de finalizar, para
 * que se resuelva mientras quien contó sigue frente al estante.
 */
export function ProblemasDelAjuste({ open, problemas, onClose, onIr }) {
    const lista = (problemas ?? []).filter((p) => p.bloquea);
    return (
        <LiquidModal open={open} onClose={onClose} maxWidth="max-w-lg" ariaLabel="Antes de finalizar">
            <div className="flex-none bg-transparent px-6 py-5 border-b border-border-card flex items-center justify-between gap-3 relative z-base">
                <div className="min-w-0">
                    <TituloDeSeccion nivel="tarjeta">Antes de finalizar</TituloDeSeccion>
                    <p className="text-caption text-content-3">
                        {lista.length === 1 ? 'Un producto no se podría ajustar' : `${lista.length} productos no se podrían ajustar`} así como están.
                    </p>
                </div>
                <Button variant="ghost" size="sm" icon={X} iconOnly aria-label="Cerrar" onClick={onClose} />
            </div>
            <div className="px-6 py-5 max-h-[60vh] overflow-y-auto relative z-base">
                <ul className="flex flex-col gap-2">
                    {lista.map((p) => (
                        <li key={`${p.erp_product_id}|${p.is_vencidos}|${p.tipo}`}
                            className="flex flex-col gap-1 rounded-lg border border-line bg-surface-2 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-body font-bold text-content">{p.producto ?? `Producto ${p.erp_product_id}`}</span>
                                {p.is_vencidos && <Badge variant="neutral" size="sm" uppercase={false}>Área de vencidos</Badge>}
                                <Badge variant="danger" size="sm" uppercase={false}>{PROBLEMA_DE_AJUSTE[p.tipo] ?? p.tipo}</Badge>
                            </div>
                            <p className="text-caption text-content-2">{p.detalle}</p>
                            {onIr && (
                                <div>
                                    <Button variant="secondary" size="sm" onClick={() => onIr(p)}>Ir al producto</Button>
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            </div>
        </LiquidModal>
    );
}
