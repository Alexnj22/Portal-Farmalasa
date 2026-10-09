// El seguimiento de una promoción, NATIVO — `TabSeguimiento` del portal.
//
//  · Por producto: las cuatro cifras (unidades, documentos, vendedores, bono
//    ganado — `resumenDeSeguimiento`, núcleo), cada producto con lo vendido
//    contra su lote y su barra, el bono que reparte (a vendedores, fondo de
//    administración, fondo de bodega), cómo va cada sala contra su cupo, y
//    «Quién vendió» agrupado por sala con la cara de cada persona
//    (`vendedoresPorSala`, núcleo: el bono «sin dueño» no suma).
//  · Por laboratorio: la matriz de las salas (`Matriz`).
//
// Arriba, lo que se puede hacer desde donde se la mira: volver a borrador /
// activar y duplicar, con las mismas funciones y confirmaciones del portal.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { fetchPromocion } from '@nucleo/data/promociones';
import {
  estadoVisible, fmtMoneda, fmtUnidades, fmtVigencia, mensajeDeCarga, MOTIVO_CIERRE, porLaboratorio,
  resumenDeSeguimiento, rotuloMes, rotuloPresentacion, vendedoresPorSala, csvVendedoresDePromocion,
} from '@nucleo/utils/promocionesUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Vidrio from '../../componentes/Vidrio';
import Avatar from '../../componentes/Avatar';
import Kpi, { FilaDeKpis } from '../../componentes/inicio/Kpi';
import { MARCA } from '../../componentes/inicio/marca';
import { colorDeVariante } from '../../componentes/colorDeVariante';
import { AvanceDelLote, Barra, BarrasPorSala, Icono, TresDatos } from '../../componentes/promociones/Piezas';
import Matriz from '../../componentes/promociones/Matriz';
import { compartirCsv } from '../../componentes/fiscal/csv';
import { fallo } from '../../componentes/Progreso';
import { alternarPromocion, duplicarConPreguntas } from '../../componentes/promociones/acciones';
import { promocionElegida } from '../../componentes/promociones/elegida';

const Titulo = ({ texto, sub }) => (
  <View style={{ marginHorizontal: 4, marginTop: 6 }}>
    <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>{texto}</Text>
    {sub ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{sub}</Text> : null}
  </View>
);

function Accion({ texto, icono, color = MARCA.azulClaro, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 14, borderRadius: 19,
      backgroundColor: `${color}26`, opacity: pressed ? 0.75 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <Icono nombre={icono} color={color} tamano={14} />
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{texto}</Text>
    </Pressable>
  );
}

