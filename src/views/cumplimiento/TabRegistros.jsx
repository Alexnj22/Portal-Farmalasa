import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, CheckCircle2, ClipboardList, Pencil, Plus, Printer } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PromptModal from '../../components/common/PromptModal';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { useToastStore } from '@nucleo/store/toastStore';
import {
    anularRegistroDeCumplimiento, fetchRegistrosDeCumplimiento, mensajeDeCumplimiento,
} from '@nucleo/data/cumplimiento';
import { TIPOS, camposAlCerrar, estadoDelPlazo, nombreDelSemestre } from '@nucleo/utils/cumplimiento';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { registrarEgreso } from '@nucleo/data/egreso';
import { abrirVentanaDeImpresion, escribirEImprimir, VENTANA_BLOQUEADA } from '../../plataforma/ventanaDeImpresion';
import RegistroModal from './RegistroModal';

/*
 * La lista de registros de uno o varios tipos (2026-11-11). Cada pestaña de
 * Cumplimiento es esta misma lista con otros tipos y otro texto: crear,
 * corregir mientras está abierto, cerrar (la notificación hecha, la
 * destrucción realizada, el retiro devuelto), anular con motivo e imprimir el
 * papel que se firma. La base decide el permiso; acá sólo se esconde el botón.
 *
 * `branchId` null = toda la red (sólo con alcance de todas): se lista, pero
 * para crear hay que elegir una sala — salvo el retiro, que se puede avisar a
 * todas de una vez (`retiroATodas`).
 */

const resumenDe = (r) => {
    const d = r.datos || {};
    switch (r.tipo) {
        case 'farmacovigilancia': return [d.producto, d.reaccion].filter(Boolean).join(' · ');
        case 'reporte_cero': return `Sin reacciones adversas · ${nombreDelSemestre(d.periodo)}`;
        case 'vencido': return [d.producto, d.lote && `lote ${d.lote}`, d.cantidad && `${d.cantidad} u.`].filter(Boolean).join(' · ');
        case 'destruccion': return [`${(d.productos || []).length} producto(s)`, d.gestora].filter(Boolean).join(' · ');
        case 'retiro': return [d.producto, d.lote && `lote ${d.lote}`, d.alerta].filter(Boolean).join(' · ');
        case 'autoinspeccion':
        case 'a_la_vista': return d.resultado ? `${d.resultado.porcentaje} % · ${d.resultado.aprueba ? 'Aprueba' : 'No aprueba'}` : '';
        case 'capacitacion': return [d.tema, `${(d.asistentes || []).length} asistentes`].filter(Boolean).join(' · ');
        default: return '';
    }
};

