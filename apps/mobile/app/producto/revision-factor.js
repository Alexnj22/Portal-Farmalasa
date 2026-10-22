// Revisión de factor, NATIVA — la pestaña «Revisión de factor» de Productos
// del portal (`TabRevisionFactor`, 2026-10-15). Comparte el permiso de
// Presentaciones (`productos_tab_presentaciones`).
//
// Cuando la caja cambia el tamaño de una presentación (CAJA 1x30 → 1x1), el
// portal ya convierte SOLO las ventas y el MIN·MAX. Lo que no puede hacer solo
// es la existencia: queda contada en la unidad vieja, y descartarla es una
// decisión. Tres listas en una llamada (`fetchRevisionDePresentaciones`):
//   · Existencia por corregir — lote por lote, con lo que quedaría y lo que se
//     descarta; «Corregir en la caja» crea la solicitud de descarte de siempre
//     (`pedirCorreccionDeExistencia`) y, si quien la pide aprueba inventario,
//     la aplica enseguida (`aplicarMovimientoInventarioEnErp`).
//   · Factor que no cuadra — se corrige en la ficha del producto de la caja.
//   · Cambios de presentación — lo que el portal convirtió solo.
// Los textos salen del núcleo (`causaDeCorreccion`, `textoDelSospechoso`,
// `minmaxDelCambio`): dicen lo mismo que el portal.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import {
  causaDeCorreccion, fetchRevisionDePresentaciones, minmaxDelCambio, pedirCorreccionDeExistencia, textoDelSospechoso,
} from '@nucleo/data/revisionFactor';
import { aplicarMovimientoInventarioEnErp } from '@nucleo/data/requests';
import { supervisorQueResuelve } from '@nucleo/utils/aprobadorOperativo';
import { nuevoUuid } from '@nucleo/utils/distribucionComercial';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';

const VACIO = { cambios: [], existencias: [], sospechosos: [] };

