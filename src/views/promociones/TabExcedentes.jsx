import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Scale, Check, X, AlertTriangle, CircleCheck, Package, DollarSign, Users,
} from 'lucide-react';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PromptModal from '../../components/common/PromptModal';
import ConfirmModal from '../../components/common/ConfirmModal';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { fetchExcedentes, decidirExcedente } from '@nucleo/data/promociones';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fmtMoneda, fmtUnidades, mensajeDeCarga } from '@nucleo/utils/promocionesUtils';

/**
 * Lo vendido por encima del lote, esperando decisión.
 *
 * ── Qué es un excedente, porque el nombre no lo dice solo ───────────────────
 * NO son ventas fuera de la promoción: ésas no existen para el módulo. Son
 * ventas suyas —del producto, en sus fechas, en su presentación— que se pasaron
 * del lote negociado. El laboratorio se comprometió a 100 y se vendieron 120:
 * las primeras 100 se pagan sin discusión y las 20 restantes no están acordadas
 * con nadie. Por eso no se pagan solas ni se descartan solas.
 *
 * ── Por qué se muestran aparte y no suman ──────────────────────────────────
 * Si se sumaran «mientras se decide», alguien vería su bono en $112 y después
 * bajarle a $100. Un número que se muestra y después se corrige es peor que uno
 * que llega más tarde.
 */
