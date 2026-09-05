/**
 * Solicitudes sobre datos personales.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * El formulario de la sala de ventas tiene un espacio «Formulario n.º» y nadie
 * lo generaba ni lo llevaba. Sin ese número no hay forma de saber cuántas
 * solicitudes entraron, cuáles vencen esta semana ni cuáles quedaron sin
 * responder, y el Art. 54 de la Ley para la Protección de Datos Personales pone
 * sobre la Empresa la carga de PROBAR que respondió a tiempo.
 *
 * ── La fila nace al IMPRIMIR ────────────────────────────────────────────────
 * «Nueva solicitud» toma el correlativo, lo estampa en la hoja y en el acuse, y
 * manda el papel a la impresora ya numerado. Nadie escribe el número a mano ni
 * puede repetirlo, y la serie no tiene huecos que nadie pueda explicar.
 *
 * ── Lo que NO hace, y es a propósito ────────────────────────────────────────
 * No recibe solicitudes en línea de clientes. La comprobación de identidad
 * exige ver el documento (Art. 16 letra c), y quien escribe desde una página
 * pública puede ser cualquiera. El papel no desaparece: deja de ser el registro.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { ShieldCheck, Printer, Clock, Inbox, AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import PeriodStepper from '../components/common/PeriodStepper';
import PeriodPicker from '../components/common/PeriodPicker';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import Notice from '../components/common/Notice';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import { usePestanaEnUrl } from '../hooks/usePestanaEnUrl';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { mensajeAmigable } from '../utils/errorMessages';
import { abrirVentanaDeImpresion, escribirEImprimir, VENTANA_BLOQUEADA } from '../utils/ventanaDeImpresion';
import { papelDeSolicitudDeDatos } from '../generated/formularioDatos';
import { fetchSolicitudes, crearSolicitud, plazoDe, DERECHOS, ESTADOS } from '../data/solicitudesDatos';
import SolicitudModal from './datos/SolicitudModal';

const PESTANAS = [
    { key: 'tramite',   label: 'En trámite', icon: Clock },
    { key: 'resueltas', label: 'Resueltas',  icon: ShieldCheck },
    { key: 'todas',     label: 'Todas',      icon: Inbox },
];

const COLUMNAS = [
    { key: 'folio',    label: 'Formulario' },
    { key: 'quien',    label: 'Quién solicita' },
    { key: 'pide',     label: 'Qué pide' },
    { key: 'recibida', label: 'Recibida' },
    { key: 'plazo',    label: 'Plazo' },
    { key: 'estado',   label: 'Estado' },
    // Sin rótulo: `DataTable` lo lee como columna de acciones.
    { key: 'acciones', label: '' },
];

const ESTADO_OPCIONES = [
    { value: 'TODOS', label: 'Todos' },
    ...Object.entries(ESTADOS).map(([k, v]) => ({ value: k, label: v.rotulo })),
];

const ROTULO = Object.fromEntries(DERECHOS.map((d) => [d.clave, d.rotulo]));

const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/El_Salvador' });
const fecha = (iso) => iso
    ? new Date(iso).toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

export default function SolicitudesDatosView() {
    const { user } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const [pestana, setPestana] = usePestanaEnUrl(PESTANAS, 'tramite');

    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [creando, setCreando] = useState(false);
    const [abierta, setAbierta] = useState(null);
    const [busqueda, setBusqueda] = useState('');
    const [estado, setEstado] = useState('TODOS');
    // Arranca vacío: el registro entero cabe en una pantalla, y estrenar la
    // vista con un recorte de fechas escondería las solicitudes viejas que
    // justamente son las que llevan más tiempo esperando.
    const [periodo, setPeriodo] = useState('');
    const [desde, hasta] = periodo ? periodo.split('|') : ['', ''];

    useEffect(() => {
        let vivo = true;
        (async () => {
            try {
                const datos = await fetchSolicitudes();
                if (vivo) setFilas(datos);
            } catch (e) {
                if (vivo) showToast('No se pudo cargar', mensajeAmigable(e), 'error');
            } finally {
                if (vivo) setCargando(false);
            }
        })();
        return () => { vivo = false; };
    }, [showToast]);

    const visibles = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        return filas.filter((s) => {
            if (pestana === 'resueltas' && s.estado !== 'RESUELTA') return false;
            if (pestana === 'tramite' && (s.estado === 'RESUELTA' || s.estado === 'ANULADA')) return false;
            if (estado !== 'TODOS' && s.estado !== estado) return false;
            if (desde || hasta) {
                // Se filtra por la fecha del ACUSE cuando existe, y por la de
                // impresión cuando no: una hoja que todavía no volvió no tiene
                // fecha de recepción, y descartarla la haría invisible.
                const d = (s.recibida_at ?? s.impresa_at).slice(0, 10);
                if (desde && d < desde) return false;
                if (hasta && d > hasta) return false;
            }
            if (!q) return true;
            return [s.folio_txt, s.solicitante_nombre, s.solicitante_numero, s.descripcion]
                .some((v) => String(v ?? '').toLowerCase().includes(q));
        });
    }, [filas, pestana, estado, desde, hasta, busqueda]);

    const vencidas = useMemo(() => filas.filter((s) => plazoDe(s)?.vencida).length, [filas]);
    const apremian = useMemo(() => filas.filter((s) => plazoDe(s)?.apremia).length, [filas]);

    /**
     * Manda un papel a la impresora.
     *
     * La ventana se abre SINCRÓNICA dentro del clic y antes de ir a la base:
     * después de un `await` el bloqueador de emergentes la mata, porque la
     * activación del usuario es transitoria.
     */
    const imprimir = (fila) => {
        const win = abrirVentanaDeImpresion({ ancho: 900, alto: 1000 });
        if (!win) { showToast('No se pudo imprimir', VENTANA_BLOQUEADA, 'error'); return; }
        const r = escribirEImprimir(win, papelDeSolicitudDeDatos(fila.folio_txt));
        useStaff.getState().appendAuditLog?.('REIMPRIMIR_SOLICITUD_DATOS', String(fila.id),
            { folio: fila.folio_txt });
        if (!r.ok) showToast('No se pudo imprimir', r.motivo ?? 'La ventana no respondió.', 'error');
    };

    const nueva = async () => {
        const win = abrirVentanaDeImpresion({ ancho: 900, alto: 1000 });
        if (!win) { showToast('No se pudo imprimir', VENTANA_BLOQUEADA, 'error'); return; }
        setCreando(true);
        try {
            const fila = await crearSolicitud(user?.branchId ?? null);
            const r = escribirEImprimir(win, papelDeSolicitudDeDatos(fila.folio_txt));
            useStaff.getState().appendAuditLog?.('IMPRIMIR_SOLICITUD_DATOS', String(fila.id),
                { folio: fila.folio_txt });
            if (!r.ok) showToast('No se pudo imprimir', r.motivo ?? 'La ventana no respondió.', 'error');
            setFilas((p) => [fila, ...p]);
        } catch (e) {
            try { win.close(); } catch { /* ya no está */ }
            showToast('No se pudo crear', mensajeAmigable(e), 'error');
        } finally {
            setCreando(false);
        }
    };

    const limpiar = () => { setEstado('TODOS'); setPeriodo(''); };

    const filtersContent = (
        <ViewTabBar
            tabs={PESTANAS}
            activeTab={pestana}
            onTabChange={setPestana}
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder="Buscar por formulario, nombre o documento…"
        />
    );

    return (
        <GlassViewLayout icon={ShieldCheck} title="Solicitudes sobre datos" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-6">

                {(vencidas > 0 || apremian > 0) && (
                    <Notice variant={vencidas > 0 ? 'danger' : 'warning'} icon={AlertTriangle} bloque>
                        {vencidas > 0
                            ? `${vencidas} solicitud${vencidas === 1 ? '' : 'es'} pasó del plazo de veinte días hábiles. No atender en tiempo y forma es una infracción grave del Art. 56.`
                            : `${apremian} solicitud${apremian === 1 ? '' : 'es'} vence dentro de tres días hábiles o menos.`}
                    </Notice>
                )}

                {/* Orden canónico de las ranuras: tiempo → estado (§17). No hay
                    ranura de sucursal: el delegado es UNO para toda la empresa
                    (Art. 15), así que un alcance por sala partiría en siete un
                    registro que la ley trata como uno solo. */}
                <div className="flex justify-end min-w-0">
                    <FilterBar
                        onClear={limpiar}
                        activeCount={[!!periodo, estado !== 'TODOS'].filter(Boolean).length}
                        acciones={[{
                            key: 'nueva',
                            icon: creando ? Loader2 : Printer,
                            label: 'Nueva solicitud',
                            onClick: nueva,
                            variant: 'primary',
                            disabled: creando,
                        }]}
                    >
                        <FilterBar.Section active={!!periodo} onClear={() => setPeriodo('')} label="fecha">
                            <PeriodStepper unit="día" onPrev={() => {}} onNext={() => {}}
                                prevDisabled nextDisabled>
                                <PeriodPicker value={periodo || `${hoyISO()}|${hoyISO()}`}
                                    onChange={setPeriodo} placeholder="Período…" />
                            </PeriodStepper>
                        </FilterBar.Section>

                        <FilterBar.Section active={estado !== 'TODOS'}
                            onClear={() => setEstado('TODOS')} label="estado">
                            <FilterBar.Opciones value={estado} onChange={setEstado}
                                options={ESTADO_OPCIONES} label="Estado" />
                        </FilterBar.Section>
                    </FilterBar>
                </div>

                <DataTable
                    columns={COLUMNAS}
                    loading={cargando}
                    minWidth="940px"
                    movil={{ usarAccionDeFila: true, acciones: 'mantener' }}
                    empty={{ icon: Inbox, message: busqueda.trim() ? 'Sin coincidencias' : 'Sin solicitudes' }}
                >
                    {visibles.map((s, i) => {
                        const plazo = plazoDe(s);
                        return (
                            <DataRow key={s.id} index={i} onClick={() => setAbierta(s)}>
                                <DataCell>
                                    <span className="font-black tabular-nums text-content">{s.folio_txt}</span>
                                </DataCell>
                                <DataCell>{s.solicitante_nombre || <span className="text-content-3">Sin llenar</span>}</DataCell>
                                <DataCell>
                                    {(s.derechos?.length ?? 0) === 0
                                        ? <span className="text-content-3">—</span>
                                        : <span className="text-caption">{s.derechos.map((d) => ROTULO[d] ?? d).join(', ')}</span>}
                                </DataCell>
                                <DataCell>{fecha(s.recibida_at)}</DataCell>
                                <DataCell>
                                    {!plazo ? <span className="text-content-3">—</span> : (
                                        <Badge variant={plazo.vencida ? 'danger' : plazo.apremia ? 'warning' : 'neutral'}
                                            uppercase={false}>
                                            {plazo.vencida
                                                ? `Vencida hace ${Math.abs(plazo.restan)}`
                                                : `${plazo.restan} d. hábiles`}
                                        </Badge>
                                    )}
                                </DataCell>
                                <DataCell>
                                    <Badge variant={s.estado === 'RESUELTA' ? 'success' : 'neutral'}
                                        tone="soft" uppercase={false} title={ESTADOS[s.estado]?.que}>
                                        {ESTADOS[s.estado]?.rotulo ?? s.estado}
                                    </Badge>
                                </DataCell>
                                <DataCell align="right">
                                    <Button variant="ghost" size="sm" iconOnly icon={RotateCcw}
                                        title="Reimprimir el formulario"
                                        onClick={(e) => { e.stopPropagation(); imprimir(s); }} />
                                </DataCell>
                            </DataRow>
                        );
                    })}
                </DataTable>
            </div>

            <SolicitudModal open={!!abierta} solicitud={abierta}
                onClose={() => setAbierta(null)}
                onGuardada={(fila) => setFilas((p) => p.map((s) => (s.id === fila.id ? fila : s)))} />
        </GlassViewLayout>
    );
}