function Renglon({ primero, children }) {
  return <View style={{ gap: 5, paddingTop: primero ? 0 : 10, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>{children}</View>;
}

function FilaExistencia({ f, primero, puedeAplicar, onCorregir, ocupado }) {
  const sol = f.solicitud;
  return (
    <Renglon primero={primero}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{f.nombre}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {[f.sala, f.lote ? `lote ${f.lote}` : null, f.vence ? `vence ${fechaNumerica(f.vence)}` : null].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {sol ? <Pildora texto={sol.status === 'APPROVED' ? 'Corregida' : 'Pedida'} color={sol.status === 'APPROVED' ? MARCA.verde : MARCA.ambar} /> : null}
      </View>
      <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>
        <Text style={{ color: colorSistema.texto2 }}>{`1 ${f.presentacion} = ${formatQty(f.de)}`}</Text>
        {`  →  1 ${f.presentacion} = ${formatQty(f.a)}`}
      </Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
        {`Muestra ${formatQty(f.muestra)}, son ${formatQty(f.quedan)} · se descartan `}
        <Text style={{ color: MARCA.rojo, fontWeight: '700' }}>{formatQty(f.descartar)}</Text>
        {f.sueltas > 0 ? <Text style={{ color: MARCA.ambar }}>{` · sobran ${formatQty(f.sueltas)} unidades sueltas que no forman una ${String(f.presentacion).toLowerCase()}`}</Text> : null}
      </Text>
      {!sol ? (
        <BotonGrande texto={ocupado ? 'Trabajando…' : puedeAplicar ? 'Corregir en la caja' : 'Pedir la corrección'} color={MARCA.azul}
          deshabilitado={ocupado} onPress={() => onCorregir(f)} />
      ) : null}
    </Renglon>
  );
}

export default function RevisionDeFactor() {
  const { user, hasPermission } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const puedeAplicar = hasPermission('requests_inventario', 'can_approve');
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [ocupado, setOcupado] = useState(null);

  const cargar = useCallback(async () => {
    const { data, error: e } = await fetchRevisionDePresentaciones();
    setError(e ? mensajeAmigable(e) : null);
    setDatos(e ? VACIO : { ...VACIO, ...data });
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const corregir = async (f) => {
    setOcupado(f);
    trabajando(puedeAplicar ? 'Corrigiendo…' : 'Pidiendo la corrección…');
    try {
      const id = nuevoUuid();
      const { error: e } = await pedirCorreccionDeExistencia({ id, fila: f, usuarioId: user?.id, aprobador: supervisorQueResuelve(empleados) });
      if (e) throw e;
      if (!puedeAplicar) {
        listo('Corrección pedida', 'Quien aprueba inventario recibió el aviso. La existencia cambia al aprobarla.');
      } else {
        const r = await aplicarMovimientoInventarioEnErp(id, 'Corrección por cambio de presentación');
        if (!r?.ok) fallo('La corrección quedó pedida', `No se pudo aplicar todavía: ${r?.error ?? 'sin respuesta'}. Queda en Solicitudes para reintentar.`);
        else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          listo('Existencia corregida', `${f.nombre} en ${f.sala}: ${formatQty(f.muestra)} → ${formatQty(f.quedan)}.`);
        }
      }
      await cargar();
    } catch (e) {
      fallo('No se pudo corregir', mensajeAmigable(e));
    } finally {
      setOcupado(null);
    }
  };

  const confirmar = (f) => Alert.alert(`Corregir ${f.nombre}`, [
    `Qué pasó: la presentación cambió de tamaño: antes 1 ${f.presentacion} = ${formatQty(f.de)}, ahora 1 ${f.presentacion} = ${formatQty(f.a)}. La caja no convierte la existencia, así que en ${f.sala}${f.lote ? ` (lote ${f.lote})` : ''} quedó mostrando ${formatQty(f.muestra)}.`,
    `Qué se hace: se descartan ${formatQty(f.descartar)} y quedan ${formatQty(f.quedan)}.${f.sueltas > 0 ? ` Las ${formatQty(f.sueltas)} unidades sueltas no alcanzan para una ${String(f.presentacion).toLowerCase()} y también salen.` : ''}`,
    `Lo que queda escrito en el movimiento: «${causaDeCorreccion(f)}»`,
    puedeAplicar
      ? 'Se aplica en la caja enseguida. Si en la sala de verdad hay más, no corrijas: avisa para revisarlo.'
      : 'Se manda a quien aprueba inventario; la existencia cambia cuando la apruebe.',
  ].join('\n\n'), [
    { text: 'Cancelar', style: 'cancel' },
    { text: puedeAplicar ? 'Corregir ahora' : 'Pedir la corrección', onPress: () => corregir(f) },
  ]);

  const { cambios = [], existencias = [], sospechosos = [] } = datos ?? VACIO;
  const cuenta = (n) => (n ? ` · ${formatQty(n)}` : '');

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Revisión de factor' }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {error ? <Aviso tono="freno" texto={error} /> : null}
        {datos === null ? <ActivityIndicator style={{ marginTop: 40 }} /> : (
          <>
            <Seccion titulo={`Existencia por corregir${cuenta(existencias.length)}`}
              pie="La caja no convierte la existencia cuando cambia el tamaño de la presentación: queda contada en la unidad vieja.">
              {existencias.length ? existencias.map((f, i) => (
                <FilaExistencia key={`${f.cambio_id}-${f.erp_sucursal_id}-${f.lote}-${f.presentacion}`} f={f} primero={!i}
                  puedeAplicar={puedeAplicar} ocupado={!!ocupado} onCorregir={confirmar} />
              )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin existencia por corregir.</Text>}
            </Seccion>

            <Seccion titulo={`Factor que no cuadra${cuenta(sospechosos.length)}`}
              pie="Productos cuyo tamaño de presentación no coincide entre el catálogo, la existencia o las ventas recientes. Se corrigen en la ficha del producto de la caja; al corregirlo, el portal convierte lo demás solo.">
              {sospechosos.length ? sospechosos.map((s, i) => (
                <Renglon key={s.clave} primero={!i}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{s.nombre}</Text>
                    <Pildora texto={s.presentacion} color={MARCA.ambar} />
                  </View>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{textoDelSospechoso(s)}</Text>
                </Renglon>
              )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin factores que no cuadren.</Text>}
            </Seccion>

            <Seccion titulo={`Cambios de presentación${cuenta(cambios.length)}`} pie="Lo que cambió en los últimos 120 días y lo que el portal convirtió solo.">
              {cambios.length ? cambios.map((c, i) => {
                const r = c.resultado ?? {};
                const mm = minmaxDelCambio(r);
                return (
                  <Renglon key={c.id} primero={!i}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{c.nombre}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13, fontVariant: ['tabular-nums'] }}>{c.procesado_at ? fechaNumerica(c.procesado_at) : 'en proceso'}</Text>
                    </View>
                    {r.factor_antes != null ? (
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                        {`Antes ${formatQty(r.factor_antes)} por unidad de venta, ahora ${formatQty(r.factor_ahora)}. Se convirtieron ${formatQty(r.ventas_convertidas ?? 0)} ventas.`}
                      </Text>
                    ) : null}
                    {mm ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`MIN·MAX: ${mm}`}</Text> : null}
                    {(r.ventas_sin_convertir ?? 0) > 0 ? (
                      <Text style={{ color: MARCA.ambar, fontSize: 13, fontWeight: '600' }}>
                        {`${formatQty(r.ventas_sin_convertir)} ventas con otro tamaño de caja quedaron como estaban: revisar si es la misma caja.`}
                      </Text>
                    ) : null}
                  </Renglon>
                );
              }) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin cambios de presentación recientes.</Text>}
            </Seccion>
          </>
        )}
      </ScrollView>
    </>
  );
}
