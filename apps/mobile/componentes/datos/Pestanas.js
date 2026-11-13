// Las pestañas «Incidentes» y «Anonimizados» de Solicitudes de datos, NATIVAS
// — gemelas de `src/views/datos/IncidentesDatos.jsx` y `AnonimizadosDatos.jsx`
// (2026-11-13, «dejemos TODO completamente nativo»). El registro de
// vulneraciones (Art. 25) vive con las solicitudes porque lo lleva la misma
// persona y lo pide la misma ley; los anonimizados son el derecho de
// cancelación ya ejecutado, con la consulta del resguardo y la reactivación.
import { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { fetchAnonimizaciones, fetchIncidentes, plazoDeIncidente } from '@nucleo/data/solicitudesDatos';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Cargando, Vacio } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Vidrio from '../Vidrio';
import Tocable from '../Tocable';
import { MARCA } from '../inicio/marca';
import { ConsultaResguardo, Reactivar } from './Anonimizar';

const cuando = (iso) => (iso ? fechaTexto(iso, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const dia = (iso) => (iso ? fechaTexto(iso, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function EstadoDelPlazo({ inc }) {
  const p = plazoDeIncidente(inc);
  if (!p) return null;
  if (inc.cerrado_at) return <Pildora texto="Cerrado" color={colorSistema.texto2} />;
  if (p.completo) return <Pildora texto="Notificado" color={MARCA.verde} />;
  return <Pildora texto={p.vencido ? `Vencido hace ${Math.abs(p.horas)} h` : `Quedan ${p.horas} h`}
    color={p.vencido ? MARCA.rojo : p.horas <= 24 ? MARCA.ambar : MARCA.azulClaro} />;
}

export function Incidentes() {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  // Al volver de registrar o editar uno, la lista se relee.
  useFocusEffect(useCallback(() => {
    let vivo = true;
    fetchIncidentes()
      .then((d) => { if (vivo) { setFilas(d); setError(null); } })
      .catch((e) => { if (vivo) { setFilas([]); setError(mensajeAmigable(e, 'No se pudo cargar.')); } });
    return () => { vivo = false; };
  }, []));

  const pendientes = useMemo(() => (filas ?? []).filter((i) => {
    const p = plazoDeIncidente(i);
    return !i.cerrado_at && p && !p.completo;
  }).length, [filas]);
  const abrir = (idInc) => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/incidente-datos/[id]', params: { id: String(idInc) } }); };

  return (
    <View style={{ gap: 10 }}>
      <View style={{ marginHorizontal: 16, gap: 10 }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
          Si se pierden, se filtran o alguien accede sin permiso a datos personales, hay setenta y dos horas desde que se detecta para notificar a la Agencia de Ciberseguridad del Estado, a la Fiscalía y a las personas afectadas (Art. 25).
        </Text>
        <BotonGrande texto="Registrar incidente" color={MARCA.azul} onPress={() => abrir('nuevo')} />
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {pendientes ? <Aviso tono="freno" texto={`${pendientes === 1 ? 'Hay un incidente' : `Hay ${pendientes} incidentes`} con notificaciones pendientes.`} /> : null}
      </View>
      {filas == null ? <Cargando /> : filas.map((i) => (
        <Tocable key={i.id} onPress={() => abrir(i.id)} style={{ marginHorizontal: 16 }}>
          <Vidrio radio={20} interactivo>
            <View style={{ padding: 12, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13 }}>{cuando(i.detectado_at)}</Text>
                <EstadoDelPlazo inc={i} />
              </View>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }} numberOfLines={2}>{i.naturaleza}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={2}>{i.datos_comprometidos}</Text>
              {i.registrado ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Lo registró ${shortEmployeeName(i.registrado)}`}</Text> : null}
            </View>
          </Vidrio>
        </Tocable>
      ))}
      {filas && !filas.length ? <Vacio>Sin incidentes registrados</Vacio> : null}
    </View>
  );
}

export function Anonimizados() {
  const [filas, setFilas] = useState(null);
  const [error, setError] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const [reactivando, setReactivando] = useState(false);
  const [vuelta, setVuelta] = useState(0);

  useFocusEffect(useCallback(() => {
    let vivo = true;
    fetchAnonimizaciones()
      .then((d) => { if (vivo) { setFilas(d); setError(null); } })
      .catch((e) => { if (vivo) { setFilas([]); setError(mensajeAmigable(e, 'No se pudo cargar.')); } });
    return () => { vivo = false; };
  }, [vuelta]));

  return (
    <View style={{ gap: 10 }}>
      <View style={{ marginHorizontal: 16, gap: 10 }}>
        <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
          Clientes que pidieron cancelar sus datos. Si una persona vuelve, se reactiva su misma ficha presentando el documento con que se identificó; los puntos no vuelven.
        </Text>
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {reactivando ? (
          <Vidrio radio={20}>
            <View style={{ padding: 14, gap: 8 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>Reactivar datos</Text>
              <Reactivar onHecho={() => { setReactivando(false); setVuelta((v) => v + 1); }} />
              <BotonGrande texto="Cancelar" borde color={colorSistema.texto2} onPress={() => setReactivando(false)} />
            </View>
          </Vidrio>
        ) : <BotonGrande texto="Reactivar datos" color={MARCA.azul} onPress={() => setReactivando(true)} />}
      </View>
      {filas == null ? <Cargando /> : filas.map((a) => {
        const esta = abierta === a.id;
        return (
          <View key={a.id} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={20}>
              <View style={{ padding: 12, gap: 6 }}>
                <Tocable onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierta(esta ? null : a.id); }} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{`Ficha #${a.customer_id}`}</Text>
                    {a.reactivada_at
                      ? <Pildora texto={`Reactivada el ${dia(a.reactivada_at)}`} color={MARCA.azulClaro} />
                      : (a.archivos_pendientes ?? []).length
                        ? <Pildora texto="Archivos por borrar" color={MARCA.ambar} />
                        : <Pildora texto="Anonimizada" color={colorSistema.texto2} />}
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {[a.solicitud?.folio_txt ? `Solicitud ${a.solicitud.folio_txt}` : null, `Anonimizada el ${dia(a.anonimizada_at)}`, `${Number(a.puntos_perdidos ?? 0).toLocaleString('es-SV')} puntos perdidos`].filter(Boolean).join(' · ')}
                  </Text>
                  <Text style={{ color: colorSistema.acento, fontSize: 14 }}>{esta ? 'Ocultar el resguardo' : 'Consultar el resguardo'}</Text>
                </Tocable>
                {esta ? <ConsultaResguardo anonimizacionId={a.id} /> : null}
              </View>
            </Vidrio>
          </View>
        );
      })}
      {filas && !filas.length ? <Vacio>Nadie ha pedido anonimizar sus datos</Vacio> : null}
    </View>
  );
}
