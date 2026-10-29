import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, Check, PackageSearch, Repeat, Truck, X } from 'lucide-react';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import Notice from '../../components/common/Notice';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import SegmentedControl from '../../components/common/SegmentedControl';
import BuscadorDeProducto from '../../components/common/BuscadorDeProducto';
import DeOtraSala from '../../components/caja/DeOtraSala';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { textoAlNoAceptarElPrecio, textoDeResolverDeLaApp } from '@nucleo/utils/reservasDeSala';
import {
    ajustarReserva, codigoDeReserva, decidirPrecioDeBodega, encargarRestoABodega, faltaDeReserva, pagadoDeReserva, preciosDeProducto, repartoDelAjuste,
} from '@nucleo/data/reservas';

/**
 * Una reserva que no llegó entera (2026-10-22, decisiones del usuario; desde el
 * 2026-10-26 también las de la app y las pagadas en línea, cláusula 3.6).
 *
 * La otra sala no la mandó, mandó menos, o Bodega no la consigue. Lo que se
 * puede hacer, en este orden:
 *   1. pedir lo que falta a OTRA sala que lo tenga (mismo armado que Inventario);
 *   2. si ninguna lo tiene, encargarlo a Bodega — ella da precio y fecha; si el
 *      precio es otro, decide el cliente;
 *   3. lo que el cliente decida: quedarse sólo con lo que llegó, llevar una
 *      alternativa de esta sala (puede ser mixto: 2 del original y 2 de otro),
 *      o nada (eso es cancelar: lo pagado queda a su favor).
 * Las cuentas del dinero las hace la base (`reserva_ajustar`); acá sólo se
 * muestran antes de confirmar.
 */
