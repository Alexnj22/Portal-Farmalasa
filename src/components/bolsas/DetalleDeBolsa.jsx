import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Image, Printer, ScrollText } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PromptModal from '../common/PromptModal';
import { EmptyState, SkeletonText } from '../common/StateViews';
import {
    anularBolsa, anularSalida, fetchEventosDeBolsa, fetchSalidasDeBolsa,
} from '../../data/bolsas';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { openStoredFile } from '../../utils/storageFiles';
import useCerrarBolsa from '../../hooks/useCerrarBolsa';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';

/**
 * Todo lo que le pasó a una bolsa, y las dos correcciones que existen.
 *
 * Nació de la auditoría previa a probar en sala (2026-08-15), que encontró tres
 * cosas escritas y sin camino en la pantalla:
 *
 * 1. **La foto del comprobante se subía y no se podía ver.** O sea que
 *    administración recibía una bolsa con un vale de $500 respaldado por una
 *    boleta que nadie podía abrir desde el portal: la mitad del control escrita
 *    y la otra mitad invisible.
 * 2. **Anular una bolsa no tenía botón.** Desde que la bolsa nace sola al
 *    confirmar el corte, anularla es la ÚNICA corrección posible — sin eso, una
 *    bolsa creada por un corte que no correspondía se quedaba para siempre.
 * 3. **La bitácora tampoco.** Las columnas de la bolsa guardan la última
 *    decisión; quién hizo qué y cuándo sólo vive en `bolsas_eventos`.
 *
 * Las dos anulaciones exigen motivo y sólo valen mientras la bolsa siga en la
 * sala: una vez entregada el dinero lo tiene otro, y la corrección es del
 * conteo, no de acá. Eso lo rechaza el servidor; la pantalla no ofrece el botón.
 */

const selloDeTiempo = (iso) => (iso ? new Date(iso).toLocaleString('es-SV', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: true, timeZone: 'America/El_Salvador',
}) : '');

/** dd/mm/aaaa: la fecha del corte llega como `2026-08-15` y así se leía en
 *  pantalla. Se arma a mano y no con `Date` para que el huso no la corra un día. */
const fechaCorta = (f) => {
    if (!f) return '';
    const [a, m, d] = String(f).split('-');
    return `${d}/${m}/${a}`;
};

const COMO = { CARNE: 'carné escaneado', CLAVE: 'usuario y contraseña' };

const ACCION = {
    CREAR: 'Se guardó', SALIDA: 'Salió dinero', REINTEGRO: 'Volvió dinero',
    ABRIR: 'Se abrió', ANULAR_SALIDA: 'Se anuló una salida',
    ENTREGAR: 'Se entregó', RECIBIR: 'Se recibió', CONTAR: 'Se contó',
    RESOLVER: 'Se resolvió la diferencia', ANULAR: 'Se anuló la bolsa',
};

