/**
 * Puntos → Premios (2026-10-19, pedido del usuario).
 *
 * Los premios del raspable que NO son puntos: un PRODUCTO del inventario o un
 * regalo PROMOCIONAL. Salen en el sorteo del mes (`puntos_dar_cupones`), el
 * cliente elige en la app la sucursal donde lo retira, y acá:
 *
 *   · Por entregar — la sala busca el premio (código, cliente o DUI) y lo
 *     entrega. Un producto se DESCARGA en el sistema de la caja con el
 *     concepto «PREMIO PUNTOS SALUD - código - cliente»; un promocional baja
 *     del inventario de regalos de la sala. Lo hace `entregar-premio`.
 *   · Regalos — el catálogo de promocionales, lo que hay en cada sala y los
 *     envíos desde Bodega, que la sala de destino confirma al recibirlos.
 *
 * Quién puede qué lo decide la base: administrar el catálogo y mandar regalos
 * es de quien edita los niveles; entregar y recibir, de la sala propia.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Gift, PackageCheck, PackagePlus, Pencil, Plus, Send, Truck } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import SearchInput from '../../components/common/SearchInput';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidModal from '../../components/common/LiquidModal';
import Switch from '../../components/common/Switch';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useTextoRebotado } from '@nucleo/hooks/useBusqueda';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto } from '@nucleo/utils/fecha';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { leerCodigoDePremio } from '@nucleo/utils/codigoDePremio';
import EntregarPremioEscaneado from './EntregarPremioEscaneado';
import {
    ESTADO_DE_PREMIO, TITULO_DIALOGO_REGALO, detalleDelPremio, dondeSeRetiraElPremio, faltaEnRegalo,
} from '@nucleo/utils/nivelesDePuntos';
import {
    ajustarPromocional, enviarPromocional, fetchPremiosPorEntregar, fetchPromocionales,
    guardarPromocional, recibirPromocional,
} from '@nucleo/data/puntos';

const fechaCorta = (f) => fechaTexto(f, { day: 'numeric', month: 'short' }, '—');

// El estado, dónde se retira y qué le falta a un regalo: núcleo (`nivelesDePuntos`), lo mismo en la app.
const ESTADO = ESTADO_DE_PREMIO;

/** El rótulo de un campo que no lo trae (LiquidSelect), con la letra de PortalInput. */
const Campo = ({ rotulo, children }) => (
    <div className="flex flex-col gap-1.5 min-w-0">
        <span className="text-caption font-black uppercase tracking-widest text-content-3 ml-1">{rotulo}</span>
        {children}
    </div>
);

export default function PremiosDelPrograma({ puedeAdministrar, miSala }) {
    const salas = useStaffStore((s) => s.branches);
    const nombreSala = useCallback((id) => (salas || []).find((b) => Number(b.id) === Number(id))?.name ?? '—', [salas]);
    const opcionesSala = useMemo(() => (salas || []).map((b) => ({ value: b.id, label: b.name })), [salas]);

    return (
        <div className="flex flex-col gap-6">
            <PorEntregar puedeAdministrar={puedeAdministrar} miSala={miSala} nombreSala={nombreSala} opcionesSala={opcionesSala} />
            <Regalos puedeAdministrar={puedeAdministrar} miSala={miSala} nombreSala={nombreSala} opcionesSala={opcionesSala} />
        </div>
    );
}

