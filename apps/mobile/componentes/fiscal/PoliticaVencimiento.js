// Laboratorios · Política de vencimiento, NATIVO — `TabPoliticaVencimiento`
// del portal: cada laboratorio con los proveedores que lo traen, si son
// devolutivos y a cuántos meses, la viñeta y las notas. Tarjetas
// Laboratorios / Proveedores / Devolutivos arriba.
//
// Con `laboratorios` · editar: agregar, editar y eliminar un proveedor del
// laboratorio, y «Marcar como no devolutivo» todos sus productos — las mismas
// funciones del portal (`insertProveedor`, `updateProveedor`,
// `deleteProveedor`, `updateProductsMarkND`), con confirmación donde el portal
// la pide.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Switch, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  deleteProveedor, fetchLaboratoriosBasic, fetchProductCountByLabDevolutivo, fetchProveedores, insertProveedor, updateProductsMarkND, updateProveedor,
} from '@nucleo/data/laboratorios';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso, BotonGrande, Campo } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import Kpi, { FilaDeKpis } from '../inicio/Kpi';
import Vidrio from '../Vidrio';
import { MARCA } from '../inicio/marca';
import { fallo, listo } from '../Progreso';

const VACIO = { nombre: '', devolutivo: false, meses_devolucion: '', vineta: '', notas: '' };
const payloadDe = (d) => ({
  nombre: d.nombre.trim(), devolutivo: d.devolutivo,
  meses_devolucion: d.devolutivo ? parseInt(d.meses_devolucion, 10) : null,
  notas: d.notas.trim() || null, vineta: d.vineta !== '' ? parseFloat(d.vineta) : null,
});

function Editor({ inicial, onGuardar, onCancelar }) {
  const [d, setD] = useState(inicial);
  const ok = d.nombre.trim().length > 1 && (!d.devolutivo || Number(d.meses_devolucion) > 0);
  return (
    <View style={{ gap: 8, paddingTop: 8 }}>
      <Campo multiline={false} value={d.nombre} onChangeText={(v) => setD({ ...d, nombre: v })} placeholder="Proveedor" />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>Devolutivo</Text>
        <Switch value={d.devolutivo} onValueChange={(v) => setD({ ...d, devolutivo: v })} />
      </View>
      {d.devolutivo ? <Campo multiline={false} keyboardType="number-pad" value={String(d.meses_devolucion ?? '')} onChangeText={(v) => setD({ ...d, meses_devolucion: v })} placeholder="Meses antes del vencimiento" /> : null}
      <Campo multiline={false} keyboardType="decimal-pad" value={String(d.vineta ?? '')} onChangeText={(v) => setD({ ...d, vineta: v.replace(',', '.') })} placeholder="Viñeta (opcional)" />
      <Campo value={d.notas} onChangeText={(v) => setD({ ...d, notas: v })} placeholder="Notas (opcional)" />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><BotonGrande texto="Cancelar" borde color={colorSistema.texto2} onPress={onCancelar} /></View>
        <View style={{ flex: 1 }}><BotonGrande texto="Guardar" deshabilitado={!ok} onPress={() => onGuardar(d)} /></View>
      </View>
    </View>
  );
}

