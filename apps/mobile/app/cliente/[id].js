// La ficha de un cliente, NATIVA — `FormClienteDetail.jsx` del portal: los
// datos fiscales y de contacto (editables con permiso) y su actividad
// (facturas, cuánto, primera y última compra, últimas facturas y los cambios).
//
// Las reglas son las del núcleo: `validarCliente` (formato sólo de lo que
// cambió; requeridos según la categoría), la cascada departamento → municipio
// → distrito (`normalizarGeo`) y `cambiosDeFicha` (sólo viaja lo que cambió).
// Guardar es `update_customer_fiscal`; si toca datos que se declaran a
// Hacienda, el sistema pide confirmarlo. Después se aplica en el sistema de la
// caja (`pushClienteAlErp`) sin hacer esperar: si no entra, queda en cola.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { codigoDeError, fetchCustomerDetail, mensajeDeError, motivoSinAplicar, pushClienteAlErp, updateCustomerFiscal } from '@nucleo/data/customers';
import { DEPARTAMENTOS, conciliarGeo, distritosDe, municipiosDe, normalizarGeo } from '@nucleo/data/elSalvadorGeo';
import { CAMPOS_FICHA, CATEGORIAS_CLIENTE, ETIQUETA_CAMPO, cambiosDeFicha, camposRequeridos, validarCliente } from '@nucleo/utils/clienteValidacion';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { fechaTexto } from '@nucleo/utils/fecha';
import { clearDraft, loadDraft, saveDraft } from '@nucleo/utils/draftUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Segmentos from '../../componentes/Segmentos';
import Avatar from '../../componentes/Avatar';
import Vidrio from '../../componentes/Vidrio';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';

const corta = (f) => (f ? fechaTexto(String(f).slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const TECLADO = { dui: 'number-pad', nit: 'number-pad', nrc: 'number-pad', phone: 'phone-pad', telefono2: 'phone-pad', retencion_pct: 'number-pad', email: 'email-address' };

// Elegir de una lista con la hoja del sistema (o una alerta en Android).
function elegir(titulo, opciones, alElegir) {
  if (Platform.OS !== 'web') {
    ActionSheetIOS.showActionSheetWithOptions({ title: titulo, options: [...opciones, 'Cancelar'], cancelButtonIndex: opciones.length },
      (i) => { if (i < opciones.length) alElegir(opciones[i]); });
  } else {
    Alert.alert(titulo, null, [...opciones.slice(0, 8).map((o) => ({ text: o, onPress: () => alElegir(o) })), { text: 'Cancelar', style: 'cancel' }]);
  }
}

function Linea({ campo, valor, onCambiar, editable, error, requerido, opciones, multilinea }) {
  const rotulo = `${ETIQUETA_CAMPO[campo] ?? campo}${requerido ? ' *' : ''}`;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: error ? MARCA.rojo : colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 }}>{rotulo}</Text>
      {!editable ? (
        <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{valor || '—'}</Text>
      ) : opciones ? (
        <Pressable onPress={() => elegir(ETIQUETA_CAMPO[campo], opciones, onCambiar)}
          style={({ pressed }) => ({ minHeight: 44, borderRadius: 12, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: 'rgba(127,127,127,0.16)', opacity: pressed ? 0.7 : 1 })}>
          <Text style={{ color: valor ? colorSistema.texto : colorSistema.texto2, fontSize: 16 }}>{valor || 'Elegir'}</Text>
        </Pressable>
      ) : (
        <Campo multiline={!!multilinea} value={String(valor ?? '')} onChangeText={onCambiar} keyboardType={TECLADO[campo]}
          autoCapitalize={campo === 'email' ? 'none' : campo === 'name' ? 'characters' : 'sentences'} autoCorrect={false}
          style={error ? { borderWidth: 1.5, borderColor: MARCA.rojo } : null} />
      )}
      {error ? <Text style={{ color: MARCA.rojo, fontSize: 12 }}>{error}</Text> : null}
    </View>
  );
}

