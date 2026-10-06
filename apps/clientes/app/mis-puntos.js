// El QR del ticket (`https://portal.farmasalud.lat/mis-puntos?codigo=…`).
// Con la app instalada, el iPhone abre ESTA ruta en vez de la web (enlace
// universal: `public/.well-known/apple-app-site-association` del portal).
//
// Con sesión, va directo a sus puntos. Sin sesión, abre «Entrar» con el
// código ya escrito: la persona sólo toca «Entrar». No entra sola — un QR
// fotografiado de un ticket ajeno no debe abrir la cuenta de otro sin que
// nadie lo confirme.
import { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useSesion } from '../lib/sesion';
import { Cargando } from '../componentes/ui';

export default function MisPuntos() {
  const { codigo } = useLocalSearchParams();
  const token = useSesion((s) => s.token);
  const lista = useSesion((s) => s.lista);
  useEffect(() => {
    if (!lista) return;
    if (token) router.replace('/puntos');
    else router.replace({ pathname: '/entrar', params: codigo ? { codigo: String(codigo).toUpperCase().slice(0, 7) } : {} });
  }, [lista, token, codigo]);
  return <Cargando />;
}
