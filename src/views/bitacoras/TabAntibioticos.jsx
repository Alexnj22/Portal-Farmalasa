import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, Pencil, Pill, Plus, Undo2 } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import SegmentedControl from '../../components/common/SegmentedControl';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { useToastStore } from '@nucleo/store/toastStore';
import { exportCsv } from '@nucleo/utils/csvExport';
import { hoySV } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import {
    GRUPOS_AWARE, VENTA_ANTIBIOTICO, VIAS_ANTIBIOTICO, antibioticoAutomatico, confirmarMoleculaAware,
    fetchAntibioticosPorRevisar, fetchListadoAntibioticos,
} from '@nucleo/data/bitacoras';
import EditarAntibioticoModal from './EditarAntibioticoModal';

/*
 * Listado de antibióticos con su grupo AWaRe — Guía de Verificación BPAD 1.13
 * (MAYOR), RTS 11.02.04:24 §6.1.15.
 *
 * Una fila por MOLÉCULA, porque el grupo es de la molécula y es lo que el
 * regente confirma; debajo, los productos del catálogo que la contienen, cada
 * uno con su vía y cómo se vende (2026-10-28):
 *   Libro  — las seis moléculas del RTS 6.4.3 y todo inyectable;
 *   Receta — pide receta, no se retiene, no va al libro;
 *   Libre  — neomicina y sulfadiazina de uso local.
 * La regla vive en la base (`antibiotico_venta`).
 *
 * El listado lo propone el nombre del producto; lo que una persona fija a mano
 * manda. «Por revisar» son los que están marcados para el libro y el listado no
 * ve: es la respuesta a «¿cómo sé que están todos?».
 */

const MOVIL = { identidad: 'molecula', ancla: 'grupo', chips: ['productos'], acciones: true };
const MOVIL_REVISAR = { identidad: 'producto', ancla: 'accion' };
const VIA = Object.fromEntries(VIAS_ANTIBIOTICO.map(v => [v.value, v.label]));

