import React, { useEffect, useState } from 'react';
import Button from './Button';
import { Bell, X } from 'lucide-react';
import { usePushSubscription } from '../../hooks/usePushSubscription';

const DISMISSED_KEY = 'push_prompt_dismissed_v1';

export default function PushPromptBanner() {
  const { permission, subscribed, subscribe, isSupported } = usePushSubscription();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isSupported) return;
    if (permission !== 'default') return;
    if (subscribed) return;
    if (sessionStorage.getItem(DISMISSED_KEY)) return;
    // Small delay so it doesn't flash immediately on load
    const t = setTimeout(() => setVisible(true), 2500);
    return () => clearTimeout(t);
  }, [isSupported, permission, subscribed]);

  if (!visible) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  };

  const handleActivar = async () => {
    setVisible(false);
    await subscribe();
  };

  return (
    <div data-surface="dropdown" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-banner w-[calc(100%-2rem)] max-w-sm
                    flex items-center gap-3 px-4 py-3 animate-in slide-in-from-bottom-4 duration-300">
      <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-chart-3/20 border border-chart-3/25
                      flex items-center justify-center">
        <Bell size={16} className="text-chart-3-text" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-body font-semibold text-content leading-tight">Activa las notificaciones</p>
        <p className="text-label text-content-3 leading-tight mt-0.5">Recibe avisos aunque tengas la app cerrada</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Button  onClick={handleActivar}>Activar</Button>
        <Button variant="secondary" icon={X} iconOnly onClick={dismiss} />
      </div>
    </div>
  );
}
