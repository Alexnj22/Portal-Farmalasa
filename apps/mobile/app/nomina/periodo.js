// Abrir una quincena nueva, NATIVO — el «Nueva Quincena» del portal
// (`FormNewPayrollPeriod`). Propone la quincena que corre hoy
// (`quincenaPorDefecto`, núcleo) y muestra el rótulo con que va a quedar
// («Primera Quincena de octubre 2026»). Guarda con `createPayrollPeriod`, la
// misma función del portal, que deja la apertura en la bitácora.
import { volver } from '../../componentes/volver';
import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { router, Stack } from 'expo-router';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useAuth } from '@nucleo/context/AuthContext';
import { quincenaPorDefecto, rotuloDePeriodo } from '@nucleo/utils/planilla';
import { hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../../componentes/formulario/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import { fallo, listo } from '../../componentes/Progreso';

function Fila({ rotulo, valor, onCambiar, desde }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 16 }}>{rotulo}</Text>
      <Fecha valor={valor} onCambiar={onCambiar} desde={desde} />
    </View>
  );
}

export default function NuevoPeriodo() {
  // Llegando por un enlace también: sin permiso de editar la planilla, la base
  // rechaza el alta; se dice antes de llenar nada.
  const puedeEditar = !!useAuth().hasPermission?.('payroll', 'can_edit');
  const crear = useStaffStore((s) => s.createPayrollPeriod);
  const [f, setF] = useState(() => ({ ...quincenaPorDefecto(hoySV()), pay_date: '' }));
  const [guardando, setGuardando] = useState(false);
  const valido = f.start_date && f.end_date && f.end_date >= f.start_date;
  const nombre = valido ? rotuloDePeriodo(f.start_date, f.end_date) : '';

  const guardar = () => Alert.alert('Abrir quincena', `Se crea «${nombre}» en borrador. Después se genera la planilla.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Crear', onPress: async () => {
      setGuardando(true);
      try {
        await crear({ ...f, name: nombre, pay_date: f.pay_date || null, period_type: 'QUINCENA' });
        listo('Quincena creada', nombre);
        volver('/nomina');
      } catch (e) {
        fallo('No se pudo crear', mensajeAmigable(e, 'Intenta de nuevo.'));
      } finally { setGuardando(false); }
    } },
  ]);

  if (!puedeEditar) return <View style={{ padding: 20 }}><Aviso tono="cuidado" texto="Tu cargo no puede abrir quincenas." /></View>;
  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Nueva quincena', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        {nombre ? <Text style={{ color: colorSistema.texto, fontSize: 20, fontWeight: '800', marginHorizontal: 4 }}>{nombre}</Text> : null}
        <Seccion titulo="Período">
          <Fila rotulo="Inicio" valor={f.start_date} onCambiar={(v) => setF((x) => ({ ...x, start_date: v }))} />
          <Fila rotulo="Fin" valor={f.end_date} desde={f.start_date} onCambiar={(v) => setF((x) => ({ ...x, end_date: v }))} />
          {!valido ? <Aviso tono="cuidado" texto="El fin es anterior al inicio." /> : null}
        </Seccion>
        <Seccion titulo="Pago" pie="Opcional: la fecha en que se paga la quincena.">
          <Fila rotulo="Fecha de pago" valor={f.pay_date || f.end_date} desde={f.start_date} onCambiar={(v) => setF((x) => ({ ...x, pay_date: v }))} />
        </Seccion>
        <BotonGrande texto={guardando ? 'Creando…' : 'Crear quincena'} onPress={guardar} deshabilitado={!valido || guardando} />
      </ScrollView>
    </>
  );
}