export default function TabRegistros({ tipos, branchId, sala, puedeEditar, retiroATodas = false, aviso = null, vacio }) {
    const showToast = useToastStore((s) => s.showToast);
    const [registros, setRegistros] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [modal, setModal] = useState(null); // { tipo, modo, registro, aTodas }
    const [anulando, setAnulando] = useState(null);
    const [procesando, setProcesando] = useState(false);
    const hoy = hoySV();
    const claves = useMemo(() => tipos.map((t) => t.tipo), [tipos]);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);
        const { registros: r, error: e } = await fetchRegistrosDeCumplimiento({ tipos: claves, branchId });
        setCargando(false);
        if (e) { setError(mensajeDeCumplimiento(e)); return; }
        setRegistros(r);
    }, [claves, branchId]);
    useEffect(() => { cargar(); }, [cargar]);

    const imprimir = async (r) => {
        const win = abrirVentanaDeImpresion({ ancho: 1000, alto: 800 });
        if (!win) { setError(VENTANA_BLOQUEADA); return; }
        const papel = await import('@nucleo/utils/papelDeCumplimiento').catch(() => null);
        if (!papel) {
            try { win.close(); } catch { /* ya no está */ }
            setError('No se pudo preparar la impresión. Revisa tu conexión y vuelve a intentar.');
            return;
        }
        const res = escribirEImprimir(win, papel.htmlDelRegistro(r));
        if (!res.ok) { setError(res.motivo); return; }
        registrarEgreso('cumplimiento', { formato: 'pdf', filas: 1, detalle: { tipo: r.tipo, id: r.id, branch_id: r.branch_id } });
    };

    const anular = async (motivo) => {
        setProcesando(true);
        const { error: e } = await anularRegistroDeCumplimiento(anulando.id, motivo);
        setProcesando(false);
        if (e) { showToast('No se pudo anular', mensajeDeCumplimiento(e), 'error'); return; }
        setAnulando(null);
        showToast('Registro anulado', anulando.sala, 'success');
        cargar();
    };

    const abiertos = registros.filter((r) => r.estado === 'abierto' && !r.anulado_at).length;

    return (
        <div className="space-y-4">
            {aviso && <Notice variant="info">{aviso}</Notice>}
            {puedeEditar && (
                <div className="flex flex-wrap items-center gap-2 justify-end">
                    {abiertos > 0 && <span className="text-body-sm text-content-3 mr-auto">{abiertos} abierto{abiertos === 1 ? '' : 's'}</span>}
                    {retiroATodas && (
                        <Button variant="secondary" size="sm" icon={Plus}
                            onClick={() => setModal({ tipo: 'retiro', modo: 'crear', aTodas: true })}>
                            Avisar retiro a todas las salas
                        </Button>
                    )}
                    {tipos.map((t) => (
                        <Button key={t.tipo} variant={t.principal ? 'primary' : 'secondary'} size="sm" icon={Plus}
                            disabled={!branchId} title={branchId ? undefined : 'Elige una sala para anotar'}
                            onClick={() => setModal({ tipo: t.tipo, modo: 'crear' })}>
                            {t.boton}
                        </Button>
                    ))}
                </div>
            )}
            {puedeEditar && !branchId && (
                <p className="text-caption text-content-3 text-right">Para anotar, elige una sala en el filtro.</p>
            )}
            {error && <Notice variant="danger">{error}</Notice>}

            {cargando && registros.length === 0 ? (
                <LoadingState label="Cargando registros…" />
            ) : registros.length === 0 ? (
                <EmptyState icon={ClipboardList} title={vacio?.titulo || 'Sin registros'} subtitle={vacio?.subtitulo} />
            ) : (
                <ul className="space-y-2">
                    {registros.map((r) => {
                        const def = TIPOS[r.tipo];
                        const plazo = estadoDelPlazo(r, hoy);
                        const abierto = r.estado === 'abierto' && !r.anulado_at;
                        const seCierra = camposAlCerrar(r.tipo).length > 0;
                        return (
                            <li key={r.id} data-surface="card" className={`p-4 flex flex-col md:flex-row md:items-start gap-3 ${r.anulado_at ? 'opacity-60' : ''}`}>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="text-body font-bold text-content">{def?.corto}</p>
                                        <Badge variant={plazo.tono} uppercase={false}>{plazo.texto}</Badge>
                                        {!branchId && <span className="text-body-sm text-content-3">{r.sala}</span>}
                                    </div>
                                    <p className="text-body-sm text-content-2 mt-0.5">{resumenDe(r)}</p>
                                    <p className="text-caption text-content-3 mt-1">
                                        {fechaTexto(r.fecha, { day: '2-digit', month: 'short', year: 'numeric' })}
                                        {r.registrado_por_nombre && ` · anotó ${shortEmployeeName({ name: r.registrado_por_nombre })}`}
                                        {r.cerrado_por_nombre && ` · cerró ${shortEmployeeName({ name: r.cerrado_por_nombre })}`}
                                    </p>
                                    {r.anulado_at && <p className="text-caption text-content-3 mt-1">Anulado: {r.anulado_motivo}</p>}
                                </div>
                                <div className="flex flex-wrap gap-1 shrink-0">
                                    <Button variant="ghost" size="sm" icon={Printer} onClick={() => imprimir(r)}>Imprimir</Button>
                                    {puedeEditar && abierto && seCierra && (
                                        <Button variant="secondary" size="sm" icon={CheckCircle2}
                                            onClick={() => setModal({ tipo: r.tipo, modo: 'cerrar', registro: r })}>
                                            {r.tipo === 'farmacovigilancia' ? 'Notificada' : 'Cerrar'}
                                        </Button>
                                    )}
                                    {puedeEditar && abierto && (
                                        <Button variant="ghost" size="sm" icon={Pencil}
                                            onClick={() => setModal({ tipo: r.tipo, modo: 'crear', registro: r })}>Corregir</Button>
                                    )}
                                    {puedeEditar && !r.anulado_at && (
                                        <Button variant="ghost" size="sm" icon={Ban} onClick={() => setAnulando(r)}>Anular</Button>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {modal && (
                <RegistroModal tipo={modal.tipo} modo={modal.modo} registro={modal.registro}
                    branchId={modal.registro?.branch_id ?? branchId} sala={modal.registro?.sala ?? sala}
                    aTodas={!!modal.aTodas}
                    onClose={() => setModal(null)}
                    onHecho={() => { setModal(null); cargar(); }} />
            )}
            <PromptModal isOpen={!!anulando} onClose={() => setAnulando(null)} onConfirm={anular}
                title="Anular registro" message="El registro no se borra: queda anulado con este motivo."
                placeholder="¿Por qué se anula?" confirmText="Anular" required isProcessing={procesando} />
        </div>
    );
}
