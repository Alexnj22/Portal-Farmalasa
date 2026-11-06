// Lo que un conteo que ajusta el inventario aplicó, en la app (2026-11-05).
// Gemelo de `AjusteEnCaja` del portal: mismo store, mismas reglas. Se refresca
// solo mientras quede algo en cola; «Reintentar» no repite lo ya hecho.
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { fallo } from '../Progreso';

const mesAnio = (v) => { const [a, m] = String(v || '').split('-'); return a && m ? `${m}/${a}` : ''; };
const rotulo = (l) => {
  const u = Number(l.unidades);
  const lote = !l.lote || /^gen[eé]rico$/i.test(l.lote) ? 'sin lote asignado' : `lote ${l.lote}`;
  return `${u > 0 ? '+' : '−'}${Math.abs(u)} ${lote}${l.vence ? ` (vence ${mesAnio(l.vence)})` : ''} — ${l.hecho ? 'aplicado' : (l.error ?? 'pendiente')}`;
};

export default function AjusteDelInventario({ conteoId }) {
  const { hasPermission } = useAuth();
  const fetchConteoCaja = useStaffStore((s) => s.fetchConteoCaja);
  const reintentar = useStaffStore((s) => s.reintentarConteoCaja);
  const [datos, setDatos] = useState(null);
  const [ocupado, setOcupado] = useState(null);

  const cargar = useCallback(() => fetchConteoCaja(conteoId).then(setDatos).catch(() => {}), [conteoId, fetchConteoCaja]);
  useEffect(() => { cargar(); }, [cargar]);
  const movs = datos?.movimientos ?? [];
  const n = (e) => movs.filter((m) => m.estado === e).length;
  const enCola = n('PENDIENTE') + n('APLICANDO');
  useEffect(() => {
    if (!enCola) return undefined;
    const t = setInterval(cargar, 15000);
    return () => clearInterval(t);
  }, [enCola, cargar]);
  if (!datos) return null;
  const problemas = movs.filter((m) => m.estado === 'ERROR' || m.estado === 'INCIERTO');

  const otraVez = async (id) => {
    setOcupado(id);
    try { await reintentar(id); await cargar(); } catch (e) { fallo('No se pudo reintentar', mensajeAmigable(e)); } finally { setOcupado(null); }
  };

  const resumen = !movs.length ? 'Sin diferencias: el inventario ya estaba como se contó.'
    : enCola ? `Ajustando el inventario: ${n('HECHO')} de ${movs.length} productos listos. Sigue solo aunque cierres esta pantalla.`
      : problemas.length ? `${n('HECHO')} de ${movs.length} productos quedaron como se contaron. ${problemas.length} no se pudieron aplicar.`
        : `Los ${movs.length} productos con diferencia quedaron en el inventario como se contaron.`;

  return (
    <View style={{ gap: 10 }}>
      <Aviso tono={problemas.length && !enCola ? 'cuidado' : 'nota'} texto={resumen} />
      {problemas.map((m) => (
        <View key={m.id} style={{ gap: 4, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colorSistema.separador }}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>
            {`${m.producto ?? `Producto ${m.erp_product_id}`}${m.is_vencidos ? ' · vencidos' : ''}`}
          </Text>
          {(m.lineas ?? []).filter((l) => Number(l.unidades)).map((l) => (
            <Text key={`${l.lote}|${l.vence}`} style={{ color: colorSistema.texto2, fontSize: 13 }}>{rotulo(l)}</Text>
          ))}
          {m.estado === 'INCIERTO' ? <Aviso tono="cuidado" texto="Puede haber entrado una parte. Revisa los movimientos del producto antes de reintentar." /> : null}
          {hasPermission('conteo_inventario', 'can_approve') ? (
            <BotonGrande texto={ocupado === m.id ? 'Reintentando…' : 'Reintentar'} borde color={MARCA.azulClaro}
              deshabilitado={ocupado === m.id} onPress={() => otraVez(m.id)} />
          ) : null}
        </View>
      ))}
    </View>
  );
}