function Renglon({ r }) {
  const pct = Number(r.pct) || 0;
  return (
    <Vidrio radio={18}>
      <View style={{ padding: 14, gap: 8 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{r.producto}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Pildora texto={rotuloPresentacion(r.factor_unidades)} color={r.factor_unidades == null ? colorSistema.texto2 : MARCA.azulClaro} />
          {!r.tiene_bono ? <Pildora texto="Sólo mide" color={colorSistema.texto2} /> : null}
          {r.estado === 'cerrado' ? <Pildora texto={`Terminado · ${MOTIVO_CIERRE[r.cerrado_motivo] || r.cerrado_motivo || ''}`} color={colorSistema.texto2} /> : null}
        </View>
        {r.tiene_bono && r.paga ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Lo paga ${r.paga === 'empresa' ? 'la empresa' : (r.proveedor || 'un proveedor sin nombre')}`}</Text> : null}
        <AvanceDelLote vendido={r.vendido_base} lote={r.lote_total} pct={pct} />
        {r.tiene_bono ? (
          <TresDatos datos={[
            { rotulo: 'A vendedores', valor: fmtMoneda(r.costo_vendedor), color: MARCA.azulClaro },
            { rotulo: 'Fondo admón.', valor: fmtMoneda(r.fondo_adm) },
            { rotulo: 'Fondo bodega', valor: fmtMoneda(r.fondo_bodega) },
          ]} />
        ) : null}
        <BarrasPorSala reparto={Array.isArray(r.reparto) ? r.reparto : []} />
      </View>
    </Vidrio>
  );
}

function SalaQueVendio({ g, conBono, personaDe }) {
  const mayor = Math.max(1, ...g.gente.map((v) => Number(v.unidades) || 0));
  return (
    <Vidrio radio={18}>
      <View style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: `${MARCA.azulClaro}26` }}>
            <Icono nombre="Home" color={MARCA.azulClaro} tamano={15} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>{g.sala}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${fmtUnidades(g.unidades)} ${g.unidades === 1 ? 'unidad' : 'unidades'} · ${g.gente.length} ${g.gente.length === 1 ? 'persona' : 'personas'}`}</Text>
          </View>
          {conBono ? <Text style={{ color: MARCA.azulClaro, fontSize: 16, fontWeight: '800' }}>{fmtMoneda(g.bono)}</Text> : null}
        </View>
        {g.gente.map((v, i) => {
          const u = Number(v.unidades) || 0;
          const emp = personaDe(v.cod_vendedor);
          return (
            <View key={`${v.cod_vendedor}-${i}`} style={{ gap: 5, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Avatar empleado={emp ?? { name: v.nombre }} tamano={30} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{shortEmployeeName(emp ?? v.nombre)}</Text>
                  {v.sin_dueno ? <Text style={{ color: MARCA.ambar, fontSize: 12, fontWeight: '600' }}>Sin dueño: este bono no se paga</Text> : null}
                </View>
                <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{fmtUnidades(u)}</Text>
                {conBono ? <Text style={{ width: 72, textAlign: 'right', color: v.sin_dueno ? colorSistema.texto2 : MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>{fmtMoneda(v.bono)}</Text> : null}
              </View>
              <Barra pct={(u / mayor) * 100} color={`${MARCA.azulClaro}B3`} alto={5} />
            </View>
          );
        })}
      </View>
    </Vidrio>
  );
}

export default function Promocion() {
  const { id, tipo } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('promociones', 'can_edit');
  const branches = useStaffStore((s) => s.branches);
  const employees = useStaffStore((s) => s.employees);
  const fila = promocionElegida(id);
  const esLab = (fila?.tipo || tipo) === 'laboratorio';
  const [detalle, setDetalle] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);
  const [vuelta, setVuelta] = useState(0);

  const cargar = useCallback(async () => {
    if (esLab) return;
    try { setDetalle(await fetchPromocion(id)); setError(null); }
    catch (e) { setError(mensajeDeCarga(e, 'No se pudo calcular el avance.')); }
  }, [id, esLab]);
  // Al volver (por ejemplo, de reactivarla) se relee el avance.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const porCodigo = useMemo(() => new Map((employees || []).map((e) => [String(e.code ?? ''), e])), [employees]);
  const personaDe = useCallback((cod) => (cod != null ? porCodigo.get(String(cod)) ?? null : null), [porCodigo]);
  const p = detalle ?? fila;
  const e = p ? estadoVisible(p) : null;
  const renglones = Array.isArray(detalle?.renglones) ? detalle.renglones : [];
  const grupos = useMemo(() => porLaboratorio(renglones), [renglones]);
  const salasVend = useMemo(() => vendedoresPorSala(Array.isArray(detalle?.vendedores) ? detalle.vendedores : []), [detalle]);
  const r = resumenDeSeguimiento(detalle);
  const tras = () => { setVuelta((n) => n + 1); cargar(); };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: esLab ? 'Promoción de laboratorio' : 'Seguimiento', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); setVuelta((n) => n + 1); await cargar(); setRecargando(false); }} />}>
        {p ? (
          <View style={{ gap: 6, marginHorizontal: 4 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800' }}>{p.nombre}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{esLab ? rotuloMes(p.year_month) : fmtVigencia(p.inicio, p.fin)}</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {e ? <Pildora texto={e.rotulo} color={colorDeVariante(e.variant)} /> : null}
              {Number(p.descuentos) > 0 ? <Pildora texto="Baja el precio" color={MARCA.azulClaro} /> : null}
            </View>
            {p.nota ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{p.nota}</Text> : null}
          </View>
        ) : null}
        {puedeEditar && fila ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {fila.estado !== 'finalizada' ? (
              <Accion texto={fila.estado === 'activa' ? 'Volver a borrador' : 'Activar'} icono={fila.estado === 'activa' ? 'Clock' : 'Check'}
                color={fila.estado === 'activa' ? MARCA.ambar : MARCA.verde}
                onPress={() => alternarPromocion(fila, () => { fila.estado = fila.estado === 'activa' ? 'borrador' : 'activa'; tras(); })} />
            ) : null}
            {fila.estado !== 'finalizada' ? (
              <Accion texto="Editar" icono="PenLine"
                onPress={() => router.push({ pathname: esLab ? '/promocion-laboratorio/[id]' : '/promocion-producto/[id]', params: { id: String(fila.id) } })} />
            ) : null}
            {/* Reactivar: sólo las de producto (la de laboratorio vive por MES: se duplica). */}
            {fila.estado === 'finalizada' && !esLab ? (
              <Accion texto="Reactivar" icono="RefreshCw" color={MARCA.verde}
                onPress={() => router.push({ pathname: '/promocion-reactivar/[id]', params: { id: String(fila.id) } })} />
            ) : null}
            <Accion texto="Duplicar" icono="ClipboardList" onPress={() => duplicarConPreguntas(fila, branches, null)} />
          </View>
        ) : null}

        {esLab ? <Matriz key={vuelta} promocionId={id} /> : (
          <>
            {error ? <Aviso tono="freno" texto={error} /> : null}
            {!detalle && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
            {detalle ? (
              <>
                <View style={{ marginHorizontal: -16, gap: 12 }}>
                  <FilaDeKpis>
                    <Kpi icono="Package" rotulo="Unidades vendidas" valor={fmtUnidades(r.unidades)} color={MARCA.azulClaro} apoyo={`${fmtUnidades(r.documentos)} documentos`} />
                    <Kpi icono="Wallet" rotulo="Bono ganado" valor={fmtMoneda(r.bono)} color={MARCA.violetaClaro} apoyo={`${r.vendedores} vendedor${r.vendedores === 1 ? '' : 'es'}`} />
                  </FilaDeKpis>
                </View>
                {grupos.map(({ laboratorio, items }) => (
                  <View key={laboratorio} style={{ gap: 10 }}>
                    <Titulo texto={`${laboratorio} · ${items.length}`} />
                    {items.map((x) => <Renglon key={x.id} r={x} />)}
                  </View>
                ))}
                <Titulo texto="Quién vendió" sub="unidades base, por sala" />
                {(detalle.vendedores || []).length ? (
                  <Pressable hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-end', minHeight: 32, justifyContent: 'center' }} onPress={() => {
                    const c = csvVendedoresDePromocion(detalle.vendedores, detalle.nombre);
                    compartirCsv({ ...c, modulo: 'promociones' }).catch((err) => fallo('No se pudo compartir', err?.message || ''));
                  }}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>Exportar CSV</Text>
                  </Pressable>
                ) : null}
                {salasVend.length ? salasVend.map((g) => <SalaQueVendio key={g.sala} g={g} conBono={r.conBono} personaDe={personaDe} />)
                  : <Aviso texto="Nadie ha vendido productos de esta promoción en su vigencia." />}
                {detalle.sin_dueno?.unidades > 0 ? (
                  <Aviso tono="cuidado" texto={`${fmtUnidades(detalle.sin_dueno.unidades)} unidades (${fmtMoneda(detalle.sin_dueno.monto)}) se vendieron con un código que no da con nadie activo. Ese bono no se paga y no se reparte entre los demás.`} />
                ) : null}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}
