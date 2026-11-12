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
import { Host, Icon } from '@expo/ui';
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
import { iconoDe } from '../tema/iconos';
import IconoFijo from './IconoFijo';

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
  const puedeAbrir = hasPermission('sync_health', 'can_view');
  const caidas = r.salas.filter((s) => s.nivel !== 'bien');

  const color = !salas.length ? colorSistema.texto2 : r.todoBien ? MARCA.verde : r.conErrores ? MARCA.rojo : MARCA.ambar;
  const icono = !salas.length ? 'RefreshCw' : r.todoBien ? 'CheckCircle2' : 'AlertTriangle';
  const nombreDe = (s) => ERP_NAMES[s.erp_sucursal_id] ?? `Sala ${s.erp_sucursal_id}`;
  const cuando = r.minutosDesdeLaUltima == null ? null : r.minutosDesdeLaUltima === 0 ? 'hace un momento' : `hace ${r.minutosDesdeLaUltima} min`;
  const rotulo = !salas.length ? 'Revisando los datos…' : r.todoBien ? 'Datos al día' : `${caidas.length} sala${caidas.length === 1 ? '' : 's'} con atraso`;
  const apoyo = !salas.length ? null : r.todoBien ? `${[`${r.salas.length} salas`, cuando].filter(Boolean).join(' · ')}` : (cuando ? `Última actualización ${cuando}` : null);

  // Al día es UNA línea, como un renglón más del menú; el detalle por sala sólo
  // aparece cuando hay algo que atender.
  return (
    <Pressable disabled={!puedeAbrir} onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push('/actualizacion-de-datos'); }}
      accessibilityRole={puedeAbrir ? 'button' : undefined}
      style={({ pressed }) => ({ marginHorizontal: margen, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Vidrio radio={20} interactivo={puedeAbrir}>
        <View style={{ paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 34 }}>
            <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
              <IconoFijo name={iconoDe(icono)} size={17} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 17 }} numberOfLines={1}>{rotulo}</Text>
              {apoyo ? <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }} numberOfLines={1}>{apoyo}</Text> : null}
            </View>
            {puedeAbrir ? <Text style={{ color: colorSistema.texto2, fontSize: 20, fontWeight: '300' }}>›</Text> : null}
          </View>
          {caidas.map((s) => (
            <View key={s.erp_sucursal_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 42 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLOR[s.nivel] }} />
              <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14 }} numberOfLines={1}>{nombreDe(s)}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
                {`hace ${Math.round(s.minutos)} min${!s.success ? ' · falló' : ''}`}
              </Text>
            </View>
          ))}
        </View>
      </Vidrio>
    </Pressable>
  );
}
