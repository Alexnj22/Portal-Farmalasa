import React, { useCallback, useMemo, useState } from 'react';
import { Megaphone, Save } from 'lucide-react';
import Switch from '../common/Switch';
import Button from '../common/Button';
import Badge from '../common/Badge';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import LiquidSelect from '../common/LiquidSelect';
import { FranjaBanner } from '../common/BannerPortal';
import { useBannerPortal } from '../../hooks/useBannerPortal';
import { setBannerPortal, VARIANTES_BANNER } from '../../data/bannerPortal';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { mensajeAmigable } from '../../utils/errorMessages';
import { rotuloCampo } from '../../utils/rotuloDeCampo';

/**
 * Sistema › Mantenimiento — la franja de aviso que se ve en el tope de todas
 * las pantallas del portal.
 *
 * Va en esta pantalla y no en Anuncios porque es lo mismo que los otros
 * interruptores de acá: algo que se enciende para TODO el mundo a la vez
 * mientras dure una situación, y se apaga cuando termina. Anuncios son mensajes
 * con destinatario y con fecha; esto es una sola franja.
 *
 * El switch enciende y apaga; el texto y la apariencia se guardan aparte con su
 * botón. Están separados a propósito: apagar la franja en una emergencia no
 * puede quedar esperando a que alguien termine de redactar, y el texto que
 * estaba queda intacto para la próxima vez.
 */

const hora = (iso) => {
    try {
        return new Date(iso).toLocaleString('es-SV', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
        });
    } catch { return ''; }
};

