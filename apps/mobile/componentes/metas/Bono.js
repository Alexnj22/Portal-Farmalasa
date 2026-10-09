// El bono de una sala en un mes, NATIVO — `TabBono` del portal, de LECTURA:
// cuánto es el bono de la sala, cuánto va a la jefatura y cuánto al equipo, lo
// que no cobra nadie, y por persona lo vendido, su parte de la sala, el bono de
// hoy y el de «si cierra así». El reparto lo calcula la base
// (`get_bono_meta_sala`); acá no se recalcula nada.
//
// Encender, apagar y la vigencia de las bonificaciones (Este mes / Indefinido),
// con `metas` editar, con la MISMA llamada del portal (`setBonificaciones`). Es
// un interruptor de toda la red: cada cambio pide confirmación.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Switch, Text, View } from 'react-native';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchBonoMetaSala, setBonificaciones } from '@nucleo/data/metas';
import { TRAMO_CFG, ymHoySV, ymLabel } from '@nucleo/utils/metasUtils';
import { formatMoney, formatPct } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { Aviso } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import Avatar from '../Avatar';
import Vidrio from '../Vidrio';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { COLOR_TRAMO } from './Mes';
import { fallo, listo, trabajando } from '../Progreso';

export default function Bono({ sala, salaNombre, ym, esMesActual, config, canEdit = false, onCambioBono }) {
  const empleados = useStaffStore((s) => s.employees);
  const porId = useMemo(() => new Map((empleados || []).map((e) => [String(e.id), e])), [empleados]);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const cargar = useCallback(async () => {
    try { setData(await fetchBonoMetaSala(sala, ym)); setError(null); }
    catch (e) { setError(mensajeAmigable(e, 'Error al cargar el bono')); setData(null); }
  }, [sala, ym]);
  useEffect(() => { setData(null); cargar(); }, [cargar]);

  const personas = data?.personas ?? [];
  const sinMeta = data != null && data.meta == null;
  const metaSinAprobar = data?.meta != null && data.estado_meta && data.estado_meta !== 'oficial';
  const hayProyeccion = Number(data?.bolsa_proyectada ?? 0) > 0;
  const hayReparto = Number(data?.bolsa ?? 0) > 0 || hayProyeccion;
  const perdido = Number(data?.no_pagado ?? 0);
  const activas = !!config?.bonificaciones_activas;
  const hasta = config?.bonificaciones_hasta_ym;
  const nombre = salaNombre(sala);
  const mes = ymLabel(ym).toLowerCase();
  const mesActual = ymLabel(ymHoySV()).toLowerCase();
  const [guardando, setGuardando] = useState(false);

  // Hasta cuándo valen: con «Este mes» la vigencia queda en el mes en curso y
  // el bono se apaga solo al cambiar de mes (lo único que entiende el servidor).
  const cambiarBono = (on, esteMes) => Alert.alert(
    on ? (activas ? 'Cambiar la vigencia' : 'Activar las bonificaciones') : 'Apagar las bonificaciones',
    on ? (esteMes ? `Valen sólo por ${mesActual}: el día 1 se apagan solas. Es para toda la red.` : 'Sin fecha de fin: siguen activas hasta que se apaguen. Es para toda la red.')
      : 'Las pantallas vuelven a hablar solo de la meta, en toda la red.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: on ? 'Confirmar' : 'Apagar', style: on ? 'default' : 'destructive', onPress: async () => {
        setGuardando(true); trabajando('Guardando…');
        try {
          await setBonificaciones(on, esteMes);
          listo(on ? 'Bonificaciones activadas' : 'Bonificaciones apagadas', on ? (esteMes ? `Sólo por ${mesActual}.` : 'Sin fecha de fin.') : 'Las pantallas vuelven a hablar solo de la meta.');
          onCambioBono?.();
        } catch (e) { fallo('No se pudo cambiar', mensajeAmigable(e, 'Vuelve a intentarlo.')); }
        setGuardando(false);
      } },
    ]);

  return (
    <View style={{ gap: 10 }}>
      <View style={{ marginHorizontal: 16 }}>
        <Vidrio radio={18}>
          <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: activas ? MARCA.verde : colorSistema.separador }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{activas ? 'Bonificaciones activas' : 'Bonificaciones apagadas'}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                {activas ? (hasta ? `Este mes: sólo por ${ymLabel(hasta).toLowerCase()}, el día 1 se apagan solas.` : 'Indefinido: siguen activas hasta que se apaguen.')
                  : 'Las pantallas hablan de la meta y no nombran el bono.'}
              </Text>
            </View>
            {canEdit ? <Switch value={activas} disabled={guardando} onValueChange={(on) => cambiarBono(on, on ? !!hasta : false)} /> : null}
          </View>
          {canEdit && activas ? (
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 12 }}>
              {[{ id: 'mes', label: 'Este mes' }, { id: 'siempre', label: 'Indefinido' }].map((o) => {
                const on = (o.id === 'mes') === !!hasta;
                return (
                  <Pressable key={o.id} disabled={guardando || on} onPress={() => cambiarBono(true, o.id === 'mes')}
                    style={{ paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: 999, backgroundColor: on ? MARCA.azul : 'rgba(127,127,127,0.18)' }}>
                    <Text style={{ color: on ? '#fff' : colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </Vidrio>
      </View>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {data == null && !error ? <ActivityIndicator style={{ marginTop: 16 }} /> : null}
      {data ? (
        <>
          <FilaDeKpis>
            <Kpi icono="HandCoins" rotulo="Bono de la sala" valor={data.bolsa > 0 ? formatMoney(data.bolsa) : '—'} color={MARCA.azul}
              apoyo={data.tasa_pct > 0 ? `${formatPct(data.tasa_pct, { decimales: 2 })} de lo vendido` : sinMeta ? 'sin meta este mes' : hayProyeccion ? `${formatMoney(data.bolsa_proyectada)} si cierra así` : 'no alcanzó el 95%'} />
            <Kpi icono="Medal" rotulo="Jefatura" valor={data.bolsa > 0 ? formatMoney(data.bolsa_jefatura) : '—'} color={MARCA.violeta} apoyo="un cuarto del bono" />
          </FilaDeKpis>
          <FilaDeKpis>
            <Kpi icono="Users" rotulo="Equipo" valor={data.bolsa > 0 ? formatMoney(data.bolsa_equipo) : '—'} color={MARCA.verde} apoyo="tres cuartos, por venta" />
            <Kpi icono="UserX" rotulo="Sin repartir" valor={perdido > 0 ? formatMoney(perdido) : '—'} color={MARCA.ambar} apoyo={perdido > 0 ? 'no lo cobra nadie' : 'todo tiene dueño'} />
          </FilaDeKpis>
          {data.pct != null ? (
            <View style={{ marginHorizontal: 16, flexDirection: 'row' }}>
              <Pildora texto={`${formatPct(data.pct)} de la meta`} color={COLOR_TRAMO[data.tramo] ?? colorSistema.texto2} />
            </View>
          ) : null}
          <View style={{ marginHorizontal: 16, gap: 8 }}>
            {metaSinAprobar ? <Aviso tono="cuidado" texto={`La meta de ${nombre} en ${mes} todavía no está aprobada: este reparto es una referencia y cambia si cambia el monto.`} /> : null}
            {esMesActual && hayProyeccion ? (
              <Aviso tono="nota" texto={`Si ${nombre} sigue a este ritmo cierra en ${formatMoney(data.proyeccion)} — ${formatPct(data.pct_proyectado)} de la meta, y el bono de la sala sería ${formatMoney(data.bolsa_proyectada)}.${data.tramo_proyectado === 'medio' ? ` Llegando al 100% se duplica: le faltan ${formatMoney(Math.max(0, data.meta - data.proyeccion))}.` : ''}`} />
            ) : null}
            {sinMeta ? <Aviso tono="nota" texto={`${nombre} no tiene meta en ${mes}: el bono se calcula sobre el cumplimiento, así que sin meta no hay reparto.`} /> : null}
            {!sinMeta && !hayReparto ? (
              <Aviso tono="nota" texto={esMesActual
                ? `El bono todavía no se gana: ${nombre} va en ${formatPct(data.pct)} de la meta y, al ritmo de hoy, cerraría en ${formatPct(data.pct_proyectado)}. Desde el 95% se gana la mitad y desde el 100%, completo.`
                : `La sala no alcanzó el bono: cerró en ${formatPct(data.pct)} de la meta.`} />
            ) : null}
          </View>
          {hayReparto ? personas.map((p) => {
            const persona = porId.get(String(p.employee_id)) ?? { id: p.employee_id, name: p.nombre };
            return (
              <View key={p.employee_id} style={{ marginHorizontal: 16 }}>
                <Vidrio radio={18}>
                  <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Avatar empleado={persona} tamano={38} />
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{shortEmployeeName(persona)}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${formatMoney(p.venta)} · ${formatPct(p.pct_venta)} de la sala`}</Text>
                      {p.es_jefe || p.en_prueba ? (
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          {p.es_jefe ? <Pildora texto="Jefatura" color={MARCA.violeta} /> : null}
                          {p.en_prueba ? <Pildora texto="En prueba" color={MARCA.ambar} /> : null}
                        </View>
                      ) : null}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(p.bono)}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 11 }}>bono hoy</Text>
                      {hayProyeccion ? <Text style={{ color: MARCA.azulClaro, fontSize: 12, fontWeight: '700' }}>{`${formatMoney(p.bono_proyectado)} si cierra así`}</Text> : null}
                    </View>
                  </View>
                </Vidrio>
              </View>
            );
          }) : null}
          {data && TRAMO_CFG[data.tramo] && hayReparto ? (
            <Text style={{ color: colorSistema.texto2, fontSize: 12, marginHorizontal: 20 }}>
              Un cuarto del bono va a la jefatura y el resto se reparte en el equipo según lo que vendió cada persona.
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
