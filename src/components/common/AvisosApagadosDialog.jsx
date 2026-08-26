import React, { useEffect, useMemo, useState } from 'react';
import { BellOff, Share, Lock, Users } from 'lucide-react';
import Button from './Button';
import ModalShell from './ModalShell';
import { usePushSubscription, esIOS, esApp } from '../../hooks/usePushSubscription';

// ── Por qué esto dejó de ser una franja abajo (2026-08-26) ───────────────────
//
// El `PushPromptBanner` que había acá vivía en `fixed bottom-5`, o sea encima de
// la barra inferior de sala y del carril de filtros: aparecía justo donde está
// el pulgar trabajando y se cerraba sin leer. Medido ese día: **24 de 49
// empleados activos sin una sola suscripción**, y salas enteras en 2 de 6.
//
// Pero el motivo de fondo no era dónde aparecía sino CUÁNDO: sólo se mostraba
// con `permission === 'default'`. Quien alguna vez tocó «Bloquear» no volvía a
// ver nada nunca —ni una explicación de cómo revertirlo—, y a quien tenía el
// permiso dado pero la suscripción perdida (o el equipo compartido ligado a otra
// persona) tampoco se le decía: creía tener avisos y no los tenía.
//
// O sea que el aviso que ofrecía activarlos era invisible **justo para quien más
// lo necesitaba**. Los cuatro estados se atienden acá, y los dos que no se
// arreglan con un botón traen el paso a paso del equipo que se está usando.
//
// Decisión del usuario ese día: un diálogo al entrar, **una vez al día**, hasta
// que los active. Un diálogo se puede posponer pero no ignorar por costumbre,
// que es lo que le pasó a la franja.

const POSPUESTO_KEY = 'avisos_apagados_pospuesto_v1';

// La fecha se arma con los getters LOCALES y nunca con `toISOString()`: en El
// Salvador (UTC−6) el ISO de las 8 de la noche ya dice mañana, así que el
// diálogo se saltearía un día entero cada tarde.
const hoyLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const leerPospuesto = () => {
    try { return localStorage.getItem(POSPUESTO_KEY); } catch { return null; }
};
const guardarPospuesto = () => {
    try { localStorage.setItem(POSPUESTO_KEY, hoyLocal()); } catch { /* modo privado */ }
};

