// El código de autorización del kiosco y el código SU — lo que en el portal
// muestra el menú de Ajustes de la barra lateral (`AppLayout` +
// `SidebarSettingsMenu`), con las MISMAS reglas:
//   · se pide sólo con `kiosk_pin/can_view` (el servidor, `get_kiosk_auth_code`,
//     exige ese permiso y sin él lanza FORBIDDEN);
//   · el SU se muestra con `su_pin/can_view` y viaja en la misma respuesta;
//   · rota cada hora en el servidor: se relee cada 5 minutos y al cruzar la
//     hora, para no mostrar uno vencido;
//   · sin red no se inventa: se muestran los puntos.
import { useEffect, useState } from 'react';
import { fetchKioskAuthCode } from '@nucleo/data/kioskAuth';

const VACIO = { codigo: '····', sufijo: '··' };

export function useCodigoDeKiosco(puede) {
  const [estado, setEstado] = useState(VACIO);
  useEffect(() => {
    if (!puede) return undefined;
    let vivo = true;
    let alCruzar = null;
    const refrescar = async () => {
      const { data, error } = await fetchKioskAuthCode().catch((e) => ({ error: e }));
      if (!vivo) return;
      if (error || !data) { setEstado(VACIO); return; }
      setEstado({ codigo: data.code || VACIO.codigo, sufijo: data.su_suffix || VACIO.sufijo });
    };
    const programarHora = () => {
      const ahora = new Date();
      const falta = (60 - ahora.getMinutes()) * 60_000 - ahora.getSeconds() * 1000 + 2000;
      alCruzar = setTimeout(() => { refrescar(); programarHora(); }, falta);
    };
    refrescar();
    programarHora();
    const reloj = setInterval(refrescar, 5 * 60 * 1000);
    return () => { vivo = false; clearInterval(reloj); clearTimeout(alCruzar); };
  }, [puede]);
  return estado;
}
