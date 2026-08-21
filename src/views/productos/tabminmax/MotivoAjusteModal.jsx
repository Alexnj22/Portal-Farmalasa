import { useState } from 'react';
import { MessageSquareText } from 'lucide-react';
import ModalShell from '../../../components/common/ModalShell';
import CuerpoDialogo from '../../../components/common/CuerpoDialogo';
import LiquidSelect from '../../../components/common/LiquidSelect';
import Button from '../../../components/common/Button';
import PortalInput from '../../../components/common/PortalInput';
import PortalTextarea from '../../../components/common/PortalTextarea';
import { MOTIVO_AJUSTE, ERP_NAMES } from './constants';

/**
 * Por qué este MIN·MAX está puesto a mano.
 *
 * El motivo es OPCIONAL y esa es una decisión, no un descuido: hay ~7,600
 * ediciones en dos meses, y exigirlo en todas produciría motivos elegidos al
 * azar. El cálculo actuaría entonces sobre intenciones que nadie tuvo, que es
 * peor que no tener ninguna. Sin motivo, la fila igual queda marcada y nadie la
 * pisa al publicar: sólo pasa a revisarse a mano.
 *
 * Los cuatro motivos salieron de las 16 razones que la gente YA escribía en las
 * solicitudes de cambio (`minmax_change_requests.reason`), no de una lista
 * inventada — ver docs/PLAN-MINMAX-AJUSTE-A-MANO-2026-08-20.md §2.5.
 */
export default function MotivoAjusteModal({ open, row, puedeYaNoRota, guardando, onGuardar, onClose }) {
    // El estado arranca de lo que la fila ya tenía. No hace falta sincronizarlo
    // después: el llamador monta este modal con `key` por producto·sala, así que
    // abrirlo sobre otra fila crea un componente nuevo en vez de arrastrar lo
    // que quedó escrito en la anterior.
    const [motivo,   setMotivo]   = useState(row?._manual_motivo ?? '');
    const [nota,     setNota]     = useState(row?._manual_nota ?? '');
    const [unidades, setUnidades] = useState(row?._manual_cliente_unidades != null ? String(row._manual_cliente_unidades) : '');
    const [dias,     setDias]     = useState(row?._manual_cliente_dias != null ? String(row._manual_cliente_dias) : '');

    if (!open || !row) return null;

    const esClienteFijo = motivo === 'cliente_fijo';
    const nUnidades = parseInt(unidades, 10);
    const nDias     = parseInt(dias, 10);

    // Los mismos frenos que aplica el CHECK de la base, dichos antes de que la
    // base los rechace: un error de guardado no explica qué falta.
    const falta = !motivo ? null
        : motivo === 'otro' && !nota.trim() ? 'Escribe qué pasa con este producto.'
        : esClienteFijo && !(nUnidades > 0 && nDias > 0) ? 'Faltan las unidades y cada cuántos días las compra.'
        : null;

    const opciones = [
        { value: '', label: 'Sin motivo — se revisa a mano' },
        ...Object.entries(MOTIVO_AJUSTE)
            .filter(([key]) => key !== 'ya_no_rota' || puedeYaNoRota)
            .map(([key, cfg]) => ({ value: key, label: cfg.label })),
    ];

    const guardar = () => {
        if (falta) return;
        onGuardar({
            manual_motivo: motivo || null,
            manual_nota:   motivo ? (nota.trim() || null) : null,
            manual_cliente_unidades: esClienteFijo ? nUnidades : null,
            manual_cliente_dias:     esClienteFijo ? nDias     : null,
        });
    };

    return (
        <ModalShell open onClose={onClose} maxWidthClass="max-w-md" zClass="z-tooltip"
                    surface={null} ariaLabel="Motivo del ajuste">
            <CuerpoDialogo
                titulo={row.product_name}
                subtitulo={`${ERP_NAMES[row._erp_sucursal_id]} · Por qué está puesto a mano`}
                icono={MessageSquareText}
                anchoEscritorio="max-w-md"
                pie={
                    <>
                        <Button variant="secondary" onClick={onClose} disabled={guardando}>Cancelar</Button>
                        <Button onClick={guardar} disabled={!!falta || guardando} loading={guardando}>Guardar</Button>
                    </>
                }
            >
                <div className="flex flex-col gap-4 text-left">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-label text-content-2">Motivo</label>
                        <LiquidSelect value={motivo} onChange={setMotivo} options={opciones} />
                        {motivo && MOTIVO_AJUSTE[motivo] && (
                            <p className="text-body-sm text-content-3">{MOTIVO_AJUSTE[motivo].detalle}</p>
                        )}
                        {!puedeYaNoRota && (
                            <p className="text-body-sm text-content-3">
                                «Ya no rota» lo pone quien decide sobre todas las salas: es el que hace
                                que el cálculo deje de contar lo que este producto vendió antes.
                            </p>
                        )}
                    </div>

                    {esClienteFijo && (
                        <div className="grid grid-cols-2 gap-3">
                            <PortalInput
                                label="Unidades"
                                name="manual_cliente_unidades"
                                value={unidades}
                                onChange={e => setUnidades(String(e?.target?.value ?? '').replace(/\D/g, ''))}
                                placeholder="20"
                            />
                            <PortalInput
                                label="Cada cuántos días"
                                name="manual_cliente_dias"
                                value={dias}
                                onChange={e => setDias(String(e?.target?.value ?? '').replace(/\D/g, ''))}
                                placeholder="60"
                            />
                        </div>
                    )}

                    {motivo && (
                        <PortalTextarea
                            label={`Nota${motivo === 'otro' ? '' : ' (opcional)'}`}
                            name="manual_nota"
                            rows={3}
                            value={nota}
                            onChange={e => setNota(e?.target?.value ?? '')}
                            placeholder="Lo que haga falta saber dentro de seis meses"
                        />
                    )}

                    {falta && <p className="text-body-sm text-warning-text">{falta}</p>}

                    {row._manual_por && (
                        <p className="text-body-sm text-content-3">
                            Lo ajustó {row._manual_por}
                            {row._manual_at ? ` el ${new Date(row._manual_at).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}.
                        </p>
                    )}
                </div>
            </CuerpoDialogo>
        </ModalShell>
    );
}
