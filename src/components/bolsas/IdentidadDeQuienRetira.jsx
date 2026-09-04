import React, { useCallback, useEffect, useState } from 'react';
import AvatarConEstado from '../common/AvatarConEstado';
import { AlertTriangle, KeyRound, ScanLine } from 'lucide-react';
import Button from '../common/Button';
import EsperaDeCarne from '../common/EsperaDeCarne';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import { identificarPorCarne, identificarPorUsuario } from '../../data/bolsas';
import { mensajeAmigable } from '../../utils/errorMessages';
import useCapturaDeCarne from '../../hooks/useCapturaDeCarne';
import { shortEmployeeName } from '../../utils/nameUtils';

/**
 * «Quién se lleva el efectivo»: el lector de carné, la escotilla de usuario y
 * contraseña, y la tarjeta de quien quedó reconocido.
 *
 * ── Por qué es un componente y no dos pantallas parecidas ──────────────────
 * Nació dentro de `EntregaDeBolsas` el 2026-08-17 y salió acá el 2026-08-19,
 * cuando el usuario pidió lo mismo para las salidas de una bolsa: «quien se
 * lleva el efectivo, debe salir como sale en entrega de efectivo, el lector o
 * usuario / contraseña (así debe salir en todos los que lo requiera)».
 *
 * Lo que reemplazó era un desplegable con la nómina entera más un campo de
 * contraseña — o sea, la pregunta contestada dos veces: elegir un nombre no
 * prueba nada, y el carné ya dice de quién es. Copiar el panel bueno en la
 * segunda pantalla habría dejado dos que se corrigen por separado, que es
 * exactamente lo que pasó con el reconocimiento del carné cuando estuvo mirando
 * el código en vez del PIN en dos funciones a la vez.
 *
 * ── El lector se enciende desde afuera, y hay un motivo ────────────────────
 * `useCapturaDeCarne` es un `keydown` global que NO cancela la tecla: los
 * caracteres de la ráfaga llegan igual a cualquier campo de texto que tenga el
 * foco. En la entrega no hay ninguno, pero el formulario de una salida tiene
 * monto, boleta y detalle — un escaneo ahí publicaría el carné, a la vista,
 * dentro de un `<textarea>`. Por eso `activo` lo decide quien usa el
 * componente: se enciende cuando la pantalla es SÓLO esto. Es el mismo defecto
 * que se corrigió en el login (v2.638.0).
 *
 * Y con el método de usuario la captura se apaga sola, porque ahí sí hay dos
 * campos de texto en esta misma tarjeta.
 *
 * ── Quién es y su vale salen del SERVIDOR ──────────────────────────────────
 * `onIdentificada` entrega los dos juntos: la persona que el servidor resolvió
 * y el vale de un solo uso que emitió en la misma llamada. El navegador no
 * elige a quién se le atribuye el dinero. El secreto viaja sólo en esa llamada
 * y se olvida apenas se manda, salga bien o mal.
 */

