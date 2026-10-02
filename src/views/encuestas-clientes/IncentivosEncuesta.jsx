import React, { useCallback, useEffect, useState } from 'react';
import { Gift, UserCheck, Search, AlertTriangle } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import LiquidModal from '../../components/common/LiquidModal';
import SearchInput from '../../components/common/SearchInput';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { canalDe } from '@nucleo/utils/encuestasClientes';
import { fetchIncentivos, asignarIncentivo, fetchPersonas } from '@nucleo/data/encuestasClientes';
import { buscarClientes } from '@nucleo/data/customers';

const ESTADO = {
    acreditado: { label: 'Acreditado', variant: 'success' },
    entregado:  { label: 'Entregada',  variant: 'success' },
    pendiente:  { label: 'Pendiente',  variant: 'warning' },
    no_aplica:  { label: 'No aplica',  variant: 'neutral' },
};

/**
 * Lo que se dio por responder: puntos acreditados o pendientes, y muestras
 * entregadas o por entregar. Unos puntos quedan pendientes cuando el teléfono
 * no apunta a UNA sola ficha; acá se busca la ficha y se acreditan en el acto.
 */
export default function IncentivosEncuesta({ encuesta, puedeEditar }) {
    const showToast = useToastStore((s) => s.showToast);
    const [lista, setLista] = useState(null);
    const [personas, setPersonas] = useState({});
    const [error, setError] = useState(null);
    const [asignando, setAsignando] = useState(null);

    const cargar = useCallback(async () => {
        try {
            const l = await fetchIncentivos(encuesta.id);
            setLista(l);
            setPersonas(await fetchPersonas(l.flatMap((i) => [i.entrevistador_id, i.resuelto_por])));
            setError(null);
        } catch (err) {
            setError(err);
        }
    }, [encuesta.id]);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga de los incentivos

    if (error) return <Notice variant="danger" icon={AlertTriangle}>{mensajeAmigable(error, 'No se pudieron cargar los incentivos.')}</Notice>;
    if (!lista) return null;

    const cuenta = (e) => lista.filter((i) => i.estado === e).length;
    const puntosDados = lista.filter((i) => i.estado === 'acreditado').reduce((a, i) => a + (i.puntos || 0), 0);

    return (
        <section data-surface="card" className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-label uppercase tracking-wide font-semibold text-content-2 flex items-center gap-1.5 flex-1">
                    <Gift size={13} /> Incentivos
                </h3>
                <span className="text-body-sm text-content-2">
                    {encuesta.incentivo_tipo === 'puntos'
                        ? `${puntosDados} puntos acreditados · ${cuenta('pendiente')} pendiente(s)`
                        : `${cuenta('entregado')} entregada(s) · ${cuenta('pendiente')} por entregar`}
                </span>
            </div>
            {!lista.length ? (
                <p className="text-body-sm text-content-3">Todavía nadie ha dejado su teléfono para recibir el incentivo.</p>
            ) : (
                <ul className="divide-y divide-border-card">
                    {lista.map((i) => {
                        const est = ESTADO[i.estado] || ESTADO.pendiente;
                        const quien = personas[i.entrevistador_id];
                        return (
                            <li key={i.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                                <div className="min-w-0 flex-1">
                                    <p className="text-body-sm text-content font-medium">
                                        {i.cliente || i.contacto_nombre || 'Sin nombre'}
                                        {i.telefono && <span className="text-content-3 font-normal"> · {i.telefono.replace(/(\d{4})(\d{4})/, '$1-$2')}</span>}
                                    </p>
                                    <p className="text-micro text-content-3 flex items-center gap-1 flex-wrap">
                                        {i.sucursal} · {canalDe(i.canal).label} · {fechaTexto(i.created_at, { day: 'numeric', month: 'short' })}
                                        {quien && <><span>·</span><AvatarConEstado emp={quien} px={16} radio="rounded-full" marco="" />{shortEmployeeName(quien.name)}</>}
                                    </p>
                                    {i.estado === 'pendiente' && i.motivo && <p className="text-micro text-warning-text">{i.motivo}</p>}
                                </div>
                                <span className="text-body-sm text-content-2">{i.tipo === 'puntos' ? `${i.puntos} pts` : (i.descripcion || 'Muestra')}</span>
                                <Badge size="sm" variant={est.variant}>{est.label}</Badge>
                                {puedeEditar && i.tipo === 'puntos' && ['pendiente', 'no_aplica'].includes(i.estado) && (
                                    <Button variant="secondary" size="sm" icon={UserCheck} onClick={() => setAsignando(i)}>Asignar ficha</Button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
            {asignando && (
                <AsignarFicha incentivo={asignando} onClose={() => setAsignando(null)}
                    onListo={(r) => {
                        setAsignando(null);
                        showToast(r?.estado === 'acreditado' ? 'Puntos acreditados' : 'Ficha asignada',
                            r?.estado === 'no_aplica' ? 'Esa ficha no acumula puntos.' : null, r?.estado === 'acreditado' ? 'success' : 'warning');
                        cargar();
                    }} />
            )}
        </section>
    );
}

function AsignarFicha({ incentivo, onClose, onListo }) {
    const [texto, setTexto] = useState(incentivo.telefono || '');
    const [resultados, setResultados] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const [guardando, setGuardando] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        const q = texto.trim();
        if (q.length < 3) { setResultados([]); return undefined; } // eslint-disable-line react-hooks/set-state-in-effect -- limpia la búsqueda corta
        let vivo = true;
        setBuscando(true);
        const t = setTimeout(async () => {
            const { data, error: e } = await buscarClientes(q, { select: 'id, name, phone, acumula_puntos', limite: 8 });
            if (!vivo) return;
            setBuscando(false);
            if (e) setError(e); else setResultados(data || []);
        }, 300);
        return () => { vivo = false; clearTimeout(t); };
    }, [texto]);

    const elegir = async (c) => {
        setGuardando(c.id);
        setError(null);
        try {
            onListo(await asignarIncentivo(incentivo.id, c.id));
        } catch (err) {
            setError(err);
        } finally {
            setGuardando(null);
        }
    };

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-md" ariaLabel="Asignar ficha">
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">Asignar ficha</h2>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-3">
                    <p className="text-body-sm text-content-2">
                        {incentivo.puntos} puntos para {incentivo.contacto_nombre || 'quien respondió'}
                        {incentivo.telefono ? ` (${incentivo.telefono.replace(/(\d{4})(\d{4})/, '$1-$2')})` : ''}. Se acreditan al elegir la ficha.
                    </p>
                    <SearchInput value={texto} onChange={setTexto} placeholder="Nombre, teléfono, DUI…" icon={Search} />
                    {error && <Notice variant="danger" icon={AlertTriangle} compact>{mensajeAmigable(error, 'No se pudo asignar.')}</Notice>}
                    <ul className="space-y-1">
                        {resultados.map((c) => (
                            <li key={c.id}>
                                <button type="button" disabled={!!guardando || c.acumula_puntos === false}
                                    onClick={() => elegir(c)}
                                    className="w-full text-left rounded-xl border border-border-card px-3 py-2 min-h-[var(--tap-min)]
                                        hover:bg-surface-card-hover active:scale-[0.99] disabled:opacity-50">
                                    <span className="block text-body-sm font-medium text-content">{c.name}</span>
                                    <span className="block text-micro text-content-3">
                                        {c.phone || 'Sin teléfono'}{c.acumula_puntos === false ? ' · no acumula puntos' : ''}
                                    </span>
                                </button>
                            </li>
                        ))}
                        {!buscando && texto.trim().length >= 3 && !resultados.length && (
                            <li className="text-body-sm text-content-3">Sin fichas con esa búsqueda.</li>
                        )}
                    </ul>
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
