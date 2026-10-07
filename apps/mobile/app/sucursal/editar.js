// Editar la ficha de una sucursal, NATIVO — las cuatro secciones del portal
// (`FormSucursal`): horarios, legal, inmueble y servicios. La sección llega en
// `?seccion=` desde la ficha.
//
// Las reglas son del núcleo (`edicionDeSucursal`): el horario, el fin del
// contrato, quién puede ser regente. Y el guardado es el del portal,
// `updateBranch`, con la sucursal COMPLETA y los cambios encima — con sólo los
// cambios, el nombre y los teléfonos se escribirían en blanco.
//
// Los documentos (PDF de licencias, contratos, solvencias) se ven pero no se
// suben desde acá: `updateBranch` los versiona como `File` del navegador.
import { useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, KeyboardAvoidingView, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { WEEK_DAYS } from '@nucleo/data/constants';
import {
  OPCIONES_DE_EXTINTOR, SERVICIOS_BASICOS, candidatosLegales, cambiarDiaDelHorario, copiarDiaAnterior,
  diaDePago, diaDelHorario, esAlquilada, finDeContrato, horarioIncompleto, limpiarAjustes, limpiarHorario,
  sucursalConCambios,
} from '@nucleo/utils/edicionDeSucursal';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import Hora from '../../componentes/personas/Hora';
import Segmentos from '../../componentes/Segmentos';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo } from '../../componentes/Progreso';

const SECCIONES = [
  { id: 'horarios', label: 'Horarios' }, { id: 'legal', label: 'Legal' },
  { id: 'inmueble', label: 'Inmueble' }, { id: 'servicios', label: 'Servicios' },
];

function Rotulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{texto}</Text>;
}

function Interruptor({ titulo, detalle, valor, onCambiar, primero }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador, paddingTop: primero ? 0 : 10 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{titulo}</Text>
        {detalle ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{detalle}</Text> : null}
      </View>
      <Switch value={!!valor} onValueChange={onCambiar} />
    </View>
  );
}

// Un renglón «rótulo · valor ›» que abre un selector.
function Elegir({ rotulo, valor, onPress, primero }) {
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => {}); onPress(); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 10, opacity: pressed ? 0.6 : 1,
        borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador })}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{rotulo}</Text>
      <Text style={{ flexShrink: 1, color: colorSistema.acento, fontSize: 16, textAlign: 'right' }}>{valor}</Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}

function FechaFila({ rotulo, valor, onCambiar, primero }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: 10,
      borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador, paddingTop: primero ? 0 : 6 }}>
      <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 16 }}>{rotulo}</Text>
      <Fecha valor={valor || ''} onCambiar={onCambiar} />
    </View>
  );
}

const hojaDeOpciones = (titulo, opciones, onElegir) => ActionSheetIOS.showActionSheetWithOptions(
  { title: titulo, options: [...opciones.map((o) => o.label), 'Cancelar'], cancelButtonIndex: opciones.length },
  (i) => { if (i < opciones.length) onElegir(opciones[i].value); },
);

