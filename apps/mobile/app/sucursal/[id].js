// La ficha de una sucursal, NATIVO: dirección, teléfonos (tocar llama),
// la semana entera de horario, la gente asignada y la lista de alertas con
// qué falta o qué vence. Todo sale del núcleo (`sucursales`).
import { useMemo } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { abiertaAhora, ahoraEnSV, alertasDeSucursal, completitudDelPerfil, TIPOS_DE_SUCURSAL } from '@nucleo/utils/sucursales';
import { formatTime12h } from '@nucleo/utils/helpers';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Avatar from '../../componentes/Avatar';
import { MARCA } from '../../componentes/inicio/marca';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];

export default function Sucursal() {
  const { id } = useLocalSearchParams();
  const b = useStaffStore((s) => (s.branches || []).find((x) => String(x.id) === String(id)));
  const empleados = useStaffStore((s) => s.employees);
  const gente = useMemo(() => (empleados || []).filter((e) => String(e.branchId ?? e.branch_id) === String(id) && (e.status || '').toUpperCase() !== 'INACTIVO'), [empleados, id]);
  if (!b) return <Aviso tono="freno" texto="No se encontró la sucursal." />;
  const { dia, hora } = ahoraEnSV();
  const abierta = abiertaAhora(b, dia, hora);
  const alertas = alertasDeSucursal(b, Date.now(), gente);
  const comp = completitudDelPerfil(b);
  const semana = b.weeklyHours || b.weekly_hours || {};
  const tipo = b.type || 'FARMACIA';
  const llamar = (n) => Linking.openURL(`tel:${String(n).replace(/[^\d+]/g, '')}`).catch(() => {});

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: b.name, headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        <View style={{ gap: 6, marginHorizontal: 4 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '800' }}>{b.name}</Text>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Pildora texto={TIPOS_DE_SUCURSAL[tipo]?.label ?? tipo} color={MARCA.azulClaro} />
            {tipo === 'FARMACIA' ? <Pildora texto={abierta.label} color={abierta.status === 'OPEN' ? MARCA.verde : abierta.status === 'UNKNOWN' ? MARCA.ambar : colorSistema.texto2} /> : null}
          </View>
        </View>
        {alertas.hasAlerts ? (
          <Seccion titulo={`Alertas · ${alertas.list.length}`}>
            {alertas.list.map((a, i) => (
              <Text key={i} style={{ color: a.level === 'critical' ? MARCA.rojo : MARCA.ambar, fontSize: 15, fontWeight: '600' }}>{`• ${a.message}`}</Text>
            ))}
          </Seccion>
        ) : <Aviso tono="nota" texto="Operativa: sin alertas." />}
        <Seccion titulo="Contacto">
          <Dato primero rotulo="Dirección" valor={b.address || '—'} />
          {[['Teléfono', b.phone], ['Celular', b.cell]].filter(([, n]) => n).map(([r, n]) => (
            <Pressable key={r} onPress={() => llamar(n)}><Dato rotulo={r} valor={`${n}  ›`} /></Pressable>
          ))}
        </Seccion>
        {tipo === 'FARMACIA' ? (
          <Seccion titulo="Horario">
            {ORDEN_DIAS.map((d, i) => {
              const x = semana[String(d)];
              const v = !x || x.isOpen === false ? 'Cerrado' : x.start && x.end ? `${formatTime12h(x.start)} – ${formatTime12h(x.end)}` : 'No definido';
              return <Dato key={d} primero={i === 0} rotulo={d === dia ? `${DIAS[d]} (hoy)` : DIAS[d]} valor={v} fuerte={d === dia} />;
            })}
          </Seccion>
        ) : null}
        <Seccion titulo={`Personal · ${gente.length}`}>
          {gente.length ? gente.slice(0, 30).map((e, i) => (
            <Pressable key={e.id} onPress={() => router.push({ pathname: '/portal', params: { ruta: `/personal?empleado=${e.id}`, nombre: 'Personal' } })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 8 : 0 }}>
              <Avatar empleado={e} tamano={32} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{shortEmployeeName(e)}</Text>
                <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>{e.role || '—'}</Text>
              </View>
            </Pressable>
          )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Nadie asignado.</Text>}
        </Seccion>
        <Seccion titulo="Perfil completo">
          <Dato primero rotulo="Legal" valor={`${comp.legal}%`} />
          <Dato rotulo="Inmueble" valor={`${comp.property}%`} />
          <Dato rotulo="Servicios" valor={`${comp.services}%`} />
        </Seccion>
      </ScrollView>
    </>
  );
}
