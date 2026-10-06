// Las personas de un pedido —quien lo creó, preparó, envió, recibió, apoyó—
// con su cara. Es el `empMap` del tablero del portal (`usePedidosData`).
//
// La lista del store está ACOTADA por permisos: el preparador de Bodega no
// está en la de una sala. Los que faltan se piden por id a `employees_safe`
// (nombre y foto, nada más) y su foto se firma, porque el bucket es privado y la
// URL cruda da 403 — un círculo vacío en vez de una cara.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchEmployeesPublicByIds } from '@nucleo/data/employees';
import { signPhotosDeep } from '@nucleo/utils/storageFiles';

/** Todos los ids de persona que trae una fila del tablero. */
export function idsDelPedido(row) {
  if (!row) return [];
  const ids = [row.created_by, row.iniciado_por, row.finalizado_por, row.enviado_por, row.llegada_fisica_por,
    row.conteo_por, row.recibido_erp_por, row.diferencias_reportadas_por, row.confirmado_correccion_por, row.reenvio_por];
  (row.pauses ?? []).forEach((p) => ids.push(p.pausado_por, p.reanudado_por));
  (row.reenvios_historial ?? []).forEach((c) => ids.push(c.sent_by, c.arrived_por));
  return ids.filter(Boolean).map(String);
}

/** `quien(id)` → la persona (o null), sumando las que no están en el store. */
export function usePersonas(ids) {
  const empleados = useStaffStore((s) => s.employees);
  const [externos, setExternos] = useState(() => new Map());
  const clave = [...new Set((ids || []).map(String))].sort().join(',');

  useEffect(() => {
    const deStore = new Set((empleados || []).map((e) => String(e.id)));
    const faltan = clave ? clave.split(',').filter((id) => !deStore.has(id) && !externos.has(id)) : [];
    if (!faltan.length) return undefined;
    let vivo = true;
    (async () => {
      const { data, error } = await fetchEmployeesPublicByIds(faltan);
      if (error || !vivo) return;
      await signPhotosDeep(data || []).catch(() => {});
      if (!vivo) return;
      setExternos((m) => {
        const n = new Map(m);
        (data || []).forEach((e) => n.set(String(e.id), { ...e, photo: e.photo_url }));
        // Los que no volvieron (dados de baja) quedan marcados para no pedirlos otra vez.
        faltan.forEach((id) => { if (!n.has(id)) n.set(id, null); });
        return n;
      });
    })();
    return () => { vivo = false; };
  }, [clave, empleados]); // eslint-disable-line react-hooks/exhaustive-deps

  const porId = useMemo(() => {
    const m = new Map();
    (empleados || []).forEach((e) => m.set(String(e.id), e));
    externos.forEach((v, k) => { if (v && !m.has(k)) m.set(k, v); });
    return m;
  }, [empleados, externos]);

  return useCallback((id) => (id ? porId.get(String(id)) ?? null : null), [porId]);
}
