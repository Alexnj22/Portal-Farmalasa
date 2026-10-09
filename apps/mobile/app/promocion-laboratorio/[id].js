// Crear o editar una promoción por LABORATORIO, NATIVO —
// `PromocionLaboratorioModal`: nombre, mes, laboratorios, los niveles con su
// monto (iguales para todas las salas) y, por SALA, el umbral de venta de cada
// nivel; quién paga y la nota. Un bloque por sala, igual que el portal: una
// tabla salas × niveles no entra en un teléfono.
//
// La validación (los umbrales de cada sala tienen que SUBIR con el nivel), el
// armado de lo que se manda, quitar un nivel y copiar umbrales salen del
// núcleo (`promocionesUtils`), los mismos del portal. El alta guarda borrador
// como el portal; al editar, lo guardado ES el borrador.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, KeyboardAvoidingView, ScrollView, Text, TextInput, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  crearPromocionLaboratorio, editarPromocionLaboratorio, fetchLaboratorios, fetchPromocionLaboratorio, fetchProveedoresDelSistema,
} from '@nucleo/data/promociones';
import { useStaffStore } from '@nucleo/store/staffStore';
import { SALAS_VENTA } from '@nucleo/utils/metasUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import {
  copiarUmbralesDeSala, mesesRecientes, nivelesIniciales, numeroEscrito,
  payloadDePromocionLaboratorio, problemasDePromocionLaboratorio, quitarNivelDePromocion,
} from '@nucleo/utils/promocionesUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import { MARCA } from '../../componentes/inicio/marca';
import { Icono } from '../../componentes/promociones/Piezas';
import { fallo, listo } from '../../componentes/Progreso';
import Tocable from '../../componentes/Tocable';

const BORRADOR = 'promocion_laboratorio';
const PAGA = [{ id: '', label: 'Todavía no se sabe' }, { id: 'empresa', label: 'La empresa' }, { id: 'proveedor', label: 'Un proveedor' }];

function Fila({ titulo, valor, onPress }) {
  return (
    <Tocable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{titulo}</Text>
      <Text style={{ color: colorSistema.acento, fontSize: 16 }}>{valor}</Text>
    </Tocable>
  );
}

function Monto({ valor, onCambiar, placeholder }) {
  return (
    <TextInput value={valor} onChangeText={onCambiar} keyboardType="decimal-pad" placeholder={placeholder} placeholderTextColor={colorSistema.placeholder}
      style={{ minWidth: 92, minHeight: 40, paddingHorizontal: 10, borderRadius: 10, backgroundColor: 'rgba(127,127,127,0.14)', color: colorSistema.texto, fontSize: 16, textAlign: 'right' }} />
  );
}

/** Un buscador corto sobre un catálogo: sólo pinta coincidencias al escribir. */
function Buscador({ catalogo, excluir, onElegir, placeholder }) {
  const [q, setQ] = useState('');
  const hallados = useMemo(() => (q.trim()
    ? catalogo.filter((x) => !excluir.has(String(x.id)) && tokenMatch(q, x.nombre)).slice(0, 12) : []), [catalogo, excluir, q]);
  return (
    <View style={{ gap: 4 }}>
      <Campo multiline={false} value={q} onChangeText={setQ} placeholder={placeholder} />
      {hallados.map((x) => (
        <Tocable key={x.id} onPress={() => { Haptics.selectionAsync().catch(() => {}); onElegir(x); setQ(''); }}
          style={({ pressed }) => ({ paddingVertical: 8, opacity: pressed ? 0.6 : 1 })}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 15 }}>{`+ ${x.nombre}`}</Text>
        </Tocable>
      ))}
    </View>
  );
}

