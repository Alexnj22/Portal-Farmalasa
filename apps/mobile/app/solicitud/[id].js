// Una solicitud, nativa: lo que abre tocar un aviso (en la notificación del
// teléfono o en la pestaña Notificaciones) — y donde se decide.
//
// Decisión del usuario del 2026-09-30: «quitemos las aprobaciones desde ahí
// [la notificación], lo siento raro, y mejoremos la experiencia en lo nativo
// de la app». La notificación informa; esta pantalla muestra TODO —quién,
// qué, todos los renglones, la nota— y tiene los botones.
//
// Todo sale del núcleo, igual que en el portal: la fila se lee con
// `cargarFilaDeAviso`, lo que dice con `detalleDeSolicitud`, quién puede
// decidir con `utils/accionesDeAviso.js` y la decisión con `decidirSolicitud`.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Button, Host, Row } from '@expo/ui';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cargarFilaDeAviso } from '@nucleo/data/solicitudDeAviso';
import { detalleDeMinMax, detalleDeSolicitud } from '@nucleo/utils/tarjetaDeSolicitud';
import { puedeDecidirAviso, trasladoPorResolver } from '@nucleo/utils/accionesDeAviso';
import { REQUEST_STATUS, REQUEST_TYPES } from '@nucleo/store/slices/requestsSlice';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { cuandoLlego } from '@nucleo/utils/notificacionTexto';
import { colorSistema } from '../../componentes/Formulario';
import { decidirDesdeAviso, enviarTraslado, rechazarTrasladoDesdeAviso } from '../../componentes/avisos';
import { abrirRuta } from '../../pantallas';

const COLOR_ESTADO = { PENDING: colorSistema.naranja, APPROVED: colorSistema.verde, REJECTED: colorSistema.rojo };

function Avatar({ empleado }) {
  const foto = empleado?.photo || empleado?.photo_url;
  if (foto) return <Image source={{ uri: foto }} style={{ width: 56, height: 56, borderRadius: 28 }} />;
  const letras = shortEmployeeName(empleado).split(/\s+/).slice(0, 2).map((p) => p.charAt(0).toUpperCase()).join('');
  return (
    <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colorSistema.separador, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colorSistema.texto2, fontSize: 18, fontWeight: '600' }}>{letras || '•'}</Text>
    </View>
  );
}