// ── Por entregar ────────────────────────────────────────────────────────────
function PorEntregar({ puedeAdministrar, miSala, nombreSala, opcionesSala }) {
    // La sala ve la suya y nada más; administración elige (vacío = todas).
    const [sala, setSala] = useState(puedeAdministrar ? '' : miSala);
    const [texto, setTexto] = useState('');
    const rebotado = useTextoRebotado(texto, 300);
    // El lector teclea el código sin guion (PS000123): se busca en la forma de la base.
    const buscar = leerCodigoDePremio(rebotado) ?? rebotado;
    const [escaneado, setEscaneado] = useState(null);
    const cerrarEscaneado = useCallback(() => setEscaneado(null), []);
    const [entregados, setEntregados] = useState(false);
    const [premios, setPremios] = useState(null);
    const [error, setError] = useState(null);
    const [version, setVersion] = useState(0);
    // La sala que entrega: la elegida (administración) o la propia.
    const salaQueEntrega = sala !== '' && sala != null ? Number(sala) : miSala;

    useEffect(() => {
        if (!puedeAdministrar && !miSala) return undefined;
        let vivo = true;
        fetchPremiosPorEntregar(sala === '' ? null : Number(sala), buscar, entregados)
            .then((r) => { if (vivo) { setPremios(r ?? []); setError(null); } })
            .catch((e) => { if (vivo) { setPremios([]); setError(mensajeAmigable(e)); } });
        return () => { vivo = false; };
    }, [sala, buscar, entregados, version, puedeAdministrar, miSala]);

    if (!puedeAdministrar && !miSala) {
        return <Notice variant="warning">Tu ficha no tiene sucursal: no hay premios que entregar desde aquí.</Notice>;
    }

    return (
        <section className="flex flex-col gap-3">
            <h3 className="text-body font-black text-content flex items-center gap-2"><Gift size={16} /> Premios por entregar</h3>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <SearchInput value={texto} onChange={setTexto} placeholder="Escanea el código del premio, o busca por cliente o DUI" className="flex-1"
                    onKeyDown={(e) => {
                        // Escanear y Enter: directo a confirmar la entrega.
                        const codigo = e.key === 'Enter' ? leerCodigoDePremio(texto) : null;
                        if (codigo) { e.preventDefault(); setTexto(''); setEscaneado(codigo); }
                    }} />
                {puedeAdministrar && (
                    <div className="sm:w-56">
                        <LiquidSelect options={opcionesSala} value={sala} onChange={(v) => setSala(v === '' ? '' : Number(v))}
                            placeholder="Todas las sucursales" />
                    </div>
                )}
                <label className="flex items-center gap-2 text-body-sm text-content-2 min-h-[var(--tap-min)] shrink-0">
                    <Switch checked={entregados} onChange={setEntregados} label="Ver entregados" />
                    Ver entregados
                </label>
            </div>
            {error && <Notice variant="danger" compact>{error}</Notice>}
            {premios == null ? (
                <p className="text-body-sm text-content-3 py-4 text-center">Cargando…</p>
            ) : premios.length === 0 ? (
                <p className="text-body-sm text-content-3 py-4 text-center">
                    {buscar ? 'Ningún premio coincide.' : 'No hay premios por entregar.'}
                </p>
            ) : (
                <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {premios.map((p) => {
                        const e = ESTADO[p.estado] ?? ESTADO.POR_RETIRAR;
                        const donde = dondeSeRetiraElPremio(p, nombreSala);
                        return (
                            <li key={p.id} data-surface="card" className="rounded-xl p-3 flex flex-col gap-1.5 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-body-sm font-bold text-content truncate">
                                            {Number(p.cantidad) > 1 ? `${p.cantidad} × ` : ''}{p.nombre}
                                        </p>
                                        <p className="text-caption text-content-3">{detalleDelPremio(p)}</p>
                                    </div>
                                    <Badge variant={e.variante} tone="soft" uppercase={false}>{e.texto}</Badge>
                                </div>
                                <p className="text-caption text-content-2 truncate">
                                    {p.cliente?.nombre ?? '—'}{p.cliente?.documento ? ` · ${p.cliente.documento}` : ''}
                                </p>
                                <p className="text-caption text-content-3">
                                    {donde}{' · '}vence {fechaCorta(p.vence_el)}
                                </p>
                                {p.estado === 'POR_RETIRAR' && salaQueEntrega && (
                                    <Button variant="primary" size="sm" icon={PackageCheck} className="self-start"
                                        onClick={() => setEscaneado(p.codigo)}>
                                        Entregar aquí
                                    </Button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
            {escaneado && (
                <EntregarPremioEscaneado codigo={escaneado} miSala={salaQueEntrega} puedeAdministrar={puedeAdministrar}
                    onCerrar={cerrarEscaneado} onEntregado={() => setVersion((v) => v + 1)} />
            )}
        </section>
    );
}

// ── Regalos promocionales ───────────────────────────────────────────────────
function Regalos({ puedeAdministrar, miSala, nombreSala, opcionesSala }) {
    const showToast = useToastStore((s) => s.showToast);
    const [panel, setPanel] = useState(null);
    const [version, setVersion] = useState(0);
    const [dialogo, setDialogo] = useState(null);   // { modo: 'nuevo'|'editar'|'entrada'|'enviar', promo }
    const [recibiendo, setRecibiendo] = useState(null);
    const recargar = () => setVersion((v) => v + 1);

    useEffect(() => {
        let vivo = true;
        fetchPromocionales()
            .then((p) => { if (vivo) setPanel(p); })
            .catch((e) => { if (vivo) { setPanel({ promocionales: [], envios: [] }); showToast('No se pudieron cargar los regalos', mensajeAmigable(e), 'error'); } });
        return () => { vivo = false; };
    }, [version, showToast]);

    // La sala ve lo que viene hacia ella; administración, todo lo que está en camino.
    const envios = (panel?.envios ?? []).filter((v) => puedeAdministrar || Number(v.hacia) === Number(miSala));

    const recibir = async (v) => {
        setRecibiendo(v.id);
        try {
            await recibirPromocional(v.id);
            showToast('Envío recibido', `${v.cantidad} × ${v.nombre}`, 'success');
            recargar();
        } catch (e) {
            showToast('No se pudo recibir', mensajeAmigable(e), 'error');
        } finally {
            setRecibiendo(null);
        }
    };

    if (!panel) return null;
    const promos = panel.promocionales ?? [];
    if (!puedeAdministrar && !envios.length) return null;

    return (
        <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-body font-black text-content flex items-center gap-2"><PackagePlus size={16} /> Regalos promocionales</h3>
                {puedeAdministrar && (
                    <Button variant="ghost" size="sm" icon={Plus} onClick={() => setDialogo({ modo: 'nuevo', promo: null })}>Nuevo regalo</Button>
                )}
            </div>

            {puedeAdministrar && (panel.pedidos ?? []).length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5"><Gift size={13} /> Pedidos por clientes</p>
                    {(panel.pedidos ?? []).map((x) => (
                        <div key={`${x.promocional_id}-${x.hacia}`} data-surface="card" className="rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-body-sm text-content">
                                <b>{x.cantidad} × {x.nombre}</b> para {nombreSala(x.hacia)} · {x.premios === 1 ? '1 cliente esperando' : `${x.premios} clientes esperando`}
                            </span>
                            <Button variant="secondary" size="sm" icon={Send}
                                onClick={() => setDialogo({ modo: 'enviar', promo: promos.find((p) => Number(p.id) === Number(x.promocional_id)), hacia: x.hacia, cantidad: x.cantidad })}>
                                Enviar
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            {envios.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption font-black uppercase tracking-widest text-content-3 flex items-center gap-1.5"><Truck size={13} /> En camino</p>
                    {envios.map((v) => (
                        <div key={v.id} data-surface="card" className="rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-body-sm text-content">
                                <b>{v.cantidad} × {v.nombre}</b> · de {nombreSala(v.desde)} a {nombreSala(v.hacia)} · {fechaCorta(v.enviado_at)}
                            </span>
                            {(puedeAdministrar || Number(v.hacia) === Number(miSala)) && (
                                <Button variant="secondary" size="sm" icon={PackageCheck} loading={recibiendo === v.id}
                                    onClick={() => recibir(v)}>Recibido</Button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {puedeAdministrar && (promos.length === 0 ? (
                <p className="text-body-sm text-content-3">Todavía no hay regalos. Crea uno para poder ponerlo en el raspable.</p>
            ) : (
                <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                    {promos.map((x) => {
                        const exist = Object.entries(x.existencias ?? {});
                        return (
                            <li key={x.id} data-surface="card" className="rounded-xl p-3 flex flex-col gap-1.5 min-w-0">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-body-sm font-bold text-content truncate">{x.nombre}</p>
                                        <p className="text-caption text-content-3">
                                            {x.costo != null ? `Cuesta ${formatMoney(Number(x.costo))}` : 'Sin costo anotado'}
                                            {Number(x.en_camino) > 0 ? ` · ${x.en_camino} en camino` : ''}
                                        </p>
                                    </div>
                                    {!x.activo && <Badge variant="neutral" tone="soft" uppercase={false}>Apagado</Badge>}
                                </div>
                                <p className="text-caption text-content-2">
                                    {exist.length ? exist.map(([b, n]) => `${nombreSala(b)} ${n}`).join(' · ') : 'Sin existencias'}
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                    <Button variant="ghost" size="sm" icon={PackagePlus} onClick={() => setDialogo({ modo: 'entrada', promo: x })}>Entrada o ajuste</Button>
                                    <Button variant="ghost" size="sm" icon={Send} onClick={() => setDialogo({ modo: 'enviar', promo: x })}>Enviar</Button>
                                    <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setDialogo({ modo: 'editar', promo: x })}>Editar</Button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            ))}

            {dialogo && (
                <DialogoRegalo {...dialogo} opcionesSala={opcionesSala}
                    onClose={() => setDialogo(null)} onHecho={() => { setDialogo(null); recargar(); }} />
            )}
        </section>
    );
}

const TITULOS = TITULO_DIALOGO_REGALO;

function DialogoRegalo({ modo, promo, opcionesSala, onClose, onHecho, hacia = '', cantidad = '' }) {
    const showToast = useToastStore((s) => s.showToast);
    const bodega = opcionesSala.find((o) => /bodega/i.test(o.label))?.value ?? '';
    // El borrador sobrevive al cierre de sesión por inactividad (gate:borradores).
    const llave = `puntos_regalo_${modo}_${promo?.id ?? 'nuevo'}`;
    const [f, setF] = useState(() => loadDraft(llave) ?? ({
        nombre: promo?.nombre ?? '', descripcion: promo?.descripcion ?? '',
        costo: promo?.costo != null ? String(promo.costo) : '', activo: promo?.activo ?? true,
        sala: bodega, hacia: hacia ?? '', cantidad: cantidad ? String(cantidad) : '', nota: '',
    }));
    const [guardando, setGuardando] = useState(false);
    const poner = (k, v) => setF((x) => { const n = { ...x, [k]: v }; saveDraft(llave, n); return n; });
    const cerrar = () => { clearDraft(llave); onClose(); };
    const n = Number(f.cantidad);

    const falta = faltaEnRegalo(modo, f);

    const guardar = async () => {
        setGuardando(true);
        try {
            if (modo === 'nuevo' || modo === 'editar') {
                await guardarPromocional({ id: promo?.id ?? null, nombre: f.nombre.trim(), descripcion: f.descripcion.trim() || null,
                    costo: f.costo === '' ? null : Number(f.costo), activo: f.activo });
                showToast('Regalo guardado', f.nombre.trim(), 'success');
            } else if (modo === 'entrada') {
                const queda = await ajustarPromocional(promo.id, Number(f.sala), n, f.nota);
                showToast(n > 0 ? 'Entrada anotada' : 'Ajuste anotado', `Quedan ${queda}`, 'success');
            } else {
                await enviarPromocional(promo.id, Number(f.sala), Number(f.hacia), n);
                showToast('Envío anotado', 'La sucursal lo confirma al recibirlo.', 'success');
            }
            clearDraft(llave);
            onHecho();
        } catch (e) {
            showToast('No se pudo guardar', mensajeAmigable(e), 'error');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <LiquidModal open onClose={guardando ? undefined : cerrar} maxWidth="max-w-lg" ariaLabel={TITULOS[modo]}>
            <LiquidModal.Header>
                <h2 className="text-body-xl font-semibold text-content">{TITULOS[modo]}</h2>
                {promo && modo !== 'editar' && <p className="text-body-sm text-content-2">{promo.nombre}</p>}
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="flex flex-col gap-3">
                    {(modo === 'nuevo' || modo === 'editar') && (
                        <>
                            <PortalInput label="Nombre" value={f.nombre} maxLength={80} onChange={(e) => poner('nombre', e.target.value)} placeholder="Termo Salud" />
                            <PortalInput label="Descripción (opcional)" value={f.descripcion} onChange={(e) => poner('descripcion', e.target.value)} />
                            <PortalInput label="Costo de uno (opcional)" prefix="$" inputMode="decimal" value={f.costo}
                                onChange={(e) => poner('costo', e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" />
                            <p className="text-caption text-content-3">El costo sirve para saber cuánto cuesta el programa en regalos.</p>
                            {modo === 'editar' && (
                                <Switch checked={f.activo} onChange={(v) => poner('activo', v)} label="Activo (se puede poner en el raspable)" />
                            )}
                        </>
                    )}
                    {modo === 'entrada' && (
                        <>
                            <Campo rotulo="Sucursal">
                                <LiquidSelect options={opcionesSala} value={f.sala} onChange={(v) => poner('sala', v)} clearable={false} placeholder="¿Dónde?" />
                            </Campo>
                            <PortalInput label="Cantidad" type="number" value={f.cantidad} onChange={(e) => poner('cantidad', e.target.value)}
                                placeholder="10, o −2 para restar" />
                            <PortalInput label={n < 0 ? 'Por qué se resta' : 'Nota (opcional)'} value={f.nota} onChange={(e) => poner('nota', e.target.value)} />
                        </>
                    )}
                    {modo === 'enviar' && (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                <Campo rotulo="Desde">
                                    <LiquidSelect options={opcionesSala} value={f.sala} onChange={(v) => poner('sala', v)} clearable={false} placeholder="¿De dónde?" />
                                </Campo>
                                <Campo rotulo="Hacia">
                                    <LiquidSelect options={opcionesSala} value={f.hacia} onChange={(v) => poner('hacia', v)} clearable={false} placeholder="¿A dónde?" />
                                </Campo>
                            </div>
                            <PortalInput label="Cantidad" type="number" value={f.cantidad} onChange={(e) => poner('cantidad', e.target.value)} />
                            <p className="text-caption text-content-3">
                                {promo?.existencias?.[f.sala] != null ? `Hay ${promo.existencias[f.sala]} en el origen.` : 'En el origen no hay existencias anotadas.'}
                            </p>
                        </>
                    )}
                    {falta && <p className="text-caption text-content-3">{falta}</p>}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="ghost" onClick={cerrar} disabled={guardando}>Cancelar</Button>
                <Button variant="primary" loading={guardando} disabled={!!falta} onClick={guardar}>
                    {modo === 'enviar' ? 'Enviar' : 'Guardar'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