export default function PromocionLaboratorio() {
  const { id } = useLocalSearchParams();
  const editando = id && id !== 'nueva';
  const branches = useStaffStore((s) => s.branches);
  const salas = useMemo(() => SALAS_VENTA.map((sid) => (branches || []).find((b) => Number(b.id) === sid)).filter(Boolean), [branches]);
  const meses = useMemo(() => mesesRecientes(), []);
  const [nombre, setNombre] = useState('');
  const [mes, setMes] = useState(() => meses[0]?.value || '');
  const [labs, setLabs] = useState([]);
  const [niveles, setNiveles] = useState(() => nivelesIniciales());
  const [umbrales, setUmbrales] = useState({});
  const [paga, setPaga] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [nota, setNota] = useState('');
  const [catalogo, setCatalogo] = useState([]);
  const [proveedores, setProveedores] = useState([]);
  const [cargando, setCargando] = useState(!!editando);
  const [guardando, setGuardando] = useState(false);
  const repuesto = useRef(false);

  useEffect(() => {
    fetchLaboratorios().then(setCatalogo).catch(() => setCatalogo([]));
    fetchProveedoresDelSistema().then((xs) => setProveedores(xs.map((p) => ({ id: p.value, nombre: p.label })))).catch(() => setProveedores([]));
  }, []);

  useEffect(() => {
    if (!editando) return undefined;
    let vivo = true;
    fetchPromocionLaboratorio(id)
      .then((p) => {
        if (!vivo || !p) return;
        setNombre(p.nombre || '');
        setMes(p.year_month || '');
        setLabs(Array.isArray(p.laboratorios) ? p.laboratorios : []);
        setNiveles((p.niveles || []).map((n) => ({ nivel: Number(n.nivel), monto: String(n.monto ?? '') })));
        setUmbrales(Object.fromEntries((p.umbrales || []).map((u) => [`${u.branch_id}:${u.nivel}`, String(u.umbral ?? '')])));
        setPaga(p.paga || '');
        setSupplierId(p.supplier_id == null ? '' : String(p.supplier_id));
        setNota(p.nota || '');
      })
      .catch((e) => { if (vivo) fallo('No se pudo cargar la promoción', mensajeAmigable(e, 'Intenta de nuevo.')); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [editando, id]);

  // Alta: reponer el borrador una vez, preguntando.
  useEffect(() => {
    if (editando || repuesto.current) return;
    repuesto.current = true;
    const b = loadDraft(BORRADOR);
    if (!b || !(b.nombre || b.labs?.length)) return;
    Alert.alert('Promoción sin terminar', `Tienes «${b.nombre || 'sin nombre'}» a medio armar.`, [
      { text: 'Empezar de nuevo', style: 'destructive', onPress: () => clearDraft(BORRADOR) },
      { text: 'Seguirla', onPress: () => {
        setNombre(b.nombre || ''); if (b.mes) setMes(b.mes);
        setLabs(Array.isArray(b.labs) ? b.labs : []);
        setNiveles(Array.isArray(b.niveles) && b.niveles.length ? b.niveles : nivelesIniciales());
        setUmbrales(b.umbrales || {}); setPaga(b.paga || ''); setSupplierId(b.supplierId || ''); setNota(b.nota || '');
      } },
    ]);
  }, [editando]);
  useEffect(() => {
    if (editando || !(nombre || labs.length)) return;
    saveDraft(BORRADOR, { nombre, mes, labs, niveles, umbrales, paga, supplierId, nota });
  }, [editando, nombre, mes, labs, niveles, umbrales, paga, supplierId, nota]);

  const problemas = useMemo(
    () => problemasDePromocionLaboratorio({ nombre, mes, labs, niveles, umbrales, salas, paga, supplierId }),
    [nombre, mes, labs, niveles, umbrales, salas, paga, supplierId],
  );
  const labIds = useMemo(() => new Set(labs.map((l) => String(l.id))), [labs]);
  const proveedor = proveedores.find((p) => String(p.id) === String(supplierId));
  const elegirDe = (titulo, opciones, onElegir) => {
    const textos = [...opciones.map((o) => o.label), 'Cancelar'];
    ActionSheetIOS.showActionSheetWithOptions({ title: titulo, options: textos, cancelButtonIndex: textos.length - 1 }, (i) => {
      if (i < opciones.length) onElegir(opciones[i].value ?? opciones[i].id);
    });
  };
  const setNivel = (nivel, monto) => setNiveles((ns) => ns.map((n) => (n.nivel === nivel ? { ...n, monto } : n)));
  const setUmbral = (branchId, nivel, v) => setUmbrales((u) => ({ ...u, [`${branchId}:${nivel}`]: v }));
  const quitarNivel = (nivel) => { const r = quitarNivelDePromocion(niveles, umbrales, nivel); setNiveles(r.niveles); setUmbrales(r.umbrales); };
  const salaTiene = (sid) => niveles.some((n) => numeroEscrito(umbrales[`${sid}:${n.nivel}`]) > 0);
  const hayVacias = salas.some((s) => !salaTiene(s.id));

  const guardar = async () => {
    if (problemas.length) { Alert.alert('Falta algo', problemas.join('\n')); return; }
    setGuardando(true);
    try {
      const payload = payloadDePromocionLaboratorio({ nombre, labs, niveles, umbrales, paga, supplierId, nota });
      if (editando) await editarPromocionLaboratorio({ id, ...payload });
      else { await crearPromocionLaboratorio({ mes, ...payload }); clearDraft(BORRADOR); }
      listo(editando ? 'Promoción actualizada' : 'Promoción creada', payload.nombre);
      router.back();
    } catch (e) {
      fallo('No se pudo guardar la promoción', mensajeAmigable(e, 'Intenta de nuevo.'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: editando ? 'Editar promoción' : 'Por laboratorio', headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {cargando ? <ActivityIndicator style={{ marginTop: 32 }} /> : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
            <Seccion titulo="La promoción">
              <Campo multiline={false} value={nombre} onChangeText={setNombre} maxLength={120} placeholder="Nombre" />
              {editando
                ? <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>{`Mes: ${meses.find((m) => m.value === mes)?.label ?? mes} (no se cambia al editar)`}</Text>
                : <Fila titulo="Mes" valor={meses.find((m) => m.value === mes)?.label ?? 'Elegir'} onPress={() => elegirDe('Mes', meses, setMes)} />}
            </Seccion>

            <Seccion titulo={`Laboratorios · ${labs.length}`}>
              {labs.map((l) => (
                <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 36 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{l.nombre}</Text>
                  <Tocable hitSlop={8} onPress={() => setLabs((xs) => xs.filter((x) => Number(x.id) !== Number(l.id)))}>
                    <Icono nombre="X" color={MARCA.rojo} tamano={16} />
                  </Tocable>
                </View>
              ))}
              <Buscador catalogo={catalogo} excluir={labIds} placeholder="Agregar un laboratorio…" onElegir={(l) => setLabs((xs) => [...xs, l])} />
            </Seccion>

            <Seccion titulo="Niveles" pie="El monto de cada nivel es el mismo para todas las salas; lo que cambia por sala es la venta que hay que alcanzar.">
              {niveles.map((n) => (
                <View key={n.nivel} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{`Nivel ${n.nivel}`}</Text>
                  <Monto valor={n.monto} onCambiar={(v) => setNivel(n.nivel, v)} placeholder="$ monto" />
                  {niveles.length > 1 ? <Tocable hitSlop={8} onPress={() => quitarNivel(n.nivel)}><Icono nombre="Trash2" color={MARCA.rojo} tamano={16} /></Tocable> : null}
                </View>
              ))}
              <Tocable onPress={() => setNiveles((ns) => [...ns, { nivel: (ns.at(-1)?.nivel || 0) + 1, monto: '' }])} hitSlop={6}>
                <Text style={{ color: MARCA.azulClaro, fontSize: 15, fontWeight: '600' }}>+ Agregar nivel</Text>
              </Tocable>
            </Seccion>

            {salas.map((s) => (
              <Seccion key={s.id} titulo={`${s.name} · venta para cada nivel`}>
                {niveles.map((n) => (
                  <View key={n.nivel} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ flex: 1, color: colorSistema.texto2, fontSize: 15 }}>{`Nivel ${n.nivel}`}</Text>
                    <Monto valor={umbrales[`${s.id}:${n.nivel}`] ?? ''} onCambiar={(v) => setUmbral(s.id, n.nivel, v)} placeholder="$ venta" />
                  </View>
                ))}
                {salaTiene(s.id) && hayVacias ? (
                  <Tocable hitSlop={6} onPress={() => { Haptics.selectionAsync().catch(() => {}); setUmbrales((u) => copiarUmbralesDeSala(u, salas, niveles, s.id)); }}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>Copiar a las salas vacías</Text>
                  </Tocable>
                ) : null}
              </Seccion>
            ))}

            <Seccion titulo="Quién paga">
              <Fila titulo="Paga" valor={PAGA.find((p) => p.id === paga)?.label ?? '—'}
                onPress={() => elegirDe('Quién paga', PAGA, (v) => { setPaga(v); if (v !== 'proveedor') setSupplierId(''); })} />
              {paga === 'proveedor' ? (
                proveedor
                  ? <Fila titulo="Proveedor" valor={proveedor.nombre} onPress={() => setSupplierId('')} />
                  : <Buscador catalogo={proveedores} excluir={new Set()} placeholder="Buscar el proveedor…" onElegir={(p) => setSupplierId(String(p.id))} />
              ) : null}
            </Seccion>

            <Seccion titulo="Nota (opcional)">
              <Campo value={nota} onChangeText={setNota} maxLength={500} style={{ minHeight: 70 }} />
            </Seccion>

            {problemas.length ? <Aviso tono="cuidado" texto={problemas.join('\n')} /> : null}
            <BotonGrande texto={guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear promoción'} onPress={guardar} deshabilitado={guardando || problemas.length > 0} />
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </>
  );
}