export default function IdentidadDeQuienRetira({
    activo = false,
    persona,
    onIdentificada,
    onOlvidar,
    ayuda,
    rotulo = 'Se lleva el efectivo',
    // De quién se está comprobando la identidad, en las dos frases que lo
    // nombran. Va como prop y no escrito adentro porque el componente ya sirve
    // a tres actos distintos —el efectivo que sale, la salida de una bolsa y,
    // desde el 3-sep, la entrega de la caja al cambiar de turno— y en la
    // entrega de la caja nadie se lleva nada: la recibe.
    sujeto = 'quien se lleva el efectivo',
    bloqueado = false,
}) {
    // 'CARNE' es el camino normal; 'CLAVE' es la escotilla.
    const [metodo, setMetodo] = useState('CARNE');
    const [usuario, setUsuario] = useState('');
    const [clave, setClave] = useState('');
    const [leyendo, setLeyendo] = useState(false);
    const [error, setError] = useState(null);

    /** Lo que devuelven las dos comprobaciones se trata igual. */
    const recibirIdentidad = useCallback((r, siFalla) => {
        setClave('');   // el secreto se olvida apenas se manda, salga bien o mal
        if (r.error) { setError(mensajeAmigable(r.error, siFalla)); return; }
        if (r.motivo) { setError(r.motivo); return; }
        onIdentificada?.({ persona: r.persona, vale: r.vale });
    }, [onIdentificada]);

    const alEscanear = useCallback(async (codigo) => {
        setLeyendo(true);
        setError(null);
        try {
            recibirIdentidad(await identificarPorCarne(codigo), 'No se pudo confirmar el carné.');
        } catch (e) {
            setError(mensajeAmigable(e, 'No se pudo confirmar el carné.'));
        } finally {
            setLeyendo(false);
        }
    }, [recibirIdentidad]);

    const alAutenticar = useCallback(async () => {
        if (!usuario.trim() || !clave || leyendo) return;
        setLeyendo(true);
        setError(null);
        try {
            recibirIdentidad(
                await identificarPorUsuario(usuario, clave),
                'No se pudo confirmar la identidad.',
            );
        } catch (e) {
            setClave('');
            setError(mensajeAmigable(e, 'No se pudo confirmar la identidad.'));
        } finally {
            setLeyendo(false);
        }
    }, [usuario, clave, leyendo, recibirIdentidad]);

    const { teclas, manual, limpiar } = useCapturaDeCarne(
        activo && !persona && metodo === 'CARNE', alEscanear,
    );

    // Mientras esto no esté encendido no debe quedar nada adentro: ni el secreto
    // tecleado, ni media ráfaga del lector, ni el aviso de un intento anterior.
    useEffect(() => {
        if (activo) return;
        setMetodo('CARNE');
        setUsuario('');
        setClave('');
        setError(null);
        limpiar();
    }, [activo, limpiar]);

    // El padre puede soltar a la persona (un vale gastado, un «no es»): el
    // detector tiene que arrancar limpio o el próximo escaneo empezaría con la
    // mitad del anterior pegada adelante.
    useEffect(() => {
        if (!persona) limpiar();
    }, [persona, limpiar]);

    const cambiarMetodo = useCallback((v) => {
        setMetodo(v);
        setError(null);
        setClave('');
        limpiar();
    }, [limpiar]);

    if (persona) {
        return (
            <div className="flex items-center gap-3 p-3.5 rounded-xl bg-success/10 border border-success/30
                animate-in fade-in slide-in-from-bottom-2 duration-[var(--dur-base)]">
                <AvatarConEstado emp={persona} px={48} radio="rounded-full"
                    marco="border-2 border-border-card" className="shadow" />
                <div className="min-w-0 flex-1">
                    <p className="font-bold text-success-text text-body-lg truncate">{shortEmployeeName(persona)}</p>
                    <p className="text-label text-success-text mt-0.5">{rotulo}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={onOlvidar} disabled={bloqueado}>
                    No es
                </Button>
            </div>
        );
    }

    return (
        <div data-surface="card" className="p-3 space-y-3">
            {metodo === 'CARNE' ? (
                <EsperaDeCarne
                    teclas={teclas} manual={manual} ocupado={leyendo}
                    ayuda={ayuda || <>Pasa por el lector el carné<br />de {sujeto}</>}
                />
            ) : (
                <>
                    <p className="text-body-sm text-content-2 text-center">
                        El usuario y la contraseña de {sujeto}
                    </p>
                    <PortalInput
                        label="Usuario" name="usuario-recibe"
                        value={usuario} onChange={(e) => setUsuario(e.target.value)}
                        placeholder="Su usuario del portal"
                        autoComplete="off"
                    />
                    <PortalInput
                        label="Contraseña" name="clave-recibe" type="password"
                        value={clave} onChange={(e) => setClave(e.target.value)}
                        placeholder="••••••••"
                        autoComplete="off"
                        onKeyDown={(e) => { if (e.key === 'Enter') alAutenticar(); }}
                    />
                    <Button variant="primary" size="sm" icon={KeyRound} className="w-full"
                        loading={leyendo}
                        disabled={!usuario.trim() || !clave}
                        onClick={alAutenticar}>
                        Comprobar
                    </Button>
                </>
            )}

            {/* El lector es el camino normal, así que la escotilla es secundaria
                y dice a dónde lleva. */}
            <Button variant="ghost" size="sm" className="w-full"
                icon={metodo === 'CARNE' ? KeyRound : ScanLine}
                onClick={() => cambiarMetodo(metodo === 'CARNE' ? 'CLAVE' : 'CARNE')}>
                {metodo === 'CARNE' ? 'Autenticar por usuario' : 'Volver al lector de carné'}
            </Button>

            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
        </div>
    );
}
