/**
 * Mis puntos — la pantalla del CLIENTE, sin sesión.
 *
 * ── Quién llega acá ─────────────────────────────────────────────────────────
 * Alguien parado en la sala o en su casa, con el teléfono en la mano, que quiere
 * saber una cosa: cuánto tiene. No es personal del portal: no conoce el menú, no
 * sabe qué es una sala ni un correlativo, y no va a volver a intentar si algo se
 * ve raro. Por eso esto es una pantalla sola, sin menú, con un solo camino.
 *
 * ── Se habla en dólares, no en puntos ───────────────────────────────────────
 * «Tenés 420 puntos» no le dice nada a nadie. «$4.20 de descuento» sí. El número
 * de puntos se muestra abajo, como el detalle de dónde sale la cifra que
 * importa.
 *
 * ── Por qué pide dos datos ──────────────────────────────────────────────────
 * Con sólo el teléfono, cualquiera que vea un ticket vería el nombre y el saldo
 * de esa persona. Los dos juntos convierten «probar números» en «adivinar un
 * par». La pantalla lo DICE —«los dos datos que están en tu ficha»— para que no
 * se lea como un trámite de más.
 */
import React, { useState } from 'react';
import { Star, Loader2, AlertTriangle, ArrowLeft, CalendarClock } from 'lucide-react';
import Button from '../components/common/Button';
import PortalInput from '../components/common/PortalInput';
import Notice from '../components/common/Notice';
import Badge from '../components/common/Badge';
import { consultarMisPuntos } from '../data/misPuntos';
import { EMPRESA } from '../constants/empresa';

const fmtFecha = (d) => {
    if (!d) return '';
    const [a, m, dd] = String(d).slice(0, 10).split('-');
    return a && m && dd ? `${dd}/${m}/${a}` : '';
};