export default function AvisosApagadosDialog() {
    const { permission, subscribed, subscribe, isSupported, necesitaInstalar, ligado } = usePushSubscription();
    const [visible, setVisible] = useState(false);

    /* Los cuatro estados en los que esta persona NO va a recibir un aviso, y
     * qué se puede hacer con cada uno. `null` = no hay nada que ofrecer, y
     * entonces no se molesta: insistir todos los días sin una salida es acoso,
     * no un recordatorio. */
    const modo = useMemo(() => {
        if (subscribed) return null;
        if (necesitaInstalar) return 'instalar';                    // iPhone, todavía en el navegador
        if (!isSupported) return null;                              // sin salida posible desde acá
        if (permission === 'denied') return 'desbloquear';          // lo bloqueó alguna vez
        if (permission === 'granted' && !ligado) return 'otro-equipo';
        return 'activar';                                           // 'default', o permiso dado sin suscripción
    }, [subscribed, necesitaInstalar, isSupported, permission, ligado]);

    useEffect(() => {
        if (!modo) return;
        if (leerPospuesto() === hoyLocal()) return;

        /* El día se marca al MOSTRARLO, no al cerrarlo: si se marcara al
         * cerrar, quien lo descarta con Esc o tocando el fondo lo volvería a
         * ver en cada recarga del día — y en sala la sesión se cierra sola cada
         * 5 minutos, o sea muchas veces. «Una vez al día» tiene que valer
         * también para quien no contesta. */
        const t = setTimeout(() => { guardarPospuesto(); setVisible(true); }, 2500);
        return () => clearTimeout(t);
    }, [modo]);

    if (!visible || !modo) return null;

    const cerrar = () => setVisible(false);

    const activar = async () => {
        setVisible(false);
        await subscribe();
    };

    // El paso a paso sale del equipo que se está usando: «revisa los permisos»
    // no lo puede seguir nadie, y son los dos casos que un botón no resuelve.
    const pasos = modo === 'instalar'
        ? ['Toca Compartir, abajo en la barra del navegador',
           'Elige «Agregar a inicio»',
           'Abre el portal desde el ícono nuevo']
        : esIOS() && esApp()
            ? ['Abre Ajustes en el teléfono',
               'Entra a Notificaciones y busca el portal',
               'Permite los avisos y vuelve a entrar']
            : ['Toca el candado que está junto a la dirección, arriba',
               'Entra a Permisos y busca Notificaciones',
               'Elige Permitir y vuelve a entrar al portal'];

    const contenido = {
        activar: {
            icono: BellOff,
            titulo: 'No vas a recibir avisos',
            prosa: 'Cuando alguien apruebe o rechace lo que pediste, sólo lo verás si entras al portal a mirar.',
            accion: 'Activar avisos',
        },
        'otro-equipo': {
            icono: Users,
            titulo: 'Este equipo avisa a otra persona',
            prosa: 'Los avisos de este equipo le llegan a quien lo usó antes que tú. Actívalos para que te lleguen a ti.',
            accion: 'Activar para mí',
        },
        desbloquear: {
            icono: Lock,
            titulo: 'Los avisos están bloqueados',
            prosa: 'Este equipo tiene los avisos bloqueados para el portal, así que no te llega ninguno. Se desbloquean así:',
            accion: null,
        },
        instalar: {
            icono: Share,
            titulo: 'Agrega el portal a tu inicio',
            prosa: 'En el iPhone los avisos sólo llegan con el portal agregado a la pantalla de inicio.',
            accion: null,
        },
    }[modo];

    const Icono = contenido.icono;

    return (
        <ModalShell
            // Centrado y no como hoja, por el mismo motivo que `AlertModal`: es
            // una interrupción con una decisión, no un panel con el que se
            // trabaja. Subiendo desde abajo se confundiría con la hoja de
            // filtros — que es justo lo que le pasaba a la franja anterior.
            hojaEnTactil={false}
            open={visible}
            onClose={cerrar}
            maxWidthClass="max-w-sm"
            zClass="z-toast"
            ariaLabel={contenido.titulo}
        >
            <div data-surface="modal" className="overflow-hidden relative">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-32 blur-[40px] rounded-full pointer-events-none bg-brand/15" />

                <div className="p-8 text-center flex flex-col items-center relative z-base">
                    <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-6 border border-border-card
                                    bg-surface-card-hover shadow-sm text-brand-text">
                        <Icono size={36} strokeWidth={2.5} />
                    </div>

                    <h3 className="text-title font-black uppercase tracking-tight mb-2 leading-none text-content">
                        {contenido.titulo}
                    </h3>
                    <p className="text-body text-content-3 leading-relaxed">{contenido.prosa}</p>

                    {!contenido.accion && (
                        <ol className="mt-4 w-full flex flex-col gap-2 text-left">
                            {pasos.map((paso, i) => (
                                <li key={paso} className="flex items-start gap-3">
                                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand/15 text-brand-text
                                                     text-label font-black flex items-center justify-center">{i + 1}</span>
                                    <span className="text-body text-content leading-tight pt-0.5">{paso}</span>
                                </li>
                            ))}
                        </ol>
                    )}

                    <div className="mt-7 w-full flex flex-col gap-2">
                        {contenido.accion && (
                            <Button onClick={activar} className="w-full">{contenido.accion}</Button>
                        )}
                        <Button variant="ghost" onClick={cerrar} className="w-full">
                            {contenido.accion ? 'Hoy no' : 'Entendido'}
                        </Button>
                    </div>
                </div>
            </div>
        </ModalShell>
    );
}
