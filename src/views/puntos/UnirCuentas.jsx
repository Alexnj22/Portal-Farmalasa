/**
 * Unir dos cuentas de puntos de la misma persona (2026-10-15).
 *
 * Pedido del usuario: «Ana Eduviges Calderón y Ana Calderón es la misma
 * persona, pero tiene puntos en ambas». Se abre desde la cuenta que SE QUEDA y
 * se elige la otra: así nadie tiene que pensar en «origen» y «destino», sólo en
 * «traer los puntos de esa cuenta a ésta».
 *
 * Primero pregunta a la base qué pasaría (`simular`) y muestra los dos saldos y
 * el resultado; recién con eso se confirma. La base vuelve a exigir el permiso y
 * rechaza las uniones que no tienen sentido (una cuenta ya unida, una que no
 * participa del programa).
 */
import React, { useState, useEffect } from 'react';
import { Merge, ArrowRight } from 'lucide-react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import SearchInput from '../../components/common/SearchInput';
import PortalInput from '../../components/common/PortalInput';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatQty } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { fetchClientesConPuntos, fusionarCuentasDePuntos } from '@nucleo/data/puntos';

const pts = (n) => formatQty(Number(n) || 0);

export function AvisoDeUniones({ fusionadaEn, recibidas }) {
    if (fusionadaEn) {
        return (
            <Notice variant="info" bloque>
                Esta cuenta se unió a la de <strong>{fusionadaEn.destino_nombre}</strong> el{' '}
                {fechaTexto(fusionadaEn.created_at, { day: 'numeric', month: 'short', year: 'numeric' })}.
                Sus puntos y lo que compre con esta ficha se suman en esa cuenta.
            </Notice>
        );
    }
    if (!recibidas.length) return null;
    return (
        <Notice variant="info" bloque>
            Esta cuenta reúne también los puntos de{' '}
            {recibidas.map((u, i) => (
                <React.Fragment key={u.id}>
                    {i > 0 && (i === recibidas.length - 1 ? ' y ' : ', ')}
                    <strong>{u.origen_nombre}</strong>
                </React.Fragment>
            ))}
            . Lo que compre con esa ficha también se suma aquí.
        </Notice>
    );
}