export default function DetalleDeBolsa({ bolsa, sala, onClose, onCambio }) {
    const { hasPermission } = useAuth();
    const puedeEditar = hasPermission('bolsas', 'can_edit');
    const showToast = useToastStore((s) => s.showToast);

    const [salidas, setSalidas] = useState([]);
    const [eventos, setEventos] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [ocupado, setOcupado] = useState(null);
    // Qué se está anulando: la bolsa entera, o una salida concreta.
    const [anulando, setAnulando] = useState(null);

    const cargar = useCallback(async () => {
        if (!bolsa) return;
        setCargando(true);
        const [s, e] = await Promise.all([
            fetchSalidasDeBolsa(bolsa.id),
            fetchEventosDeBolsa(bolsa.id),
        ]);
        setSalidas(s); setEventos(e); setCargando(false);
    }, [bolsa]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga al abrir

    // El hook quiere el mapa sucursal→nombre y acá se conoce una sola: la de
    // esta bolsa. Se arma con ella en vez de pedir el mapa entero.
    const nombreSala = useMemo(
        () => (bolsa ? { [bolsa.branch_id]: sala || '' } : {}),
        [bolsa, sala],
    );
    const { imprimirVale } = useCerrarBolsa({ nombreSala, origen: 'detalle' });

    /**
     * El vale que quedó (o tenía que quedar) dentro de la bolsa.
     *
     * Existe porque el papel se imprime desde el navegador después de escribir
     * la salida, y ahí hay mil formas de que no salga: la computadora sin
     * ticketera, la caja apagada, la pestaña que se recarga en el medio —el
     * 17-ago-2026 la bolsa S5-1003 se quedó sin su vale por esto último—. Sin
     * un botón, un papel perdido no se recupera: la bolsa viaja con dinero de
     * menos y nada adentro que lo explique.
     *
     * El saldo que sale impreso es el de DESPUÉS de ese vale, no el de hoy: es
     * lo que decía el papel original y lo que hace que dos vales de la misma
     * bolsa se puedan leer en orden.
     */
    const reimprimirVale = useCallback(async (mov) => {
        setOcupado(`vale-${mov.movimiento_id}`);
        const hasta = salidas.filter((s) => !s.anulado_at
            && String(s.registrado_at) <= String(mov.registrado_at));
        const saldo = Number(bolsa.monto_inicial || 0)
            + hasta.reduce((a, s) => a + Number(s.monto || 0), 0);
        await imprimirVale(mov, bolsa, saldo);
        setOcupado(null);
        cargar();
    }, [salidas, bolsa, imprimirVale, cargar]);

    const confirmarAnulacion = useCallback(async (motivo) => {
        if (!anulando || !motivo?.trim()) return;
        setOcupado('anular');
        const { error } = anulando.tipo === 'bolsa'
            ? await anularBolsa(bolsa.id, motivo)
            : await anularSalida(anulando.operacionId, motivo);
        setOcupado(null);
        if (error) {
            showToast?.('No se pudo anular', mensajeAmigable(error, 'Vuelve a intentar en un momento.'), 'error');
            return;
        }
        showToast?.(anulando.tipo === 'bolsa' ? 'Bolsa anulada' : 'Salida anulada', '', 'success');
        setAnulando(null);
        onCambio?.();
        if (anulando.tipo === 'bolsa') onClose?.(); else cargar();
    }, [anulando, bolsa, showToast, onCambio, onClose, cargar]);

    if (!bolsa) return null;

    const enLaSala = bolsa.estado === 'ABIERTA';
    const vivas = salidas.filter((s) => !s.anulado_at);
    const saldo = Number(bolsa.monto_inicial || 0) + vivas.reduce((a, s) => a + Number(s.monto || 0), 0);

    return (
        <>
            <LiquidModal open={!!bolsa} onClose={onClose} maxWidth="max-w-2xl"
                ariaLabel={`Detalle de la bolsa ${bolsa.folio}`}>
                <LiquidModal.Header>
                    <div className="min-w-0">
                        <h3 className="text-body font-bold text-content">{bolsa.folio}</h3>
                        <p className="text-caption text-content-3 truncate">
                            {sala} · corte del {fechaCorta(bolsa.fecha)} {String(bolsa.hora).slice(0, 5)}
                        </p>
                    </div>
                </LiquidModal.Header>

                <LiquidModal.Body className="space-y-4">
                    <div data-surface="card" className="p-3 space-y-1">
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="text-caption text-content-3">Se guardó</span>
                            <span className="text-label tabular-nums text-content-2">
                                {formatMoney(bolsa.monto_inicial)}
                            </span>
                        </div>
                        {vivas.length > 0 && (
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-caption text-content-3">
                                    Salió en {vivas.length} {vivas.length === 1 ? 'vale' : 'vales'}
                                </span>
                                <span className="text-label tabular-nums text-content-2">
                                    −{formatMoney(Math.abs(saldo - Number(bolsa.monto_inicial || 0)))}
                                </span>
                            </div>
                        )}
                        <div className="flex items-baseline justify-between gap-2 pt-1 border-t border-divider">
                            <span className="text-label font-bold text-content">Efectivo que debe haber</span>
                            <span className="text-body font-bold tabular-nums text-content">
                                {formatMoney(saldo)}
                            </span>
                        </div>
                    </div>

                    {cargando && <SkeletonText lines={3} />}

                    {/* ── Lo que salió ────────────────────────────────────── */}
                    {!cargando && (
                        <section className="space-y-2">
                            <h4 className="text-caption font-black uppercase tracking-widest text-content-3">
                                Lo que salió de esta bolsa
                            </h4>
                            {!salidas.length && (
                                <EmptyState linea icon={ScrollText} title="No salió nada de acá" />
                            )}
                            {salidas.map((s) => (
                                <div key={s.movimiento_id} data-surface="card"
                                    className={`p-3 space-y-1.5 ${s.anulado_at ? 'opacity-55' : ''}`}>
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="text-label font-bold text-content truncate">
                                                {s.etiqueta}
                                            </div>
                                            <div className="text-caption text-content-3 truncate">
                                                {s.vale_folio} · {selloDeTiempo(s.registrado_at)}
                                            </div>
                                        </div>
                                        <span className={`text-label font-bold tabular-nums shrink-0
                                            ${s.anulado_at ? 'line-through text-content-3' : 'text-content'}`}>
                                            {formatMoney(s.monto)}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-x-2 gap-y-1.5 flex-wrap">
                                        {s.anulado_at && <Badge variant="neutral" size="sm" icon={Ban}>Anulada</Badge>}
                                        {/* El vale es el papel que respalda el faltante DENTRO de
                                            la bolsa. Que no haya salido no se veía en ninguna
                                            pantalla: la bolsa viajaba con dinero de menos y nada
                                            adentro que lo explicara. */}
                                        {!s.anulado_at && !s.impreso_at && (
                                            <Badge variant="warning" size="sm" icon={Printer}>Vale sin imprimir</Badge>
                                        )}
                                        {s.entidad && <Badge variant="neutral" size="sm">{s.entidad}</Badge>}
                                        {s.numero_boleta && (
                                            <Badge variant="neutral" size="sm">Boleta {s.numero_boleta}</Badge>
                                        )}
                                        {s.recibido_nombre && (
                                            <span className="text-caption text-content-3 truncate">
                                                Lo recibió {s.recibido_nombre}
                                                {s.recibido_metodo ? ` (${COMO[s.recibido_metodo] || 'identificado'})` : ''}
                                            </span>
                                        )}
                                    </div>

                                    {s.nota && (
                                        <p className="text-caption text-content-3">{s.nota}</p>
                                    )}

                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        {/* La foto del comprobante: el bucket es privado, así que
                                            se abre firmada — la URL guardada es un identificador,
                                            no algo que se pueda pintar tal cual. */}
                                        {s.foto_url && (
                                            <Button variant="secondary" size="sm" icon={Image}
                                                onClick={() => openStoredFile(s.foto_url)}>
                                                Ver el comprobante
                                            </Button>
                                        )}
                                        {/* Se puede volver a sacar aunque la bolsa ya no esté en
                                            la sala: el papel que falta se le entrega a quien la
                                            tenga. Anular, en cambio, sí exige que esté acá. */}
                                        {!s.anulado_at && (
                                            <Button variant="secondary" size="sm" icon={Printer}
                                                loading={ocupado === `vale-${s.movimiento_id}`}
                                                onClick={() => reimprimirVale(s)}>
                                                {s.impreso_at ? 'Reimprimir el vale' : 'Imprimir el vale'}
                                            </Button>
                                        )}
                                        {puedeEditar && enLaSala && !s.anulado_at && (
                                            <Button variant="ghost" size="sm" icon={Ban}
                                                onClick={() => setAnulando({
                                                    tipo: 'salida', operacionId: s.operacion_id, folio: s.vale_folio,
                                                })}>
                                                Anular
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </section>
                    )}

                    {/* ── La bitácora ─────────────────────────────────────── */}
                    {!cargando && eventos.length > 0 && (
                        <section className="space-y-1.5">
                            <h4 className="text-caption font-black uppercase tracking-widest text-content-3">
                                Qué le pasó
                            </h4>
                            {eventos.map((ev) => (
                                <div key={ev.id} className="flex items-baseline justify-between gap-2 px-1">
                                    <span className="text-caption text-content-2 min-w-0 truncate">
                                        {ACCION[ev.accion] || ev.accion}
                                        {ev.nombre ? ` · ${ev.nombre}` : ''}
                                        {ev.motivo ? ` · ${ev.motivo}` : ''}
                                        {ev.nota && !ev.motivo ? ` · ${ev.nota}` : ''}
                                    </span>
                                    <span className="text-caption text-content-3 tabular-nums shrink-0">
                                        {selloDeTiempo(ev.created_at)}
                                    </span>
                                </div>
                            ))}
                        </section>
                    )}

                    {!enLaSala && (
                        <Notice variant="info" icon={Ban}>
                            Esta bolsa ya salió de la sala: acá no se corrige nada.
                            {' '}Si el dinero no cuadra, se resuelve en el conteo.
                        </Notice>
                    )}
                </LiquidModal.Body>

                <LiquidModal.Footer>
                    <div className="flex items-center justify-between gap-2 w-full flex-wrap">
                        {/* Anular la bolsa es la ÚNICA corrección desde que nace
                            sola al confirmar el corte. Exige motivo y queda en la
                            bitácora — no se borra: su etiqueta ya salió impresa. */}
                        {puedeEditar && enLaSala && (
                            <Button variant="ghost" size="sm" icon={Ban}
                                onClick={() => setAnulando({ tipo: 'bolsa', folio: bolsa.folio })}>
                                Anular la bolsa
                            </Button>
                        )}
                        <Button variant="secondary" className="ml-auto" onClick={onClose}>Cerrar</Button>
                    </div>
                </LiquidModal.Footer>
            </LiquidModal>

            <PromptModal
                isOpen={!!anulando}
                onClose={() => setAnulando(null)}
                onConfirm={confirmarAnulacion}
                isProcessing={ocupado === 'anular'}
                required
                title={anulando?.tipo === 'bolsa'
                    ? `Anular la bolsa ${anulando?.folio}`
                    : `Anular el vale ${anulando?.folio}`}
                message={anulando?.tipo === 'bolsa'
                    ? 'La bolsa deja de contar y su etiqueta ya no vale. Queda en la bitácora quién la anuló y por qué.'
                    : 'El dinero vuelve al saldo de la bolsa. Hay que sacar el vale de adentro.'}
                placeholder="Por qué se anula…"
                confirmText="Anular"
            />
        </>
    );
}