export default function MisPuntosView() {
    const [dui, setDui] = useState('');
    const [tel, setTel] = useState('');
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState('');
    const [datos, setDatos] = useState(null);

    // Nueve dígitos el documento, ocho el teléfono. Se valida acá para no gastar
    // un intento del freno con algo que ni siquiera tiene forma de dato.
    const duiOk = dui.replace(/\D/g, '').length === 9;
    const telOk = tel.replace(/\D/g, '').length >= 8;
    const puedeConsultar = duiOk && telOk && !cargando;

    const consultar = async (e) => {
        e.preventDefault();
        if (!puedeConsultar) return;
        setCargando(true);
        setError('');
        const r = await consultarMisPuntos({ dui, telefono: tel });
        setCargando(false);
        if (r.ok) { setDatos(r); return; }
        setError(r.mensaje);
    };

    const volver = () => { setDatos(null); setError(''); setDui(''); setTel(''); };

    return (
        <div className="min-h-[100dvh] flex flex-col items-center px-5 py-10 sm:py-16">
            {/* `data-contenido` lo estampa `GlassViewLayout`, y esta vista no lo
                usa a propósito: no tiene menú. Sin la marca, el barrido del
                teléfono no sabe dónde termina el chasis y la cuenta como vacía
                —midió cero y el cero era del instrumento—. Se declara acá. */}
            <div className="w-full max-w-md" data-contenido>

                <div className="flex items-center gap-3 mb-8">
                    <div className="w-11 h-11 rounded-btn bg-brand/10 flex items-center justify-center shrink-0">
                        <Star size={22} className="text-brand-text" strokeWidth={2.5} />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-h3 font-black text-content-1 leading-tight">Mis puntos</h1>
                        {/* La RAZÓN SOCIAL, no el nombre del portal: «Farmalasa»
                            es el software y el cliente no tiene por qué saber que
                            existe. Sale de `EMPRESA` para que el día que cambie,
                            cambie en un solo lugar. */}
                        <p className="text-caption text-content-3 truncate">{EMPRESA.razonSocial}</p>
                    </div>
                </div>

                {!datos ? (
                    <form onSubmit={consultar} className="space-y-4" noValidate>
                        <p className="text-body-sm text-content-2">
                            Consulta cuántos puntos tienes con los dos datos que están en tu ficha.
                        </p>

                        <PortalInput
                            name="dui" label="DUI" maskType="DUI" inputMode="numeric"
                            placeholder="00000000-0" value={dui} autoComplete="off"
                            onChange={e => setDui(e.target.value)}
                        />
                        <PortalInput
                            name="telefono" label="Teléfono" inputMode="tel"
                            placeholder="0000-0000" value={tel} autoComplete="tel"
                            onChange={e => setTel(e.target.value)}
                        />

                        {error && (
                            <Notice variant="warning" icon={AlertTriangle}>{error}</Notice>
                        )}

                        <Button type="submit" variant="primary" className="w-full"
                            disabled={!puedeConsultar}>
                            {cargando
                                ? <><Loader2 size={16} className="animate-spin" /> Consultando…</>
                                : 'Ver mis puntos'}
                        </Button>

                        <p className="text-caption text-content-3 text-center">
                            Si no encuentras tu ficha, pregunta en cualquiera de nuestras salas.
                        </p>
                    </form>
                ) : (
                    <div className="space-y-5">
                        <div data-surface="card" className="p-6 text-center">
                            <p className="text-caption uppercase tracking-widest text-content-3 font-black">
                                Tienes disponible
                            </p>
                            {/* El dinero es lo grande; los puntos, el detalle que
                                explica de dónde sale. Al revés nadie lo entiende. */}
                            <p className="text-display font-black text-brand-text tabular-nums my-1">
                                ${datos.equivale.toFixed(2)}
                            </p>
                            <p className="text-body-sm text-content-2">
                                {datos.saldo.toLocaleString()} puntos
                            </p>
                            <p className="text-caption text-content-3 mt-3">
                                Válido como descuento en cualquiera de nuestras salas.
                            </p>
                        </div>

                        <p className="text-body-sm text-content-2">
                            Hola, <strong className="text-content-1">{datos.nombre}</strong>.
                        </p>

                        {/* Cuándo vencen. Va JUNTO al saldo y no al final: es la
                            mitad de la información que el saldo no da, y quien
                            entra a ver cuánto tiene necesita saber hasta cuándo
                            lo tiene. Si el servidor no pudo cuadrar los grupos
                            manda la lista vacía y acá no se pinta nada — una
                            fecha equivocada organiza una compra que no era. */}
                        {datos.vencimientos?.length > 0 && (
                            <div>
                                <p className="text-caption uppercase tracking-widest text-content-3 font-black mb-2">
                                    Cuándo vencen
                                </p>
                                <div className="space-y-1.5">
                                    {datos.vencimientos.map((v) => (
                                        <div key={v.vence} data-surface="card"
                                            className="flex items-center gap-3 px-3 py-2.5">
                                            <CalendarClock size={15} className="text-content-3 shrink-0" />
                                            <span className="text-body-sm text-content-2 flex-1 min-w-0">
                                                {fmtFecha(v.vence)}
                                            </span>
                                            <span className="text-body-sm font-bold tabular-nums text-content-1 shrink-0">
                                                {v.puntos.toLocaleString()} pts
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-caption text-content-3 mt-2">
                                    Los puntos duran 12 meses desde la compra que los dio.
                                    Cada grupo vence por separado.
                                </p>
                            </div>
                        )}

                        {datos.aviso && (
                            <Notice variant="info" icon={Star}>{datos.aviso}</Notice>
                        )}

                        {datos.movimientos?.length > 0 && (
                            <div>
                                <p className="text-caption uppercase tracking-widest text-content-3 font-black mb-2">
                                    Tus últimos movimientos
                                </p>
                                <div className="space-y-1.5">
                                    {datos.movimientos.map((m, i) => (
                                        <div key={i} data-surface="card"
                                            className="flex items-center gap-3 px-3 py-2.5">
                                            <span className="text-caption tabular-nums text-content-3 w-[74px] shrink-0">
                                                {fmtFecha(m.fecha)}
                                            </span>
                                            <Badge size="sm" variant={m.tipo === 'canje' ? 'warning' : 'success'}>
                                                {m.tipo === 'canje' ? 'Canje' : 'Compra'}
                                            </Badge>
                                            <span className="text-caption text-content-3 flex-1 min-w-0 truncate">
                                                {m.sala || ''}
                                            </span>
                                            <span className={`text-body-sm font-bold tabular-nums shrink-0 ${
                                                m.puntos < 0 ? 'text-warning-text' : 'text-success-text'}`}>
                                                {m.puntos > 0 ? '+' : ''}{m.puntos.toLocaleString()}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <Button variant="ghost" onClick={volver} className="w-full">
                            <ArrowLeft size={16} /> Consultar otra ficha
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
