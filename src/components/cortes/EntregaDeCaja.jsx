import React, { useCallback, useState } from 'react';
import { HandCoins, Info } from 'lucide-react';
import Button from '../common/Button';
import IdentidadDeQuienRetira from '../bolsas/IdentidadDeQuienRetira';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalTextarea from '../common/PortalTextarea';

/**
 * «¿Quién recibe la caja?» — el paso que convierte confirmar un corte en una
 * ENTREGA.
 *
 * ── Por qué vive acá y no dentro de confirmar ──────────────────────────────
 * Confirmar un corte CIERRA EL TURNO (regla del usuario, 1-sep): «al hacer un
 * corte y confirmarlo deben abrir caja de nuevo la persona responsable». O sea
 * que ese clic es, en la práctica, el momento en que la caja cambia de manos —
 * y hasta el 3-sep lo podía firmar la misma persona que contó el efectivo.
 *
 * Medido sobre los 10 días anteriores: confirmaron **35 personas distintas** y
 * son las mismas de sala, así que la firma propia no era una excepción rara.
 *
 * ── No bloquea, y es a propósito ───────────────────────────────────────────
 * Decisión del usuario (3-sep): «avisar primero, medir, después bloquear». Se
 * puede confirmar sin que nadie reciba, diciendo por qué. Un candado que deja a
 * una sala sin poder cerrar el turno produce el atajo en vez del control — es
 * [[feedback_una_verificacion_que_traba_la_accion_no_se_hace]] y ya costó las
 * seis bolsas trabadas de agosto.
 *
 * Lo único que el servidor SÍ rechaza es que quien hizo el corte reciba su
 * propia caja: eso no traba a nadie —siempre queda la salida de confirmar sin
 * entrega— y evita que la segunda firma sea la misma persona, que es como un
 * control de dos firmas deja de serlo.
 *
 * ── El último corte del día no pregunta nada ───────────────────────────────
 * Lo decide el horario de la sucursal, no esta pantalla: quien abre el diálogo
 * ya preguntó `sala_ya_cerro`, que es la MISMA función con la que el servidor
 * marca el corte. Dos jueces para la misma pregunta es cómo se llega a dos
 * respuestas.
 *
 * ── Se MONTA cuando hace falta, y por eso no limpia nada a mano ────────────
 * Quien lo usa lo renderiza con `{pidiendo && <EntregaDeCaja …/>}`, así que al
 * cerrarse se desmonta y su estado muere con él. Importa: el vale de identidad
 * dura 5 minutos y es de un solo uso, y arrastrar el de la apertura anterior
 * sería firmar con una comprobación vencida y enterarse recién al guardar.
 */
export default function EntregaDeCaja({
    corte,
    sala = '',
    ocupado = false,
    onEntregar,
    onSinEntrega,
    onClose,
}) {
    const [persona, setPersona] = useState(null);
    const [vale, setVale] = useState(null);
    const [saltando, setSaltando] = useState(false);
    const [motivo, setMotivo] = useState('');

    const alIdentificar = useCallback(({ persona: p, vale: v }) => {
        setPersona(p); setVale(v);
    }, []);

    const olvidar = useCallback(() => { setPersona(null); setVale(null); }, []);

    const hora = String(corte?.hora || '').slice(0, 5);

    return (
        <LiquidModal open onClose={ocupado ? undefined : onClose} maxWidth="max-w-md"
            className="h-fit" ariaLabel="Quién recibe la caja">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">¿Quién recibe la caja?</h3>
                    <p className="text-caption text-content-3 truncate">
                        {[sala, hora && `corte de las ${hora}`].filter(Boolean).join(' · ')}
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-3">
                {/* Qué significa firmar acá, dicho antes de firmar. Sin esto la
                    pantalla pide un carné y no dice para qué queda registrado. */}
                <Notice variant="info" icon={Info}>
                    Al confirmar este corte termina el turno. Quien reciba la caja
                    se hace cargo del efectivo desde este momento.
                </Notice>

                {!saltando ? (
                    <>
                        <IdentidadDeQuienRetira
                            activo={!ocupado}
                            persona={persona}
                            onIdentificada={alIdentificar}
                            onOlvidar={olvidar}
                            rotulo="Recibe la caja"
                            sujeto="quien recibe la caja"
                            bloqueado={ocupado}
                        />
                        <Button variant="primary" size="md" icon={HandCoins} className="w-full"
                            loading={ocupado} disabled={!persona || !vale}
                            onClick={() => onEntregar?.({ persona, vale })}>
                            Confirmar y entregar la caja
                        </Button>
                        {/* La salida, en segundo plano y nombrando lo que pasa:
                            no es «cancelar», es confirmar sin que nadie reciba. */}
                        <Button variant="ghost" size="sm" className="w-full"
                            disabled={ocupado} onClick={() => setSaltando(true)}>
                            No hay quien reciba ahora
                        </Button>
                    </>
                ) : (
                    <>
                        <PortalTextarea
                            label="¿Por qué no hay quien reciba?"
                            name="motivo-sin-entrega"
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            placeholder="Ej.: quedó sola en la sala"
                            rows={3}
                        />
                        <Button variant="primary" size="md" className="w-full"
                            loading={ocupado} disabled={!motivo.trim()}
                            onClick={() => onSinEntrega?.(motivo.trim())}>
                            Confirmar sin entrega
                        </Button>
                        <Button variant="ghost" size="sm" className="w-full"
                            disabled={ocupado} onClick={() => setSaltando(false)}>
                            Volver al carné
                        </Button>
                    </>
                )}
            </LiquidModal.Body>
        </LiquidModal>
    );
}