export default function FichaCliente() {
  const { id } = useLocalSearchParams();
  const { hasPermission } = useAuth();
  const puedeEditar = hasPermission('clientes', 'can_edit');
  const verMontos = hasPermission('clientes_ver_montos');
  const clave = `cliente_app_${id}`;
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [panel, setPanel] = useState('ficha');
  const [intento, setIntento] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const r = await fetchCustomerDetail(id);
      const cliente = r.cliente ? { ...r.cliente, ...conciliarGeo(r.cliente) } : null;
      setD({ ...r, cliente });
      const base = Object.fromEntries(CAMPOS_FICHA.map((c) => [c, cliente?.[c] ?? '']));
      const b = loadDraft(clave);
      setForm(b ? { ...base, ...b } : base);
    } catch (e) {
      setD({ error: mensajeDeError(e) });
    }
  }, [id, clave]);
  useEffect(() => { cargar(); }, [cargar]);

  const cliente = d?.cliente;
  const editable = puedeEditar && cliente && !cliente.mostrador;
  const cambios = useMemo(() => cambiosDeFicha(form, cliente), [form, cliente]);
  const hay = Object.keys(cambios).length > 0;
  useEffect(() => { if (form && cliente) { if (hay) saveDraft(clave, form); else clearDraft(clave); } }, [form, cliente, hay, clave]);
  const v = useMemo(() => validarCliente(form, cliente), [form, cliente]);
  const req = useMemo(() => new Set(camposRequeridos(form?.categoria)), [form?.categoria]);
  const errorDe = (c) => v.errores[c] || ((intento || hay) && v.faltan.includes(c) ? 'Requerido para facturar' : undefined);
  const set = (c) => (valor) => setForm((f) => ({ ...f, [c]: valor }));
  const setGeo = (parcial) => setForm((f) => ({ ...f, ...normalizarGeo({ ...f, ...parcial }) }));

  const guardar = async (confirmando = false) => {
    setIntento(true);
    if (!v.ok) { fallo('Falta completar la ficha', [...Object.entries(v.errores).map(([c, m]) => `${ETIQUETA_CAMPO[c]}: ${m}`), ...v.faltan.map((c) => `${ETIQUETA_CAMPO[c]}: requerido`)].join('\n')); return; }
    setGuardando(true); trabajando('Guardando la ficha…');
    try {
      await updateCustomerFiscal(id, cambios, { confirmarFiscal: confirmando }, { desde: 'app' });
      clearDraft(clave);
      setIntento(false);
      await cargar();
      const r = await pushClienteAlErp(id);
      if (r?.empujado) listo('Cambio aplicado', `Se actualizó la ficha ${r.erp_id ?? ''}`.trim());
      else fallo('Guardado, falta aplicarlo', motivoSinAplicar(r));
      await cargar();
    } catch (e) {
      if (codigoDeError(e) === 'REQUIERE_CONFIRMACION_FISCAL') {
        Alert.alert('Son datos que se declaran a Hacienda', 'Confirma que el cambio es correcto.', [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Confirmar', onPress: () => guardar(true) },
        ]);
      } else fallo('No se pudo guardar', mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  };

  if (!d) return <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Cliente' }} />;
  if (d.error || !cliente) {
    return (<><Stack.Screen options={{ ...BARRA_NATIVA, title: 'Cliente' }} /><View style={{ padding: 16, paddingTop: 120 }}><Aviso tono="freno" texto={d.error || 'Esa ficha ya no existe.'} /></View></>);
  }

  const act = d.actividad ?? {};
  const campo = (c, extra = {}) => (
    <Linea campo={c} valor={form?.[c]} onCambiar={set(c)} editable={editable} error={errorDe(c)} requerido={req.has(c)} {...extra} />
  );

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: '' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? undefined : 'height'}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
          contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive">
          <Vidrio radio={24}>
            <View style={{ padding: 18, alignItems: 'center', gap: 8 }}>
              <Avatar empleado={{ name: cliente.name }} tamano={64} />
              <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>{cliente.name}</Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                <Pildora texto={cliente.categoria || 'Sin categoría'} color={MARCA.azulClaro} />
                {cliente.erp_id ? <Pildora texto={`Código ${cliente.erp_id}`} color={colorSistema.texto2} /> : null}
                {cliente.mostrador ? <Pildora texto="Mostrador" color={MARCA.ambar} /> : null}
              </View>
              {verMontos ? (
                <Text style={{ color: MARCA.verde, fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(act.total ?? 0)}</Text>
              ) : null}
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${act.facturas ?? 0} facturas · última ${corta(act.ultima_fecha)}`}</Text>
            </View>
          </Vidrio>

          {cliente.mostrador ? <Aviso tono="nota" texto="Es un cliente genérico del mostrador, no una persona: no lleva ficha fiscal." /> : null}
          {cliente.nombre_corrupto ? <Aviso tono="cuidado" texto="El nombre llegó dañado. Corrígelo con el que aparece en el documento." /> : null}

          <Segmentos margen={0} activa={panel} onCambiar={setPanel} opciones={[{ id: 'ficha', label: 'Ficha' }, { id: 'actividad', label: 'Actividad' }]} />

          {panel === 'ficha' ? (
            <>
              <Seccion titulo="Identificación">
                {campo('name')}
                {campo('categoria', { opciones: CATEGORIAS_CLIENTE })}
                {campo('dui')}
                {campo('nit')}
                {campo('nrc')}
                {campo('pasaporte')}
                {campo('giro')}
                {campo('retencion_pct')}
              </Seccion>
              <Seccion titulo="Contacto">
                {campo('phone')}
                {campo('telefono2')}
                {campo('email')}
              </Seccion>
              <Seccion titulo="Ubicación">
                <Linea campo="departamento" valor={form?.departamento} editable={editable} error={errorDe('departamento')} requerido opciones={DEPARTAMENTOS}
                  onCambiar={(x) => setGeo({ departamento: x, municipio: '', distrito: '' })} />
                <Linea campo="municipio" valor={form?.municipio} editable={editable && !!form?.departamento} error={errorDe('municipio')} requerido
                  opciones={municipiosDe(form?.departamento)} onCambiar={(x) => setGeo({ municipio: x, distrito: '' })} />
                <Linea campo="distrito" valor={form?.distrito} editable={editable && !!form?.municipio} error={errorDe('distrito')} requerido
                  opciones={[...new Set([...distritosDe(form?.municipio), ...(cliente.distrito && !distritosDe(form?.municipio).includes(cliente.distrito) ? [cliente.distrito] : [])])]}
                  onCambiar={(x) => setGeo({ distrito: x })} />
                {campo('direccion', { multilinea: true })}
              </Seccion>
              <Seccion titulo="Notas">
                {campo('notes', { multilinea: true })}
                {cliente.fecha_nacimiento ? <Dato primero rotulo="Nacimiento" valor={corta(cliente.fecha_nacimiento)} /> : null}
              </Seccion>
              {editable && hay ? (
                <>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>{`Cambian: ${Object.keys(cambios).map((c) => ETIQUETA_CAMPO[c] ?? c).join(', ')}`}</Text>
                  <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar la ficha'} color={MARCA.azul} deshabilitado={guardando} onPress={() => guardar(false)} />
                  <BotonGrande texto="Descartar los cambios" borde color={MARCA.rojo} onPress={() => { clearDraft(clave); setIntento(false); setForm(Object.fromEntries(CAMPOS_FICHA.map((c) => [c, cliente?.[c] ?? '']))); }} />
                </>
              ) : null}
            </>
          ) : (
            <>
              <Seccion titulo="Resumen">
                <Dato primero rotulo="Facturas" valor={(act.facturas ?? 0).toLocaleString('es-SV')} />
                {verMontos ? <Dato rotulo="Facturado" valor={formatMoney(act.total ?? 0)} fuerte /> : null}
                <Dato rotulo="Crédito fiscal" valor={(act.facturas_ccf ?? 0).toLocaleString('es-SV')} />
                <Dato rotulo="Anuladas" valor={(act.facturas_anuladas ?? 0).toLocaleString('es-SV')} />
                <Dato rotulo="Primera compra" valor={corta(act.primera_fecha)} />
                <Dato rotulo="Última compra" valor={corta(act.ultima_fecha)} />
              </Seccion>
              <Seccion titulo="Últimas facturas">
                {(d.facturas ?? []).length ? d.facturas.map((f, i) => (
                  <View key={f.id ?? i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colorSistema.texto, fontSize: 14 }}>{`${f.tipo_documento ?? ''} · ${f.sucursal ?? ''}`}</Text>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{corta(f.fecha)}{f.estado && f.estado !== 'FINALIZADA' ? ` · ${f.estado}` : ''}</Text>
                    </View>
                    {verMontos ? <Text style={{ color: colorSistema.texto, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(f.total ?? 0)}</Text> : null}
                  </View>
                )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Sin facturas registradas.</Text>}
              </Seccion>
              <Seccion titulo="Cambios en la ficha">
                {(d.bitacora ?? []).length ? d.bitacora.map((h, i) => (
                  <View key={i} style={{ gap: 2, paddingVertical: 6, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 14, fontWeight: '600' }}>{ETIQUETA_CAMPO[h.campo] || h.campo}</Text>
                      {h.descartado_at ? <Pildora texto="Descartado: ya había otro valor" color={colorSistema.texto2} /> : !h.erp_synced_at ? <Pildora texto="Sin aplicar" color={MARCA.ambar} /> : null}
                    </View>
                    {/* Qué había y qué quedó, como el portal. */}
                    <Text style={{ fontSize: 13 }}>
                      <Text style={{ color: colorSistema.texto2, textDecorationLine: 'line-through' }}>{h.valor_anterior || '(vacío)'}</Text>
                      <Text style={{ color: colorSistema.texto2 }}>{'  →  '}</Text>
                      <Text style={{ color: colorSistema.texto, fontWeight: '700' }}>{h.valor_nuevo || '(vacío)'}</Text>
                    </Text>
                    <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${corta(h.changed_at)}${h.changed_at ? `, ${hora12(h.changed_at) || ''}` : ''}${h.changed_by_nombre ? ` · ${h.changed_by_nombre}` : ''}`}</Text>
                  </View>
                )) : <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>La ficha no se ha editado desde el portal.</Text>}
              </Seccion>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