export default function UnirCuentas({ customerId, nombre, onCerrar, onHecho }) {
    const showToast = useToastStore((s) => s.showToast);
    const [busqueda, setBusqueda] = useState('');
    const [resultados, setResultados] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const [otra, setOtra] = useState(null);
    const [vista, setVista] = useState(null);
    const [nota, setNota] = useState('');
    const [guardando, setGuardando] = useState(false);

    // Busca en la base (son ~28,500 clientes), con una pausa para no salir con
    // cada tecla.
    useEffect(() => {
        const q = busqueda.trim();
        if (q.length < 3) { setResultados([]); return undefined; }
        let vivo = true;
        setBuscando(true);
        const t = setTimeout(async () => {
            try {
                const r = await fetchClientesConPuntos({ busqueda: q, limite: 8 });
                if (vivo) setResultados((r?.filas ?? []).filter((c) => c.customer_id !== customerId));
            } catch (e) {
                if (vivo) showToast('No se pudo buscar', mensajeAmigable(e), 'error');
            } finally {
                if (vivo) setBuscando(false);
            }
        }, 350);
        return () => { vivo = false; clearTimeout(t); };
    }, [busqueda, customerId, showToast]);

    // Al elegir la otra cuenta, la base dice qué pasaría.
    useEffect(() => {
        if (!otra) { setVista(null); return undefined; }
        let vivo = true;
        fusionarCuentasDePuntos({ origen: otra.customer_id, destino: customerId, simular: true })
            .then((r) => { if (vivo) setVista(r); })
            .catch((e) => { if (vivo) { setVista({ error: mensajeAmigable(e) }); } });
        return () => { vivo = false; };
    }, [otra, customerId]);

    const unir = async () => {
        setGuardando(true);
        try {
            // La bitácora la anota `fusionarCuentasDePuntos`.
            const r = await fusionarCuentasDePuntos(
                { origen: otra.customer_id, destino: customerId, nota, simular: false },
                { nombre, origen_nombre: otra.nombre });
            showToast('Cuentas unidas', `Ahora tiene ${pts(r?.saldo_final)} puntos.`, 'success');
            onHecho?.();
        } catch (e) {
            showToast('No se pudieron unir', mensajeAmigable(e), 'error');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <section data-surface="card" className="p-4 md:p-5 flex flex-col gap-4 min-w-0">
            <div>
                {/* Mismo encabezado que «Dar o quitar puntos»: los dos paneles se
                    abren en el mismo lugar y tienen que leerse como hermanos. */}
                <h3 className="text-caption font-black text-content-2 uppercase tracking-wide flex items-center gap-2">
                    <Merge size={14} /> Unir con otra cuenta
                </h3>
                <p className="text-caption text-content-3 mt-1">
                    Para la misma persona con dos fichas. Los puntos de la otra cuenta pasan a ésta con sus
                    fechas de vencimiento, y lo que compre después con la otra ficha también se suma aquí.
                </p>
            </div>

            {!otra ? (
                <div className="flex flex-col gap-2">
                    <SearchInput value={busqueda} onChange={setBusqueda} autoFocus loading={buscando}
                        placeholder="Nombre, DUI o teléfono de la otra cuenta" ariaLabel="Buscar la otra cuenta" />
                    {busqueda.trim().length >= 3 && !buscando && resultados.length === 0 && (
                        <p className="text-caption text-content-3">Sin coincidencias.</p>
                    )}
                    {resultados.length > 0 && (
                        <ul className="flex flex-col divide-y divide-divider">
                            {resultados.map((c) => (
                                <li key={c.customer_id}>
                                    <button type="button" onClick={() => setOtra(c)}
                                        className="w-full min-h-[var(--tap-min)] flex items-center justify-between gap-3 py-2 px-1 text-left rounded-lg hover:bg-surface-card-hover active:scale-[0.97] transition">
                                        <span className="min-w-0">
                                            <span className="block font-bold text-content truncate">{c.nombre}</span>
                                            <span className="block text-caption text-content-3 tabular-nums">
                                                {c.dui || 'Sin DUI'} · {c.telefono || 'Sin teléfono'}
                                            </span>
                                        </span>
                                        <span className="font-black tabular-nums text-content shrink-0">{pts(c.saldo)} pts</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            ) : !vista ? (
                <p className="text-caption text-content-3">Revisando las dos cuentas…</p>
            ) : vista.error ? (
                <Notice variant="warning" bloque>{vista.error}</Notice>
            ) : (
                <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3">
                        <div className="min-w-0">
                            <p className="text-caption font-bold text-content-3">Se une</p>
                            <p className="font-bold text-content truncate">{vista.origen?.nombre}</p>
                            <p className="tabular-nums text-content-2">{pts(vista.origen?.saldo)} puntos</p>
                        </div>
                        <ArrowRight size={18} className="text-content-3 hidden sm:block" />
                        <div className="min-w-0">
                            <p className="text-caption font-bold text-content-3">A esta cuenta</p>
                            <p className="font-bold text-content truncate">{vista.destino?.nombre}</p>
                            <p className="tabular-nums text-content-2">{pts(vista.destino?.saldo)} puntos</p>
                        </div>
                    </div>
                    <p className="text-body-sm text-content">
                        Quedará con <span className="font-black tabular-nums">{pts(vista.saldo_final)}</span> puntos.
                    </p>
                    <PortalInput label="Detalle" name="nota_union" value={nota}
                        placeholder="Opcional: cómo se confirmó que es la misma persona"
                        onChange={(e) => setNota(e.target.value.slice(0, 200))} />
                    <Notice variant="warning" bloque>
                        No se deshace desde aquí: después de unir, los canjes toman puntos de las dos historias.
                    </Notice>
                </div>
            )}

            <div className="flex flex-wrap justify-end gap-2">
                {otra && (
                    <Button variant="ghost" size="sm" onClick={() => setOtra(null)} disabled={guardando}>
                        Elegir otra
                    </Button>
                )}
                <Button variant="ghost" size="sm" onClick={onCerrar} disabled={guardando}>Cancelar</Button>
                {otra && vista && !vista.error && (
                    <Button variant="primary" size="sm" icon={Merge} onClick={unir} disabled={guardando} loading={guardando}>
                        Unir cuentas
                    </Button>
                )}
            </div>
        </section>
    );
}