export default function TabAntibioticos({ busqueda = '', puedeConfirmar = false, puedeEditar = false }) {
    const showToast = useToastStore((s) => s.showToast);
    const [filas, setFilas] = useState(null);
    const [revisar, setRevisar] = useState({ fuera: [], excluidos: [] });
    const [error, setError] = useState(null);
    const [confirmando, setConfirmando] = useState(null);
    const [vista, setVista] = useState('listado');
    const [editando, setEditando] = useState(null);

    const cargar = useCallback(async () => {
        const [r, rv] = await Promise.all([fetchListadoAntibioticos(), fetchAntibioticosPorRevisar()]);
        setFilas(r.filas);
        setRevisar(rv);
        setError(r.error || rv.error);
    }, []);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga al entrar a la pestaña
    useEffect(() => { cargar(); }, [cargar]);

    const todas = useMemo(() => {
        const m = new Map();
        for (const f of filas || []) {
            if (!m.has(f.molecula)) {
                m.set(f.molecula, { molecula: f.molecula, grupo: f.grupo, atc: f.atc, fuente: f.fuente,
                    confirmado: f.confirmado, productos: [] });
            }
            m.get(f.molecula).productos.push(f);
        }
        return [...m.values()];
    }, [filas]);

    // Lo marcado para el libro que ninguna molécula reclama va también en el
    // listado, arriba y como «sin molécula»: el listado tiene que mostrar
    // TODO lo que se maneja, no sólo lo que ya se pudo clasificar.
    const conSinAsignar = useMemo(() => (revisar.fuera.length
        ? [{ molecula: null, productos: revisar.fuera.map(p => ({ ...p, origen: 'nuevo' })) }, ...todas]
        : todas), [todas, revisar.fuera]);

    const moleculas = useMemo(() => {
        if (!busqueda.trim()) return conSinAsignar;
        return conSinAsignar.filter(x => tokenMatch(busqueda, x.molecula, x.atc, ...x.productos.map(p => p.producto)));
    }, [conSinAsignar, busqueda]);

    const filtrarProductos = useCallback((lista) => (busqueda.trim()
        ? lista.filter(p => tokenMatch(busqueda, p.producto, p.principio_activo))
        : lista), [busqueda]);

    const cuenta = useMemo(() => {
        const c = { LIBRO: 0, RECETA: 0, LIBRE: 0 };
        for (const f of filas || []) if (c[f.venta] != null) c[f.venta] += 1;
        return c;
    }, [filas]);

    const sinConfirmar = todas.filter(m => !m.confirmado).length;
    const libroDistinto = (filas || []).filter(f => f.revisar_libro);

    const confirmar = async (m) => {
        setConfirmando(m.molecula);
        const { error: e } = await confirmarMoleculaAware(m.molecula, m.grupo);
        setConfirmando(null);
        if (e) { showToast('No se pudo confirmar', mensajeAmigable(e), 'error'); return; }
        showToast(`${m.molecula}: confirmado`, null, 'success');
        cargar();
    };

    const devolver = async (p) => {
        const { error: e } = await antibioticoAutomatico(p.product_id);
        if (e) { showToast('No se pudo devolver', mensajeAmigable(e), 'error'); return; }
        showToast('Devuelto al listado', p.producto, 'success');
        cargar();
    };

    const exportar = () => {
        const filasCsv = (filas || []).map(f => [
            f.molecula, GRUPOS_AWARE[f.grupo]?.label || 'Sin clasificar', f.atc || '', f.fuente,
            f.confirmado ? 'Sí' : 'No', f.producto, f.principio_activo || '', VIA[f.via] || '',
            VENTA_ANTIBIOTICO[f.venta]?.label || '',
        ]);
        exportCsv(['Molécula', 'Grupo AWaRe', 'ATC', 'Fuente', 'Confirmado por el regente',
            'Producto', 'Principio activo', 'Vía', 'Venta'],
        filasCsv, `listado_antibioticos_${hoySV()}.csv`, 'bitacoras');
    };

    const alGuardar = () => { setEditando(null); cargar(); };

    const VISTAS = [
        { value: 'listado', label: `Listado · ${(filas || []).length + revisar.fuera.length}` },
        { value: 'revisar', label: `Por revisar · ${revisar.fuera.length}` },
        { value: 'sacados', label: `Sacados · ${revisar.excluidos.length}` },
    ];

    return (
        <div className="space-y-4">
            <Notice variant={sinConfirmar ? 'warning' : 'success'}>
                {sinConfirmar
                    ? `${sinConfirmar} de ${todas.length} moléculas sin confirmar. El grupo viene del Listado Oficial de Medicamentos 2026 y, donde no lo marca, de la OMS; vale como listado cuando el regente lo confirma.`
                    : 'Listado confirmado por el regente.'}
            </Notice>
            {revisar.fuera.length > 0 && (
                <Notice variant="danger">
                    {`${revisar.fuera.length} productos van al libro bajo receta y no están en el listado. Están en «Por revisar»: a cada uno hay que decirle de qué molécula es.`}
                </Notice>
            )}
            {libroDistinto.length > 0 && (
                <Notice variant="warning">
                    {`${libroDistinto.length} con la marca del libro distinta a la regla: ${libroDistinto.map(f => f.producto).join(' · ')}.`}
                </Notice>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
                <SegmentedControl options={VISTAS} value={vista} onChange={setVista} label="Qué ver" />
                <div className="flex flex-wrap items-center gap-2">
                    {puedeEditar && (
                        <Button variant="secondary" size="sm" icon={Plus} onClick={() => setEditando({})}>Agregar producto</Button>
                    )}
                    <Button variant="secondary" size="sm" icon={Download} onClick={exportar} disabled={!filas?.length}>
                        Exportar
                    </Button>
                </div>
            </div>

            {vista === 'listado' && (
                <div className="flex flex-wrap gap-1.5">
                    {Object.entries(VENTA_ANTIBIOTICO).map(([k, v]) => (
                        <Badge key={k} variant={v.variant}>{`${v.label}: ${cuenta[k]}`}</Badge>
                    ))}
                </div>
            )}

            {error && <Notice variant="danger">{mensajeAmigable(error)}</Notice>}

            {vista === 'listado' && (
                <DataTable
                    columns={[
                        { key: 'molecula',  label: 'Molécula' },
                        { key: 'grupo',     label: 'Grupo AWaRe' },
                        { key: 'productos', label: 'Productos' },
                        { key: 'accion',    label: '' },
                    ]}
                    loading={filas == null}
                    skeletonRows={6}
                    empty={{ icon: Pill, message: 'Sin antibióticos en el catálogo' }}
                    minWidth="760px"
                    movil={MOVIL}
                >
                    {moleculas.map((m, i) => {
                        if (!m.molecula) return (
                            <DataRow key="sin-molecula" index={i}>
                                <DataCell className="text-body-sm">
                                    <p className="font-semibold">Sin molécula asignada</p>
                                    <p className="text-caption text-content-3">Van al libro; falta decir de qué molécula son</p>
                                </DataCell>
                                <DataCell><Badge variant="danger">Por asignar · {m.productos.length}</Badge></DataCell>
                                <DataCell className="text-body-sm">
                                    <ul className="space-y-1">
                                        {m.productos.map(p => (
                                            <li key={p.product_id} className="flex flex-wrap items-center gap-1.5">
                                                <span className="text-content">{p.producto}</span>
                                                <Badge variant="neutral" size="sm">{VIA[p.via]}</Badge>
                                                {puedeEditar && (
                                                    <Button variant="ghost" size="xs" icon={Pencil} iconOnly
                                                        title={`Asignar ${p.producto}`} onClick={() => setEditando(p)} />
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </DataCell>
                                <DataCell />
                            </DataRow>
                        );
                        const g = GRUPOS_AWARE[m.grupo];
                        const soloLocal = m.productos.every(p => p.via === 'local');
                        return (
                            <DataRow key={m.molecula} index={i}>
                                <DataCell className="text-body-sm">
                                    <p className="font-semibold capitalize">{m.molecula}</p>
                                    <p className="text-caption text-content-3">{m.atc} · {m.fuente}</p>
                                </DataCell>
                                <DataCell>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        {soloLocal
                                            ? <Badge variant="neutral">Uso local · sin grupo</Badge>
                                            : <Badge variant={g?.variant || 'neutral'}>{g?.label || 'Sin clasificar'}</Badge>}
                                        {m.confirmado && <Badge variant="info" icon={Check}>Confirmado</Badge>}
                                    </div>
                                </DataCell>
                                <DataCell className="text-body-sm">
                                    <ul className="space-y-1">
                                        {m.productos.map(p => {
                                            const v = VENTA_ANTIBIOTICO[p.venta];
                                            return (
                                                <li key={p.product_id} className="flex flex-wrap items-center gap-1.5">
                                                    <span className="text-content">{p.producto}</span>
                                                    <Badge variant="neutral" size="sm">{VIA[p.via]}</Badge>
                                                    {v && <Badge variant={v.variant} size="sm">{v.corto}</Badge>}
                                                    {puedeEditar && (
                                                        <Button variant="ghost" size="xs" icon={Pencil} iconOnly
                                                            title={`Editar ${p.producto}`} onClick={() => setEditando(p)} />
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </DataCell>
                                <DataCell align="right">
                                    {puedeConfirmar && !m.confirmado && m.grupo && (
                                        <Button variant="secondary" size="sm" icon={Check}
                                            disabled={confirmando != null} onClick={() => confirmar(m)}>
                                            Confirmar
                                        </Button>
                                    )}
                                </DataCell>
                            </DataRow>
                        );
                    })}
                </DataTable>
            )}

            {vista === 'revisar' && (
                <DataTable
                    columns={[
                        { key: 'producto', label: 'Producto' },
                        { key: 'via',      label: 'Vía (por el nombre)' },
                        { key: 'accion',   label: '' },
                    ]}
                    loading={filas == null}
                    skeletonRows={4}
                    empty={{ icon: Check, message: 'Todo lo del libro está en el listado' }}
                    minWidth="560px"
                    movil={MOVIL_REVISAR}
                >
                    {filtrarProductos(revisar.fuera).map((p, i) => (
                        <DataRow key={p.product_id} index={i}>
                            <DataCell className="text-body-sm">
                                <p className="font-semibold">{p.producto}</p>
                                {p.principio_activo && <p className="text-caption text-content-3">{p.principio_activo}</p>}
                            </DataCell>
                            <DataCell className="text-body-sm">{VIA[p.via]}</DataCell>
                            <DataCell align="right">
                                {puedeEditar && (
                                    <Button variant="secondary" size="sm" icon={Pencil}
                                        onClick={() => setEditando({ ...p, origen: 'nuevo' })}>
                                        Asignar
                                    </Button>
                                )}
                            </DataCell>
                        </DataRow>
                    ))}
                </DataTable>
            )}

            {vista === 'sacados' && (
                <DataTable
                    columns={[
                        { key: 'producto', label: 'Producto' },
                        { key: 'accion',   label: '' },
                    ]}
                    loading={filas == null}
                    skeletonRows={3}
                    empty={{ icon: Pill, message: 'Nadie sacó ningún producto del listado' }}
                    minWidth="480px"
                    movil={MOVIL_REVISAR}
                >
                    {filtrarProductos(revisar.excluidos).map((p, i) => (
                        <DataRow key={p.product_id} index={i}>
                            <DataCell className="text-body-sm">
                                <p className="font-semibold">{p.producto}</p>
                                <p className="text-caption text-content-3">
                                    {p.en_el_libro ? 'Marcado para el libro bajo receta' : 'No es antibiótico'}
                                </p>
                            </DataCell>
                            <DataCell align="right">
                                {puedeEditar && (
                                    <Button variant="secondary" size="sm" icon={Undo2} onClick={() => devolver(p)}>
                                        Devolver
                                    </Button>
                                )}
                            </DataCell>
                        </DataRow>
                    ))}
                </DataTable>
            )}

            {editando && (
                <EditarAntibioticoModal
                    producto={editando.product_id ? editando : null}
                    onClose={() => setEditando(null)}
                    onHecho={alGuardar}
                />
            )}
        </div>
    );
}