export default function AvisoDelPortal() {
    const { banner, recargar } = useBannerPortal();

    const [guardando, setGuardando] = useState(false);

    // `borrador === null` significa «acá nadie escribió nada»: lo que se ve es
    // lo que hay en la base, y sigue a la base si otra persona la cambia
    // mientras esta pantalla está abierta. En cuanto alguien escribe, el
    // borrador manda — así un cambio ajeno no le pisa el texto a quien lo está
    // redactando. Es una derivación, no una copia sincronizada con un efecto:
    // copiar en un efecto es exactamente lo que produce las dos versiones que
    // se desincronizan.
    const [borrador, setBorrador] = useState(null);

    const base = useMemo(() => ({
        texto:      banner?.texto ?? '',
        textoCorto: banner?.texto_corto ?? '',
        variante:   banner?.variante ?? 'obra',
    }), [banner]);

    const { texto, textoCorto, variante } = borrador ?? base;
    const editar = useCallback((campo, valor) => {
        setBorrador(d => ({ ...(d ?? base), [campo]: valor }));
    }, [base]);

    const sucio = !!borrador && (
        borrador.texto      !== base.texto ||
        borrador.textoCorto !== base.textoCorto ||
        borrador.variante   !== base.variante
    );

    const activo = !!banner?.activo;
    const sinTexto = !texto.trim();

    const alternar = useCallback(async (encender) => {
        // Encender manda TAMBIÉN el borrador: si alguien escribió el texto y le
        // dio al switch sin guardar, lo que se ve tiene que ser lo que escribió
        // y no una versión vieja que ya nadie está mirando.
        setGuardando(true);
        const { error } = await setBannerPortal(
            encender
                ? { activo: true, texto, textoCorto, variante }
                : { activo: false },
        );
        setGuardando(false);
        if (error) {
            useToastStore.getState().showToast('Aviso del portal', mensajeAmigable(error), 'error');
            return;
        }
        setBorrador(null);
        useStaff.getState().appendAuditLog(
            encender ? 'BANNER_PORTAL_ON' : 'BANNER_PORTAL_OFF',
            'banner_portal',
            encender ? { texto, variante } : {},
        );
        useToastStore.getState().showToast(
            encender ? 'Aviso encendido' : 'Aviso apagado',
            encender
                ? 'Ya se ve en el tope de todas las pantallas.'
                : 'La franja desapareció del portal.',
            encender ? 'warning' : 'success',
        );
        await recargar();
    }, [texto, textoCorto, variante, recargar]);

    const guardar = useCallback(async () => {
        setGuardando(true);
        const { error } = await setBannerPortal({ activo, texto, textoCorto, variante });
        setGuardando(false);
        if (error) {
            useToastStore.getState().showToast('Aviso del portal', mensajeAmigable(error), 'error');
            return;
        }
        setBorrador(null);
        useStaff.getState().appendAuditLog('BANNER_PORTAL_EDIT', 'banner_portal', { texto, variante });
        useToastStore.getState().showToast(
            'Aviso guardado',
            activo ? 'Ya se ve con el texto nuevo.' : 'Queda listo para cuando lo enciendas.',
            'success',
        );
        await recargar();
    }, [activo, texto, textoCorto, variante, recargar]);

    return (
        <div className="flex flex-col gap-2.5 pt-1">
            <span className="text-micro font-black uppercase tracking-widest text-content-2 px-1">
                Aviso en el portal
            </span>

            <div data-surface="card" className="flex flex-col gap-4 px-4 py-3.5">

                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <span className="text-label font-medium text-content-1 block">
                            Franja de aviso en todas las pantallas
                        </span>
                        <span className="text-micro text-content-3 block mt-0.5">
                            Aparece arriba de todo, para todo el mundo, hasta que la apagues.
                        </span>
                        {activo && banner?.cambiado_at && (
                            <Badge variant="warning" size="sm" uppercase={false} className="mt-1.5">
                                Encendida desde {hora(banner.cambiado_at)}
                            </Badge>
                        )}
                    </div>
                    <Switch
                        checked={activo}
                        disabled={guardando || (!activo && sinTexto)}
                        onChange={alternar}
                        aria-label="Mostrar la franja de aviso en el portal"
                    />
                </div>

                {/* La vista previa usa el MISMO componente que pinta la franja de
                    verdad: si fuera una copia, el día que una cambie la otra
                    mentiría y nadie lo notaría hasta verlo en producción. */}
                <div className="rounded-btn overflow-hidden border border-border-card">
                    <FranjaBanner
                        variante={variante}
                        texto={texto || 'Escribe el aviso aquí abajo…'}
                        textoCorto={textoCorto}
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <PortalTextarea
                        label="Texto del aviso"
                        name="banner-texto"
                        value={texto}
                        onChange={e => editar('texto', e.target.value)}
                        rows={3}
                        colSpan={2}
                        maxLength={220}
                        placeholder="Qué está pasando y qué tiene que saber quien lee."
                        helperText="Se lee en pantallas anchas. Escríbelo en palabras del negocio, sin nombrar sistemas internos."
                    />
                    <PortalInput
                        label="Versión corta (teléfono)"
                        name="banner-texto-corto"
                        value={textoCorto}
                        onChange={e => editar('textoCorto', e.target.value)}
                        maxLength={70}
                        placeholder="Opcional"
                        helperText="Si la dejas vacía, en el teléfono se lee el texto largo repartido en varias líneas."
                    />
                    <div>
                        <label className={rotuloCampo('text-content-2')}>
                            Apariencia
                        </label>
                        <LiquidSelect
                            value={variante}
                            onChange={v => editar('variante', v || 'obra')}
                            options={VARIANTES_BANNER}
                            clearable={false}
                            icon={Megaphone}
                        />
                    </div>
                </div>

                {sinTexto && (
                    <Notice variant="warning" compact>
                        Sin texto no se puede encender: sería una franja de color sin explicación.
                    </Notice>
                )}

                <div className="flex justify-end">
                    <Button
                        icon={Save}
                        size="sm"
                        onClick={guardar}
                        loading={guardando}
                        disabled={!sucio || sinTexto}
                    >
                        Guardar texto y apariencia
                    </Button>
                </div>
            </div>
        </div>
    );
}