export default function EditarSucursal() {
  const { id, seccion: seccionInicial } = useLocalSearchParams();
  const branches = useStaffStore((s) => s.branches);
  const employees = useStaffStore((s) => s.employees);
  const updateBranch = useStaffStore((s) => s.updateBranch);
  const branch = useMemo(() => (branches || []).find((b) => String(b.id) === String(id)) ?? null, [branches, id]);

  const [seccion, setSeccion] = useState(SECCIONES.some((x) => x.id === seccionInicial) ? seccionInicial : 'horarios');
  const [ajustes, setAjustes] = useState(() => limpiarAjustes(branch?.settings));
  const [horario, setHorario] = useState(() => limpiarHorario(branch?.weeklyHours || branch?.weekly_hours));
  const [alquilada, setAlquilada] = useState(() => esAlquilada(branch, limpiarAjustes(branch?.settings)));
  const [guardando, setGuardando] = useState(false);
  const candidatos = useMemo(() => candidatosLegales(employees), [employees]);

  if (!branch) return <View style={{ padding: 16 }}><Aviso tono="freno" texto="No se encontró la sucursal." /></View>;

  const legal = ajustes.legal || {};
  const rent = ajustes.rent || { contract: {} };
  const contrato = rent.contract || {};
  const services = ajustes.services || {};
  const inyecciones = !!legal.injections;

  const cambiar = (categoria, campo, valor) => setAjustes((a) => ({ ...a, [categoria]: { ...(a[categoria] || {}), [campo]: valor } }));
  const cambiarServicio = (srv, campo, valor) => setAjustes((a) => ({
    ...a, services: { ...(a.services || {}), [srv]: { ...((a.services || {})[srv] || {}), [campo]: valor } },
  }));
  const cambiarContrato = (campo, valor) => setAjustes((a) => {
    const c = { ...((a.rent || {}).contract || {}), [campo]: valor };
    if (campo === 'startDate' || campo === 'termMonths') c.endDate = finDeContrato(c.startDate, c.termMonths);
    return { ...a, rent: { ...(a.rent || {}), contract: c } };
  });
  const nombre = (empId) => {
    const e = (employees || []).find((x) => String(x.id) === String(empId));
    return e ? shortEmployeeName(e) : 'Elegir';
  };
  const elegirPersona = (titulo, lista, campo) => hojaDeOpciones(titulo,
    [{ value: null, label: 'Nadie' }, ...lista.map((e) => ({ value: e.id, label: shortEmployeeName(e) }))],
    (v) => cambiar('legal', campo, v));

  const guardar = () => {
    if (seccion === 'horarios' && horarioIncompleto(horario)) {
      Alert.alert('Faltan horas', 'Hay días marcados como abiertos sin hora de apertura o de cierre.');
      return;
    }
    Alert.alert('Guardar la sucursal', `Se guardan los cambios de «${branch.name}».`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Guardar', onPress: async () => {
        setGuardando(true);
        try {
          const datos = sucursalConCambios(branch, {
            ajustes, horario,
            tipoDeInmueble: alquilada !== esAlquilada(branch, limpiarAjustes(branch.settings)) ? (alquilada ? 'RENTED' : 'OWNED') : undefined,
          });
          await updateBranch(branch.id, datos);
          listo('Sucursal guardada', '');
          router.back();
        } catch (e) {
          fallo('No se pudo guardar', mensajeAmigable(e, 'Intenta de nuevo.'));
        } finally {
          setGuardando(false);
        }
      } },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: branch.name, headerLargeTitle: false }} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 60 }}
          contentInsetAdjustmentBehavior="automatic" keyboardDismissMode="interactive">
          <Segmentos activa={seccion} onCambiar={setSeccion} opciones={SECCIONES} margen={0} />

          {seccion === 'horarios' ? (
            <Seccion titulo="Horario de atención" pie="Los días abiertos necesitan apertura y cierre.">
              {WEEK_DAYS.map((d, i) => {
                const dia = diaDelHorario(horario, d.id);
                const incompleto = dia.isOpen && (!dia.start || !dia.end);
                return (
                  <View key={d.id} style={{ gap: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, paddingTop: i ? 10 : 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '600' }}>{d.name}</Text>
                        <Text style={{ color: incompleto ? MARCA.rojo : colorSistema.texto2, fontSize: 13 }}>
                          {!dia.isOpen ? 'Cerrada' : incompleto ? 'Falta la hora' : `${hora12(dia.start)} – ${hora12(dia.end)}`}
                        </Text>
                      </View>
                      {i > 0 && dia.isOpen ? (
                        <Pressable hitSlop={6} onPress={() => { Haptics.selectionAsync().catch(() => {}); setHorario((h) => copiarDiaAnterior(h, i)); }}>
                          <Text style={{ color: MARCA.azulClaro, fontSize: 14, fontWeight: '600' }}>{`Igual que ${WEEK_DAYS[i - 1].name.toLowerCase()}`}</Text>
                        </Pressable>
                      ) : null}
                      <Switch value={dia.isOpen} onValueChange={(v) => setHorario((h) => cambiarDiaDelHorario(h, d.id, v ? { isOpen: true, start: '07:00', end: '19:00' } : { isOpen: false }))} />
                    </View>
                    {dia.isOpen ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Abre</Text>
                        <Hora valor={dia.start || '07:00'} onCambiar={(v) => setHorario((h) => cambiarDiaDelHorario(h, d.id, { start: v, isOpen: true }))} />
                        <Text style={{ color: colorSistema.texto2, fontSize: 14 }}>Cierra</Text>
                        <Hora valor={dia.end || '19:00'} onCambiar={(v) => setHorario((h) => cambiarDiaDelHorario(h, d.id, { end: v, isOpen: true }))} />
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </Seccion>
          ) : null}

          {seccion === 'legal' ? (
            <>
              <Seccion titulo="Licencia de funcionamiento">
                <Rotulo texto="Número de licencia (CSSP / DNM)" />
                <Campo multiline={false} value={legal.srsPermit || ''} onChangeText={(v) => cambiar('legal', 'srsPermit', v)} placeholder="Ej. 1234" />
                <FechaFila rotulo="Vence" valor={legal.srsExpiration} onCambiar={(v) => cambiar('legal', 'srsExpiration', v)} />
              </Seccion>
              <Seccion titulo="Regencia" pie="Asignar a alguien la mueve a esta sucursal, igual que en el portal.">
                <Elegir primero rotulo="Regente" valor={legal.regentEmployeeId ? nombre(legal.regentEmployeeId) : 'Elegir'}
                  onPress={() => elegirPersona('Regente', candidatos.regentes, 'regentEmployeeId')} />
                <FechaFila rotulo="Vence la credencial" valor={legal.regentCredentialExp} onCambiar={(v) => cambiar('legal', 'regentCredentialExp', v)} />
              </Seccion>
              <Seccion titulo="Farmacovigilancia">
                <Elegir primero rotulo="Referente" valor={legal.pharmacovigilanceEmployeeId ? nombre(legal.pharmacovigilanceEmployeeId) : 'Elegir'}
                  onPress={() => elegirPersona('Farmacovigilancia', candidatos.farmacovigilancia, 'pharmacovigilanceEmployeeId')} />
                <FechaFila rotulo="Vence la designación" valor={legal.pharmacovigilanceExp} onCambiar={(v) => cambiar('legal', 'pharmacovigilanceExp', v)} />
              </Seccion>
              <Seccion>
                <Interruptor primero titulo="Aplica inyecciones" detalle="Exige el permiso del área y el manejo de desechos." valor={inyecciones}
                  onCambiar={(v) => cambiar('legal', 'injections', v)} />
                <Interruptor titulo="Libros controlados" valor={legal.controlledBooks} onCambiar={(v) => cambiar('legal', 'controlledBooks', v)} />
                {legal.controlledBooks ? (
                  <>
                    <Rotulo texto="Resolución de los libros" />
                    <Campo multiline={false} value={legal.controlledBooksRes || ''} onChangeText={(v) => cambiar('legal', 'controlledBooksRes', v)} />
                  </>
                ) : null}
              </Seccion>
            </>
          ) : null}

          {seccion === 'inmueble' ? (
            <>
              <Seccion titulo="Inmueble">
                <Interruptor primero titulo="Local alquilado" detalle={alquilada ? 'Alquilado' : 'Propio'} valor={alquilada} onCambiar={setAlquilada} />
                {alquilada ? (
                  <>
                    <Rotulo texto="Arrendante" />
                    <Campo multiline={false} value={rent.landlordName || ''} onChangeText={(v) => cambiar('rent', 'landlordName', v)} />
                    <Rotulo texto="Teléfono del arrendante" />
                    <Campo multiline={false} keyboardType="phone-pad" value={rent.landlordPhone || ''} onChangeText={(v) => cambiar('rent', 'landlordPhone', v)} />
                    <Rotulo texto="Canon mensual ($)" />
                    <Campo multiline={false} keyboardType="decimal-pad" value={rent.amount != null ? String(rent.amount) : ''} onChangeText={(v) => cambiar('rent', 'amount', v)} />
                    <FechaFila rotulo="Inicio del contrato" valor={contrato.startDate} onCambiar={(v) => cambiarContrato('startDate', v)} />
                    <Rotulo texto="Plazo (meses)" />
                    <Campo multiline={false} keyboardType="number-pad" value={contrato.termMonths ? String(contrato.termMonths) : ''} onChangeText={(v) => cambiarContrato('termMonths', v.replace(/\D/g, ''))} />
                    <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                      {contrato.endDate ? `Vence el ${fechaTexto(contrato.endDate, { day: 'numeric', month: 'long', year: 'numeric' })}` : 'El vencimiento sale del inicio y el plazo.'}
                    </Text>
                  </>
                ) : null}
              </Seccion>
              <Seccion titulo="Solvencia municipal">
                <Rotulo texto="Cuenta municipal" />
                <Campo multiline={false} value={legal.municipalAccount || ''} onChangeText={(v) => cambiar('legal', 'municipalAccount', v)} />
                <FechaFila rotulo="Vence" valor={legal.municipalExpiration} onCambiar={(v) => cambiar('legal', 'municipalExpiration', v)} />
              </Seccion>
              <Seccion titulo="Desechos bioinfecciosos" pie={inyecciones ? 'Obligatorio: la sala aplica inyecciones.' : null}>
                <Interruptor primero titulo="Contrato de desechos" valor={inyecciones || legal.wasteManagement}
                  onCambiar={(v) => { if (!inyecciones) cambiar('legal', 'wasteManagement', v); }} />
                {inyecciones || legal.wasteManagement ? (
                  <FechaFila rotulo="Vence" valor={legal.wasteExpiration} onCambiar={(v) => cambiar('legal', 'wasteExpiration', v)} />
                ) : null}
              </Seccion>
              <Seccion titulo="Extintores">
                <Rotulo texto="Cantidad" />
                <Campo multiline={false} keyboardType="number-pad" value={legal.extinguisherCount != null ? String(legal.extinguisherCount) : ''} onChangeText={(v) => cambiar('legal', 'extinguisherCount', v.replace(/\D/g, ''))} />
                <Elegir rotulo="Tipo" valor={OPCIONES_DE_EXTINTOR.find((o) => o.value === legal.extinguisherType)?.label ?? 'Elegir'}
                  onPress={() => hojaDeOpciones('Tipo de extintor', OPCIONES_DE_EXTINTOR, (v) => cambiar('legal', 'extinguisherType', v))} />
                <FechaFila rotulo="Vence la recarga" valor={legal.extinguisherExpiration} onCambiar={(v) => cambiar('legal', 'extinguisherExpiration', v)} />
              </Seccion>
              <Seccion titulo="Fumigación">
                <Rotulo texto="Empresa" />
                <Campo multiline={false} value={legal.pestControlCompany || ''} onChangeText={(v) => cambiar('legal', 'pestControlCompany', v)} />
                <FechaFila rotulo="Última fumigación" valor={legal.lastFumigationDate} onCambiar={(v) => cambiar('legal', 'lastFumigationDate', v)} />
              </Seccion>
            </>
          ) : null}

          {seccion === 'servicios' ? SERVICIOS_BASICOS.map((srv) => {
            const s = services[srv.id] || {};
            return (
              <Seccion key={srv.id} titulo={srv.label}>
                <Rotulo texto="Proveedor" />
                <Campo multiline={false} value={s.provider || ''} onChangeText={(v) => cambiarServicio(srv.id, 'provider', v)} placeholder={srv.placeholder} />
                <Rotulo texto={srv.accountLabel} />
                <Campo multiline={false} value={s.account || ''} onChangeText={(v) => cambiarServicio(srv.id, 'account', v)} />
                <Rotulo texto="Día de pago (1 a 31)" />
                <Campo multiline={false} keyboardType="number-pad" value={s.dueDay ? String(s.dueDay) : ''} onChangeText={(v) => cambiarServicio(srv.id, 'dueDay', diaDePago(v))} />
                <FechaFila rotulo="Pagado hasta" valor={s.paidThrough ? `${String(s.paidThrough).slice(0, 7)}-01` : ''}
                  onCambiar={(v) => cambiarServicio(srv.id, 'paidThrough', String(v).slice(0, 7))} />
              </Seccion>
            );
          }) : null}

          <Aviso texto="Los documentos (licencias, contratos, solvencias) se suben desde el portal." />
          <BotonGrande texto={guardando ? 'Guardando…' : 'Guardar'} onPress={guardar} deshabilitado={guardando} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