export default function TabExcedentes({ puedeAprobar, busqueda = '', onResumen }) {
    const [todas, setTodas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [ocupado, setOcupado] = useState(null);   // id en curso
    const [negando, setNegando] = useState(null);   // fila a negar
    const [aprobando, setAprobando] = useState(null); // fila a aprobar
    const [fallo, setFallo] = useState(null);

    useEffect(() => {
        let vivo = true;
        setCargando(true);
        setError(null);
        fetchExcedentes('por_decidir')
            .then((f) => { if (vivo) setTodas(f); })
            .catch((e) => { if (vivo) setError(e); })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, []);

    /* La caja de búsqueda de la vista se veía en esta pestaña y no hacía nada. */
    const filas = useMemo(() => {
        const q = busqueda.trim();
        return q ? todas.filter((f) => tokenMatch(q, f.persona, f.promocion, f.producto, f.sala)) : todas;
    }, [todas, busqueda]);
    const personas = useMemo(() => new Set(filas.map((f) => f.persona)).size, [filas]);

    /* Las tarjetas de arriba. Salen de acá porque los excedentes son otra
       consulta —`fetchExcedentes`— que sólo esta pestaña hace. */
    useEffect(() => {
        onResumen?.(filas.length ? [
            { key: 'n', icon: Scale, label: 'Por decidir', value: filas.length,
              iconBg: 'bg-warning/10', iconCls: 'text-warning-text', valueCls: 'text-warning-text' },
            { key: 'u', icon: Package, label: 'Unidades de más',
              value: fmtUnidades(filas.reduce((a, f) => a + (Number(f.unidades) || 0), 0)) },
            { key: 'm', icon: DollarSign, label: 'Serían',
              value: fmtMoneda(filas.reduce((a, f) => a + (Number(f.monto) || 0), 0)),
              iconBg: 'bg-brand/10', iconCls: 'text-brand-text', valueCls: 'text-brand' },
            { key: 'p', icon: Users, label: 'Personas', value: personas },
        ] : []);
    }, [filas, personas, onResumen]);

    const decidir = useCallback(async (fila, aprobar, motivo) => {
        setOcupado(fila.id);
        setFallo(null);
        try {
            await decidirExcedente(fila.id, aprobar, motivo);
            setNegando(null);
            setAprobando(null);
            /* Se quita la fila decidida y nada más: volver a pedir la lista
               entera escondía la tabla tras el cargador en cada clic. */
            setTodas((xs) => xs.filter((x) => x.id !== fila.id));
        } catch (e) {
            setFallo(mensajeAmigable(e, 'No se pudo registrar la decisión.'));
        } finally {
            setOcupado(null);
        }
    }, []);

    const total = useMemo(
        () => filas.reduce((a, f) => a + (Number(f.monto) || 0), 0),
        [filas],
    );

    if (cargando && !todas.length) return <LoadingState label="Cargando los excedentes…" />;

    if (error) {
        return (
            <Notice variant="danger" icon={AlertTriangle}>
                {mensajeDeCarga(error, 'No se pudieron cargar los excedentes.')}
            </Notice>
        );
    }

    if (!filas.length && busqueda.trim()) {
        return (
            <EmptyState icon={Scale} title="Sin resultados"
                subtitle={`Ningún excedente coincide con "${busqueda.trim()}".`} />
        );
    }

    if (!filas.length) {
        return (
            <EmptyState
                icon={CircleCheck}
                title="Sin excedentes por decidir"
                subtitle="Aquí aparece lo que se vendió por encima del lote negociado. Nadie se ha pasado, o ya se resolvió todo."
            />
        );
    }

    return (
        <div className="space-y-3">
            <Notice variant="warning" icon={AlertTriangle}>
                <span className="font-semibold">
                    {/* Una fila es persona × producto: contarlas como personas
                        decía «5 personas» donde eran dos. */}
                    {personas} {personas === 1 ? 'persona vendió' : 'personas vendieron'} por
                    encima del lote — {fmtMoneda(total)} en total.
                </span>{' '}
                Ese bono <em>no está acordado con el laboratorio</em>, así que no se paga hasta que
                alguien lo apruebe. Mientras tanto no suma a lo de nadie.
            </Notice>

            {fallo && <Notice variant="danger" icon={AlertTriangle}>{fallo}</Notice>}

            <DataTable
                columns={[
                    { key: 'persona',   label: 'Quién vendió' },
                    { key: 'promocion', label: 'Promoción', hideBelow: 'md' },
                    { key: 'producto',  label: 'Producto', hideBelow: 'lg' },
                    { key: 'unidades',  label: 'De más', align: 'right' },
                    { key: 'monto',     label: 'Sería', align: 'right' },
                    ...(puedeAprobar ? [{ key: 'acciones', label: '', align: 'right' }] : []),
                ]}
                minWidth="320px"
                /* Las acciones van detrás de mantener presionado en el teléfono:
                   dos botones por fila en una tabla táctil se tocan sin querer,
                   y acá el toque equivocado paga o niega plata de alguien. */
                movil={{ acciones: 'mantener' }}
                empty={{ icon: Scale, message: 'Sin excedentes por decidir' }}
            >
                {filas.map((f, i) => (
                    <DataRow key={f.id} index={i}>
                        <DataCell>
                            <span className="font-medium text-content">{shortEmployeeName(f.persona)}</span>
                            {f.sala && (
                                <span className="block text-micro uppercase tracking-wide text-content-3">
                                    {f.sala}
                                </span>
                            )}
                        </DataCell>
                        <DataCell hideBelow="md">
                            <span className="text-caption text-content-2">{f.promocion}</span>
                        </DataCell>
                        <DataCell hideBelow="lg">
                            <span className="text-caption text-content-3">{f.producto}</span>
                        </DataCell>
                        <DataCell align="right">
                            <Badge variant="warning" size="sm">
                                +{fmtUnidades(f.unidades)}
                            </Badge>
                            {f.lote_total && (
                                <span className="block text-micro text-content-3 tabular-nums">
                                    lote {fmtUnidades(f.lote_total)}
                                </span>
                            )}
                        </DataCell>
                        <DataCell align="right">
                            <span className="text-brand font-semibold">{fmtMoneda(f.monto)}</span>
                        </DataCell>
                        {puedeAprobar && (
                            <DataCell align="right">
                                <span className="inline-flex gap-1.5">
                                    {/* Aprobar mueve plata y no se deshace: pide
                                        confirmación, igual que negar pide motivo. */}
                                    <Button
                                        size="sm" icon={Check} iconOnly title="Aprobar y pagar"
                                        loading={ocupado === f.id}
                                        onClick={(e) => { e.stopPropagation(); setAprobando(f); }}
                                    />
                                    <Button
                                        size="sm" variant="secondary" icon={X} iconOnly title="No pagar"
                                        disabled={ocupado === f.id}
                                        onClick={(e) => { e.stopPropagation(); setNegando(f); }}
                                    />
                                </span>
                            </DataCell>
                        )}
                    </DataRow>
                ))}
            </DataTable>

            {/* Negar EXIGE el motivo — lo pide la pantalla y lo exige la base, así
                que nadie descubre el freno después de mandar. Y quien vendió lo
                va a leer en su aviso. */}
            <PromptModal
                isOpen={!!negando}
                onClose={() => setNegando(null)}
                onConfirm={(texto) => decidir(negando, false, texto)}
                title="No pagar este excedente"
                message={negando
                    ? `${shortEmployeeName(negando.persona)} vendió ${fmtUnidades(negando.unidades)} unidades por encima del lote de ${negando.promocion}. Escribe por qué no se paga — lo va a leer esa persona.`
                    : ''}
                placeholder="El laboratorio sólo cubrió el lote acordado…"
                confirmText="No pagar"
                cancelText="Volver"
                isProcessing={ocupado === negando?.id}
                required
            />

            <ConfirmModal
                isOpen={!!aprobando}
                onClose={() => setAprobando(null)}
                onConfirm={() => decidir(aprobando, true, null)}
                title="Aprobar este excedente"
                message={aprobando
                    ? `${shortEmployeeName(aprobando.persona)} cobra ${fmtMoneda(aprobando.monto)} por ${fmtUnidades(aprobando.unidades)} unidades vendidas por encima del lote de ${aprobando.promocion}. La decisión no se deshace.`
                    : ''}
                confirmText="Aprobar y pagar"
                cancelText="Volver"
                isDestructive={false}
                isProcessing={ocupado === aprobando?.id}
            />
        </div>
    );
}
