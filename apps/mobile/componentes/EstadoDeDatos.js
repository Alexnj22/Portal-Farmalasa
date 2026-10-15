// El recuadro «Datos» del menú de Ajustes del portal (`SidebarSyncStatus`):
// un punto por sala —verde al día, ámbar atrasada, rojo caída— y hace cuánto
// fue la última actualización. Lo deciden las funciones del núcleo
// (`estadoDeSincronizacion`), las mismas de la web.
//
// Mismas reglas que allá: sólo lo ve quien tiene `inventario` o `sync_health`
// (los únicos que pueden leer la tabla); la fila nueva llega por tiempo real y
// se aplica tal cual, con una relectura cada 90 s como red. Tocarlo abre
// Actualización de datos si se tiene ese módulo.
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchInventorySyncLogRecent } from '@nucleo/data/inventory';
import { escucharCambios } from '@nucleo/data/tiempoReal';
import { useNowTick } from '@nucleo/hooks/useNowTick';
import { ERP_NAMES } from '@nucleo/constants/erp';
import { conCorridaNueva, resumenDeSincronizacion, ultimaPorSala, veEstadoDeDatos } from '@nucleo/utils/estadoDeSincronizacion';
import { colorSistema } from './Formulario';
import { MARCA } from './inicio/marca';
import Vidrio from './Vidrio';

const COLOR = { bien: MARCA.verde, atrasada: MARCA.ambar, caida: MARCA.rojo };

export default function EstadoDeDatos({ margen = 16 }) {
  const { hasPermission } = useAuth();
  const ve = veEstadoDeDatos(hasPermission);
  const [salas, setSalas] = useState([]);
  const leer = useCallback(async () => {
    const { data } = await fetchInventorySyncLogRecent();
    if (data) setSalas(ultimaPorSala(data));
  }, []);
  useEffect(() => {
    if (!ve) return undefined;
    leer();
    const reloj = setInterval(leer, 90_000);
    const cerrar = escucharCambios('app-estado-de-datos', [{ tabla: 'inventory_sync_log', evento: 'INSERT' }],
      ({ new: fila }) => setSalas((prev) => conCorridaNueva(prev, fila)));
    return () => { clearInterval(reloj); cerrar(); };
  }, [ve, leer]);
  const ahora = useNowTick();
  if (!ve) return null;

  const r = resumenDeSincronizacion(salas, ahora);
  const titulo = !salas.length ? 'Cargando…' : r.todoBien ? 'Al día' : r.conErrores ? 'Con errores' : 'Atrasado';
  const colorTitulo = !salas.length ? colorSistema.texto2 : r.todoBien ? MARCA.verde : MARCA.rojo;
  const puedeAbrir = hasPermission('sync_health', 'can_view');
  const caidas = r.salas.filter((s) => s.nivel !== 'bien');

  return (
    <Pressable disabled={!puedeAbrir} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push('/actualizacion-de-datos'); }}
      style={({ pressed }) => ({ marginHorizontal: margen, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={22} interactivo={puedeAbrir}>
        <View style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 }}>Datos</Text>
            <Text style={{ color: colorTitulo, fontSize: 14, fontWeight: '700' }}>{titulo}</Text>
            {r.minutosDesdeLaUltima != null ? (
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{`· hace ${r.minutosDesdeLaUltima === 0 ? '<1' : r.minutosDesdeLaUltima} min`}</Text>
            ) : null}
            {puedeAbrir ? <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '300' }}>›</Text> : null}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {r.salas.map((s) => (
              <View key={s.erp_sucursal_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLOR[s.nivel] }} />
                <Text style={{ color: colorSistema.texto, fontSize: 13 }}>{ERP_NAMES[s.erp_sucursal_id] ?? `Sala ${s.erp_sucursal_id}`}</Text>
              </View>
            ))}
          </View>
          {caidas.map((s) => (
            <Text key={`e-${s.erp_sucursal_id}`} style={{ color: COLOR[s.nivel], fontSize: 12 }} numberOfLines={2}>
              {`${ERP_NAMES[s.erp_sucursal_id] ?? `Sala ${s.erp_sucursal_id}`}: hace ${Math.round(s.minutos)} min${!s.success ? ' · la última falló' : ''}`}
            </Text>
          ))}
        </View>
      </Vidrio>
    </Pressable>
  );
}