export default function PoliticaVencimiento({ texto, canEdit }) {
  const [labs, setLabs] = useState(null);
  const [provs, setProvs] = useState({});
  const [error, setError] = useState(null);
  const [abierto, setAbierto] = useState(null);
  const [editando, setEditando] = useState(null); // id de proveedor, o `nuevo-<lab>`

  const cargar = useCallback(async () => {
    const [l, p] = await Promise.all([fetchLaboratoriosBasic(), fetchProveedores()]);
    setError(l.error?.message || p.error?.message || null);
    const m = {};
    for (const x of p.data || []) (m[x.laboratorio_id] ||= []).push(x);
    setLabs(l.data || []); setProvs(m);
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(() => (labs || []).filter((l) => !texto?.trim() || tokenMatch(texto, l.nombre) || (provs[l.id] || []).some((p) => tokenMatch(texto, p.nombre))), [labs, provs, texto]);
  const totalProv = Object.values(provs).reduce((s, a) => s + a.length, 0);
  const totalDev = Object.values(provs).reduce((s, a) => s + a.filter((p) => p.devolutivo).length, 0);

  const crear = async (lab, d) => {
    const { error: e } = await insertProveedor({ laboratorio_id: lab.id, ...payloadDe(d) }, { laboratorio: lab.nombre, desde: 'app' });
    if (e) { fallo('No se guardó', mensajeAmigable(e)); return; }
    listo('Proveedor agregado', lab.nombre); setEditando(null); cargar();
  };
  const actualizar = async (p, d) => {
    const { error: e } = await updateProveedor(p.id, { ...payloadDe(d), updated_at: new Date().toISOString() });
    if (e) { fallo('No se guardó', mensajeAmigable(e)); return; }
    listo('Proveedor actualizado', ''); setEditando(null); cargar();
  };
  const eliminar = (p) => Alert.alert('Eliminar proveedor', `«${p.nombre}» deja de figurar en la política de este laboratorio.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Eliminar', style: 'destructive', onPress: async () => {
      const { error: e } = await deleteProveedor(p.id, { proveedor: p.nombre, desde: 'app' });
      if (e) { fallo('No se eliminó', mensajeAmigable(e)); return; }
      listo('Proveedor eliminado', ''); cargar();
    } },
  ]);
  const marcarND = async (lab) => {
    const { count, error: e } = await fetchProductCountByLabDevolutivo(lab.id);
    if (e) { fallo('No se pudo', mensajeAmigable(e)); return; }
    if (!count) { listo('Sin cambios', `Todos los productos de «${lab.nombre}» ya están marcados ND.`); return; }
    Alert.alert('Marcar como no devolutivo', `${count} producto${count === 1 ? '' : 's'} de «${lab.nombre}» quedan como ND (no devolutivos).`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Marcar', style: 'destructive', onPress: async () => {
        const { data, error: e2 } = await updateProductsMarkND(lab.id, { laboratorio: lab.nombre, desde: 'app' });
        if (e2) { fallo('No se pudo', mensajeAmigable(e2)); return; }
        listo('Marcado', `${data?.length ?? count} productos marcados como ND.`);
      } },
    ]);
  };

  if (!labs) return <ActivityIndicator style={{ marginTop: 24 }} />;
  return (
    <View style={{ gap: 10 }}>
      <FilaDeKpis>
        <Kpi icono="FlaskConical" rotulo="Laboratorios" valor={String(labs.length)} color={MARCA.azulClaro} apoyo={`${totalProv} proveedores`} />
        <Kpi icono="RefreshCw" rotulo="Devolutivos" valor={String(totalDev)} color={MARCA.ambar} apoyo="proveedores que reciben vencidos" />
      </FilaDeKpis>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {visibles.map((lab) => {
        const lista = provs[lab.id] || [];
        const open = abierto === lab.id;
        return (
          <View key={lab.id} style={{ marginHorizontal: 16 }}>
            <Vidrio radio={18}>
              <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); setAbierto(open ? null : lab.id); setEditando(null); }} style={{ padding: 12, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '700' }}>{lab.nombre}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${lista.length} prov.  ${open ? '▴' : '▾'}`}</Text>
                </View>
                {!open && lista.length ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {lista.map((p) => <Pildora key={p.id} texto={p.devolutivo ? `${p.nombre} · ${p.meses_devolucion ?? '?'} m` : p.nombre} color={p.devolutivo ? MARCA.verde : colorSistema.texto2} />)}
                  </View>
                ) : null}
              </Pressable>
              {open ? (
                <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}>
                  {lista.map((p) => (editando === p.id ? (
                    <Editor key={p.id} inicial={{ nombre: p.nombre, devolutivo: !!p.devolutivo, meses_devolucion: p.meses_devolucion ?? '', vineta: p.vineta ?? '', notas: p.notas ?? '' }}
                      onGuardar={(d) => actualizar(p, d)} onCancelar={() => setEditando(null)} />
                  ) : (
                    <View key={p.id} style={{ borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 8, gap: 3 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{p.nombre}</Text>
                        <Pildora texto={p.devolutivo ? `Devolutivo · ${p.meses_devolucion ?? '?'} meses` : 'No devolutivo'} color={p.devolutivo ? MARCA.verde : colorSistema.texto2} />
                      </View>
                      {p.vineta != null ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Viñeta ${formatMoney(p.vineta)}`}</Text> : null}
                      {p.notas ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{p.notas}</Text> : null}
                      {canEdit ? (
                        <View style={{ flexDirection: 'row', gap: 16 }}>
                          <Pressable onPress={() => setEditando(p.id)} hitSlop={6}><Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '700' }}>Editar</Text></Pressable>
                          <Pressable onPress={() => eliminar(p)} hitSlop={6}><Text style={{ color: MARCA.rojo, fontSize: 14, fontWeight: '700' }}>Eliminar</Text></Pressable>
                        </View>
                      ) : null}
                    </View>
                  )))}
                  {!lista.length ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin proveedores registrados.</Text> : null}
                  {canEdit && editando === `nuevo-${lab.id}` ? <Editor inicial={VACIO} onGuardar={(d) => crear(lab, d)} onCancelar={() => setEditando(null)} /> : null}
                  {canEdit && editando !== `nuevo-${lab.id}` ? (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1 }}><BotonGrande texto="Agregar proveedor" borde color={MARCA.azulClaro} onPress={() => setEditando(`nuevo-${lab.id}`)} /></View>
                      <View style={{ flex: 1 }}><BotonGrande texto="Marcar ND" borde color={MARCA.ambar} onPress={() => marcarND(lab)} /></View>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </Vidrio>
          </View>
        );
      })}
      {!visibles.length ? <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '600', textAlign: 'center', marginTop: 24 }}>Sin resultados</Text> : null}
    </View>
  );
}