export default function ResolverReserva({ reserva: r, onClose, onListo }) {
    const showToast = useToastStore((s) => s.showToast);
    const falta = faltaDeReserva(r);
    const codigo = codigoDeReserva(r.id);
    const precioDistinto = r.traslado_estado === 'precio' && r.encargo?.estado === 'confirmado';
    const [vista, setVista] = useState(precioDistinto ? 'precio' : falta > 0 ? 'pedir' : 'cliente');
    const [ocupado, setOcupado] = useState(false);

    const hacer = async (fn, titulo, detalle) => {
        setOcupado(true);
        try {
            const res = await fn();
            showToast(titulo, typeof detalle === 'function' ? detalle(res) : detalle, 'success');
            onListo();
        } catch (err) {
            showToast('No se pudo', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setOcupado(false);
        }
    };

    // Una reserva de la app se ajusta igual (cláusula 3.6); sólo se avisa que
    // hay que llamar al cliente, que no está enfrente.
    const opciones = [
        ...(precioDistinto ? [{ value: 'precio', label: 'Precio de Bodega' }] : []),
        ...(falta > 0 && !precioDistinto ? [{ value: 'pedir', label: 'Pedir a otra sala' }, { value: 'bodega', label: 'A Bodega' }] : []),
        { value: 'cliente', label: 'Lo decide el cliente' },
    ];
    const textoDeLaApp = textoDeResolverDeLaApp(r);

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-lg" ariaLabel="Resolver reserva">
            <LiquidModal.Header titulo={`Resolver ${codigo}`}
                subtitulo={<>{r.cantidad} × {r.producto} · {shortEmployeeName(r.cliente ?? '')}</>}
                onClose={onClose} />
            <LiquidModal.Body>
                <div className="space-y-4">
                    {r.traslado_nota && <Notice variant="warning" compact icon={Truck}>{r.traslado_nota}</Notice>}
                    <p className="text-caption text-content-3">
                        Llegaron {r.traslado_llegaron ?? 0} · vienen en camino {r.traslado_por_llegar ?? 0} · faltan {falta}
                    </p>
                    {opciones.length > 1 && <SegmentedControl label="Qué hacer" value={vista} onChange={setVista} options={opciones} />}

                    {vista === 'precio' && (
                        <PrecioDeBodega reserva={r} ocupado={ocupado}
                            onDecidir={(acepta) => hacer(() => decidirPrecioDeBodega(r.id, acepta),
                                acepta ? 'Precio aceptado' : 'Precio no aceptado',
                                (res) => (acepta ? (res?.codigo_nueva ? `El resto quedó en ${res.codigo_nueva}, a su precio.` : 'Bodega sigue con el pedido.')
                                    : textoAlNoAceptarElPrecio()))} />
                    )}
                    {vista === 'pedir' && <PedirAOtraSala reserva={r} falta={falta} ocupado={ocupado} hacer={hacer} />}
                    {vista === 'bodega' && (
                        <div className="space-y-3">
                            <p className="text-body-sm text-content-2">
                                Bodega confirma el precio y para cuándo. Si es el mismo precio sigue sola; si es otro, decide el cliente.
                                Cuando llegue, la reserva queda lista sola.
                            </p>
                            {falta > 20 && <Notice variant="warning" compact>Bodega encarga hasta 20 por pedido y faltan {falta}.</Notice>}
                            <Button variant="primary" icon={PackageSearch} loading={ocupado} disabled={falta > 20}
                                onClick={() => hacer(() => encargarRestoABodega(r.id), 'Encargado a Bodega', (res) => `${res?.codigo ?? ''} · ${falta} × ${r.producto}`)}>
                                Encargar {falta} a Bodega
                            </Button>
                        </div>
                    )}
                    {vista === 'cliente' && <LoDecideElCliente reserva={r} ocupado={ocupado} hacer={hacer} />}
                    {textoDeLaApp && <p className="text-caption text-content-3">{textoDeLaApp}</p>}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onClose}>Cerrar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

function PrecioDeBodega({ reserva: r, ocupado, onDecidir }) {
    const e = r.encargo;
    return (
        <div className="space-y-3">
            <p className="text-body-sm text-content">
                Bodega consigue {e.cantidad} × {r.producto} a <b>{formatMoney(Number(e.precio))}</b> c/u; se reservó a {formatMoney(Number(r.precio))}.
                {e.fecha ? ` Llega aprox. el ${e.fecha.split('-').reverse().slice(0, 2).join('/')}.` : ''} Pregúntale al cliente.
            </p>
            <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={Check} loading={ocupado} onClick={() => onDecidir(true)}>Acepta {formatMoney(Number(e.precio))}</Button>
                <Button variant="secondary" icon={X} disabled={ocupado} onClick={() => onDecidir(false)}>No acepta</Button>
            </div>
        </div>
    );
}

function PedirAOtraSala({ reserva: r, falta, ocupado, hacer }) {
    const api = useRef(null);
    const [origen, setOrigen] = useState(null);
    const producto = useMemo(() => ({ id: r.producto_id, nombre: r.producto }), [r.producto_id, r.producto]);
    return (
        <div className="space-y-3">
            <DeOtraSala producto={producto} factor={Number(r.factor ?? 1)} cantidad={falta} apiRef={api} onCambio={setOrigen}
                rotulo={`Faltan ${falta}: ¿quién los tiene?`} opcionNo={null} />
            <Button variant="primary" icon={ArrowLeftRight} loading={ocupado} disabled={!origen?.lista}
                onClick={() => hacer(() => api.current.enviar(`Reserva ${codigoDeReserva(r.id)} para ${shortEmployeeName(r.cliente ?? '')}`, { reserva_id: r.id }),
                    'Traslado pedido', `${origen.sala} manda ${falta}. Cuando llegue, la reserva queda lista sola.`)}>
                {origen ? `Pedir ${falta} a ${origen.sala}` : 'Pedir'}
            </Button>
            <p className="text-caption text-content-3">Si ninguna sala lo tiene, encárgalo a Bodega.</p>
        </div>
    );
}

function LoDecideElCliente({ reserva: r, ocupado, hacer }) {
    const yaViene = Number(r.traslado_llegaron ?? 0) + Number(r.traslado_por_llegar ?? 0);
    const [queda, setQueda] = useState(String(Math.min(yaViene, Number(r.cantidad))));
    const [conAlternativa, setConAlternativa] = useState(false);
    const [alt, setAlt] = useState(null);
    const [precios, setPrecios] = useState(null);
    const [pres, setPres] = useState('');
    const [cantAlt, setCantAlt] = useState('1');
    const [motivo, setMotivo] = useState('');

    useEffect(() => {
        let vivo = true;
        if (!alt) return undefined;
        preciosDeProducto(alt.id).then((p) => {
            if (!vivo) return;
            setPrecios(p);
            if (p[0]) setPres(`${p[0].factor}|${p[0].precio}`);
        }).catch(() => { if (vivo) setPrecios([]); });
        return () => { vivo = false; };
    }, [alt]);

    const n = Number.parseInt(queda, 10);
    const nAlt = Number.parseInt(cantAlt, 10);
    const [factorAlt, precioAlt] = pres ? pres.split('|').map(Number) : [null, null];
    const usaAlt = conAlternativa && alt && pres && nAlt >= 1;
    const pagado = pagadoDeReserva(r);
    const reparto = repartoDelAjuste({ pagado, precio: Number(r.precio ?? 0), cantidad: Number.isFinite(n) ? n : 0,
        totalAlternativa: usaAlt ? precioAlt * nAlt : 0 });
    const falta = !Number.isFinite(n) || n < 0 || n > Number(r.cantidad) ? `Del original se queda de 0 a ${r.cantidad}.`
        : conAlternativa && !usaAlt ? 'Elige la alternativa, su presentación y cuántas.'
            : n === Number(r.cantidad) && !usaAlt ? 'Así no cambia nada.'
                : n === 0 && !usaAlt ? 'Si no lleva nada, cancela la reserva desde la lista: lo pagado queda a su favor.'
                    : motivo.trim().length < 3 ? 'Escribe qué decidió el cliente.' : null;

    const confirmar = () => hacer(() => ajustarReserva(r.id, {
        cantidad: n, motivo,
        alternativa: usaAlt ? { producto_id: alt.id, producto_nombre: alt.nombre, factor: factorAlt, cantidad: nAlt, precio: precioAlt } : null,
    }), 'Reserva ajustada', (res) => [
        res?.alternativa ? `La alternativa quedó apartada en ${res.alternativa}.` : '',
        Number(res?.a_favor) > 0 ? `${formatMoney(Number(res.a_favor))} quedan a su favor.` : '',
    ].filter(Boolean).join(' ') || 'Listo.');

    return (
        <div className="space-y-3">
            <PortalInput label={`Del original se queda (de ${r.cantidad})`} type="number" value={queda} onChange={(e) => setQueda(e.target.value)}
                helperText={yaViene ? `llegó o viene: ${yaViene}` : undefined} />
            <Button variant={conAlternativa ? 'secondary' : 'ghost'} size="sm" icon={Repeat} aria-pressed={conAlternativa}
                onClick={() => setConAlternativa((v) => !v)}>{conAlternativa ? 'Quitar la alternativa' : 'Agregar una alternativa de esta sala'}</Button>
            {conAlternativa && (alt ? (
                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                        <p className="text-body-sm font-semibold text-content min-w-0 break-words">{alt.nombre}</p>
                        <Button variant="ghost" size="sm" onClick={() => { setAlt(null); setPrecios(null); setPres(''); }}>Cambiar</Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5 min-w-0">
                            <span className="text-caption font-black uppercase tracking-widest text-content-3 ml-1">Presentación</span>
                            <LiquidSelect clearable={false} placeholder={precios == null ? 'Cargando…' : '¿Cuál?'} value={pres} onChange={setPres}
                                options={(precios ?? []).map((p) => ({ value: `${p.factor}|${p.precio}`, label: `${p.tipo} · ${formatMoney(p.precio)}` }))} />
                        </div>
                        <PortalInput label="Cantidad" type="number" value={cantAlt} onChange={(e) => setCantAlt(e.target.value)} />
                    </div>
                    <p className="text-caption text-content-3">Se aparta de lo que hay en esta sala, con el precio de hoy.</p>
                </div>
            ) : (
                <BuscadorDeProducto placeholder="La alternativa…" onElegir={(p) => setAlt({ id: Number(p.id), nombre: p.nombre })} />
            ))}
            <PortalTextarea label="Qué decidió el cliente" name="motivo" rows={2} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            {Number.isFinite(n) && pagado > 0 && (
                <Notice variant="info" compact>
                    De {formatMoney(pagado)} pagados: {formatMoney(reparto.queda)} quedan en esta reserva
                    {usaAlt ? `, ${formatMoney(reparto.alternativa)} pasan a la alternativa` : ''}
                    {reparto.aFavor > 0 ? ` y ${formatMoney(reparto.aFavor)} quedan a su favor` : ''}.
                </Notice>
            )}
            {falta && <p className="text-caption text-content-3">{falta}</p>}
            <Button variant="primary" icon={Check} loading={ocupado} disabled={!!falta} onClick={confirmar}>Confirmar lo que decidió</Button>
        </div>
    );
}
