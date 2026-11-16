import React, { useState, useEffect, useCallback } from 'react';
import { Hash, RotateCw, UserPlus } from 'lucide-react';
import Notice from '../../components/common/Notice';
import TabBarAction from '../../components/common/TabBarAction';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { fetchAltasPendientes, reintentarAlta, mensajeDeError } from '@nucleo/data/customers';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';

/**
 * Las fichas del portal que todavía no tienen número de ficha y que necesitan
 * a una persona (2026-11-15). El portal le da el número a cada cliente nuevo
 * solo; acá quedan los casos en que no se atrevió: un documento a nombre de
 * otra persona, dos fichas posibles, o una ficha vieja que no aparece y que
 * crear podría resucitar a alguien que se dio de baja.
 *
 * «Reintentar» vuelve a buscar. «Crear de todas formas» autoriza a crearla
 * aunque no haya nacido en el portal — es una decisión, y queda anotada.
 */
// El motivo va DENTRO del bloque del cliente y no en columna propia: en el
// teléfono la última columna de datos es el «ancla» de la ficha (corta, a la
// derecha) y una frase larga ahí empujaba el nombre fuera de la tarjeta
// (medido a 390px, 2026-11-15). El ancla es cuándo se intentó por última vez.
const COLS = [
    { key: 'nombre', label: 'Cliente y por qué no tiene número', align: 'left' },
    { key: 'cuando', label: 'Último intento', align: 'right' },
    { key: 'accion', label: '', align: 'right' },
];

const cuando = (t) => (t ? `${fechaNumerica(t)} ${hora12(new Date(t))}` : '—');

export default function SinNumeroDeFicha({ onAbrir }) {
    const { hasPermission } = useAuth();
    const canCrear = hasPermission('clientes_crear');
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState('');
    const [ocupado, setOcupado] = useState(null);

    const cargar = useCallback(async () => {
        try {
            setDatos(await fetchAltasPendientes());
            setError('');
        } catch (e) {
            setError(mensajeDeError(e));
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const actuar = useCallback(async (fila, crear) => {
        setOcupado(fila.customer_id);
        try {
            const r = await reintentarAlta(fila.customer_id, crear, { nombre: fila.name });
            const toast = useToastStore.getState().showToast;
            if (r?.hecho) toast('Listo', `${fila.name}: número ${r.erp_id}.`, 'success');
            else if (r?.revisar) toast('Sigue sin número', r.error || 'Hay que revisarlo.', 'warning');
            else toast('En camino', 'Se le asigna el número en unos minutos.', 'info');
            await cargar();
        } catch (e) {
            setError(mensajeDeError(e));
        } finally {
            setOcupado(null);
        }
    }, [cargar]);

    if (!datos?.porRevisar?.length && !error) return null;

    return (
        <div className="space-y-3">
            <Notice variant="warning" icon={Hash}>
                {datos?.revisar === 1 ? 'Un cliente no tiene' : `${datos?.revisar ?? 0} clientes no tienen`} número.
                Revísalos. Sin número no se les puede facturar a su nombre.
            </Notice>
            {error && <Notice variant="danger">{error}</Notice>}
            {!!datos?.porRevisar?.length && (
                <DataTable columns={COLS} minWidth="320px"
                    /* Dos acciones por fila: tira visible (§32.7 lo admite con una o dos).
                       `apilada`: la identidad es un bloque (nombre, documento y motivo). */
                    movil={{ usarAccionDeFila: true, acciones: true, apilada: true }}>
                    {datos.porRevisar.map((f, i) => (
                        <DataRow key={f.customer_id} index={i} onClick={() => onAbrir?.(f)}>
                            <DataCell>
                                <div className="min-w-0">
                                    <div className="truncate text-content-1">{f.name}</div>
                                    <div className="text-caption text-content-3 truncate">
                                        {[f.dui, f.phone].filter(Boolean).join(' · ') || 'Sin documento'}
                                    </div>
                                    <p className="text-caption text-content-2 mt-1 whitespace-normal break-words">
                                        {f.error || 'Sin detalle'}
                                    </p>
                                </div>
                            </DataCell>
                            <DataCell align="right">
                                <span className="text-caption tabular-nums text-content-3 whitespace-nowrap">
                                    {cuando(f.ultimo_intento_at)}
                                </span>
                            </DataCell>
                            <DataCell align="right">
                                {canCrear && (
                                    <div className="flex justify-end gap-2">
                                        <TabBarAction icon={RotateCw} disabled={ocupado === f.customer_id}
                                            onClick={(e) => { e.stopPropagation(); actuar(f, false); }}>
                                            Reintentar
                                        </TabBarAction>
                                        {!f.permitir_crear && (
                                            <TabBarAction icon={UserPlus} disabled={ocupado === f.customer_id}
                                                onClick={(e) => { e.stopPropagation(); actuar(f, true); }}>
                                                Crear de todas formas
                                            </TabBarAction>
                                        )}
                                    </div>
                                )}
                            </DataCell>
                        </DataRow>
                    ))}
                </DataTable>
            )}
        </div>
    );
}
