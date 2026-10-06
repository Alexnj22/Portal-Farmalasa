// La persona de un aviso, con su cara — `usePersona` de `TarjetasDeOperacion`
// del portal, en la app.
//
// La lista de empleados del store está ACOTADA por permisos: quien no está en
// ella salía con sus iniciales. Por eso el aviso trae la URL guardada de la foto
// (`quien_foto`) y, si hace falta, se firma acá; si tampoco la trae (el
// conductor de un pedido, un aviso viejo), se le pregunta a la base por su id.
// `fetchFotoDeEmpleado` y `getSignedFileUrl` guardan en caché: la misma cara en
// diez avisos es una sola lectura y una sola firma.
import { useEffect, useState } from 'react';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchFotoDeEmpleado } from '@nucleo/data/notifications';
import { getSignedFileUrl } from '@nucleo/utils/storageFiles';

export function usePersona(id, nombre, foto) {
  const ficha = useStaffStore((s) => (id ? (s.employees || []).find((e) => String(e.id) === String(id)) : null)) || null;
  const necesita = !ficha?.photo;
  const [guardada, setGuardada] = useState(foto || null);
  const [firmada, setFirmada] = useState(null);

  useEffect(() => {
    if (!necesita || foto || !id) return undefined;
    let vivo = true;
    fetchFotoDeEmpleado(id).then((u) => { if (vivo) setGuardada(u || null); });
    return () => { vivo = false; };
  }, [id, foto, necesita]);

  useEffect(() => {
    if (!necesita || !guardada) return undefined;
    let vivo = true;
    getSignedFileUrl(guardada, 43200).then((u) => { if (vivo) setFirmada(u || null); }).catch(() => {});
    return () => { vivo = false; };
  }, [guardada, necesita]);

  if (ficha) return firmada ? { ...ficha, photo: firmada } : ficha;
  if (!id && !nombre) return null;
  return { ...(id ? { id } : {}), name: nombre, ...(firmada ? { photo: firmada } : {}) };
}