export default function Solicitud() {
  const { id } = useLocalSearchParams();
  const clave = String(id ?? '');
  const esMinMax = clave.startsWith('minmax:');
  const idReal = esMinMax ? clave.slice(7) : clave;
  const { user, hasPermission } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const [fila, setFila] = useState(undefined);   // undefined = cargando, null = no está
  const [error, setError] = useState(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setError(null);
      setFila(await cargarFilaDeAviso({ metadata: { request_id: idReal, request_type: esMinMax ? 'MINMAX' : null } }));
    } catch (e) {
      setError(e?.message ?? String(e));
      setFila(null);
    }
  }, [idReal, esMinMax]);
  useEffect(() => { cargar(); }, [cargar]);

  const tipo = esMinMax ? 'MINMAX_CHANGE_REQUEST' : fila?.type;
  const quienId = esMinMax ? fila?.requested_by_id : fila?.employee_id;
  const empleado = useMemo(() => (empleados || []).find((e) => String(e.id) === String(quienId)), [empleados, quienId]);
  const detalle = fila ? (esMinMax ? detalleDeMinMax(fila) : detalleDeSolicitud(fila)) : null;
  const estado = fila?.status ?? 'PENDING';
  const url = esMinMax ? `/solicitudes?solicitud=minmax:${idReal}` : `/solicitudes?solicitud=${idReal}`;

  // Quién puede decidir: la misma regla que la campana del portal, con el aviso
  // que describe esta solicitud.
  const aviso = { type: esMinMax ? 'MINMAX_PENDING' : 'REQUEST_PENDING', metadata: { request_type: esMinMax ? 'MINMAX' : tipo, request_id: idReal } };
  const d = { solicitud: clave, url, tarjeta: detalle ? { contexto: detalle.contexto } : undefined };
  const pendiente = estado === 'PENDING';
  const acciones = !fila || !pendiente ? []
    : trasladoPorResolver(aviso, hasPermission)
      ? [{ rotulo: 'Enviar todo', principal: true, hacer: () => enviarTraslado(d) },
         { rotulo: 'Rechazar…', hacer: () => rechazarTrasladoDesdeAviso(d) }]
      : puedeDecidirAviso(aviso, hasPermission)
        ? [{ rotulo: 'Aprobar', principal: true, hacer: () => decidirDesdeAviso(d, 'approve', user?.id) },
           { rotulo: 'Rechazar…', hacer: () => decidirDesdeAviso(d, 'reject', user?.id) }]
        : [];

  const hacer = async (a) => {
    setOcupado(true);
    const ok = await a.hacer();
    setOcupado(false);
    if (ok) { await cargar(); router.back(); }
  };

  const titulo = REQUEST_TYPES[tipo]?.label ?? 'Solicitud';

  return (
    <>
      <Stack.Screen options={{ title: titulo }} />
      <ScrollView style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 16 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={false} onRefresh={cargar} />}>
        {fila === undefined ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 40 }}>Cargando…</Text>
        ) : !fila ? (
          <Text style={{ color: colorSistema.texto2, textAlign: 'center', marginTop: 40 }}>{error ?? 'Esta solicitud ya no está disponible.'}</Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
              {empleado ? <Avatar empleado={empleado} /> : null}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '700' }}>
                  {empleado ? shortEmployeeName(empleado) : titulo}
                </Text>
                {detalle?.contexto ? <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{detalle.contexto}</Text> : null}
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                  {cuandoLlego(fila.created_at ?? fila.requested_at)}
                </Text>
              </View>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colorSistema.fila }}>
                <Text style={{ color: COLOR_ESTADO[estado] ?? colorSistema.texto2, fontSize: 13, fontWeight: '600' }}>
                  {REQUEST_STATUS[estado]?.label ?? estado}
                </Text>
              </View>
            </View>

            {detalle?.renglones?.length ? (
              <View style={{ backgroundColor: colorSistema.fila, borderRadius: 14, paddingHorizontal: 14 }}>
                {detalle.renglones.map(([a, b], i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 10, paddingVertical: 12, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{a}</Text>
                    {b ? <Text style={{ color: colorSistema.texto2, fontSize: 15, fontVariant: ['tabular-nums'] }}>{b}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}

            {detalle?.pie || fila.note ? (
              <View style={{ backgroundColor: colorSistema.fila, borderRadius: 14, padding: 14, gap: 4 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Nota</Text>
                <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{detalle?.pie || fila.note}</Text>
              </View>
            ) : null}

            {fila.approver_note && !pendiente ? (
              <View style={{ backgroundColor: colorSistema.fila, borderRadius: 14, padding: 14, gap: 4 }}>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>Respuesta</Text>
                <Text style={{ color: colorSistema.texto, fontSize: 15 }}>{fila.approver_note}</Text>
              </View>
            ) : null}

            {acciones.length ? (
              <Host matchContents={{ vertical: true }} style={{ width: '100%' }}>
                <Row spacing={10}>
                  {acciones.map((a) => (
                    <Button key={a.rotulo} variant={a.principal ? 'filled' : 'outlined'} label={a.rotulo}
                      disabled={ocupado} onPress={() => hacer(a)} />
                  ))}
                </Row>
              </Host>
            ) : null}

            <Pressable onPress={() => abrirRuta(url)} style={{ alignSelf: 'center', paddingVertical: 8 }}>
              <Text style={{ color: colorSistema.acento, fontSize: 15 }}>Ver en el portal</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </>
  );
}
