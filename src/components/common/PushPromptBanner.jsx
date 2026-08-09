import React, { useEffect, useState } from 'react';
import Button from './Button';
import { Bell, X, Share } from 'lucide-react';
import { usePushSubscription } from '../../hooks/usePushSubscription';

const DISMISSED_KEY = 'push_prompt_dismissed_v1';
// Clave aparte para el aviso de instalar: son dos mensajes distintos y cerrar
// uno no puede silenciar al otro. Y va en `localStorage` y no en `sessionStorage`
// porque instalar la app es un trámite que la persona hace cuando puede — que
// se lo vuelva a pedir en cada visita del día es acoso, no un recordatorio.
const INSTALAR_KEY  = 'push_instalar_dismissed_v1';

export default function PushPromptBanner() {
  const { permission, subscribed, subscribe, isSupported, necesitaInstalar } = usePushSubscription();
  const [visible, setVisible] = useState(false);
  const [modo, setModo] = useState(null);   // 'activar' | 'instalar'

  useEffect(() => {
    if (subscribed) return;

    // El aviso de instalar existe porque, sin él, en un iPhone dentro del
    // navegador NO se veía absolutamente nada: el aviso de activar exige
    // `permission === 'default'` y ahí el valor es `unsupported`. La persona no
    // tenía cómo enterarse de que faltaba un paso.
    const cual = necesitaInstalar ? 'instalar'
      : (isSupported && permission === 'default') ? 'activar'
      : null;
    if (!cual) return;

    const clave = cual === 'instalar' ? INSTALAR_KEY : DISMISSED_KEY;
    const guardado = cual === 'instalar'
      ? localStorage.getItem(clave)
      : sessionStorage.getItem(clave);
    if (guardado) return;

    // Un retraso para que no aparezca de golpe al cargar.
    const t = setTimeout(() => { setModo(cual); setVisible(true); }, 2500);
    return () => clearTimeout(t);
  }, [isSupported, permission, subscribed, necesitaInstalar]);

  if (!visible) return null;

  const dismiss = () => {
    if (modo === 'instalar') localStorage.setItem(INSTALAR_KEY, '1');
    else sessionStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  };

  const handleActivar = async () => {
    setVisible(false);
    await subscribe();
  };

  const instalar = modo === 'instalar';

  return (
    <div data-surface="dropdown" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-banner w-[calc(100%-2rem)] max-w-sm
                    flex items-center gap-3 px-4 py-3 animate-in slide-in-from-bottom-4 duration-[var(--dur-slow)]">
      <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-chart-3/20 border border-chart-3/25
                      flex items-center justify-center">
        {instalar
          ? <Share size={16} className="text-chart-3-text" />
          : <Bell  size={16} className="text-chart-3-text" />}
      </div>
      <div className="flex-1 min-w-0">
        {instalar ? (
          <>
            <p className="text-body font-semibold text-content leading-tight">Agrega el portal a tu inicio</p>
            {/* El paso concreto, no «tu dispositivo no es compatible». Es lo
                único que separa a esta persona de recibir avisos. */}
            <p className="text-label text-content-3 leading-tight mt-0.5">
              Toca Compartir y luego «Agregar a inicio». Así recibes avisos con el portal cerrado.
            </p>
          </>
        ) : (
          <>
            <p className="text-body font-semibold text-content leading-tight">Activa las notificaciones</p>
            <p className="text-label text-content-3 leading-tight mt-0.5">Recibe avisos aunque tengas la app cerrada</p>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Sin botón de acción cuando hay que instalar: el paso ocurre en el
            menú del teléfono y ningún botón nuestro puede dispararlo. Uno que
            no hiciera nada sería peor que ninguno. */}
        {!instalar && <Button onClick={handleActivar}>Activar</Button>}
        <Button variant="ghost" icon={X} iconOnly onClick={dismiss}
          aria-label={instalar ? 'Cerrar el aviso de instalación' : 'Ahora no'} />
      </div>
    </div>
  );
}
