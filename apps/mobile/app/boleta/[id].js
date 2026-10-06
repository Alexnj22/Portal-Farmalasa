// La boleta de pago de una persona, NATIVO — las mismas partidas y el mismo
// orden que el papel del portal (`partidasDeBoleta`, núcleo):
//   A · ingresos sujetos a retención (el salario ordinario, días × diario)
//   B · otros ingresos (las horas extra y nocturnas YA en dinero, con sus horas
//       al lado; asuetos, bonificaciones, bono vacacional, viáticos)
//   C · retenciones (ISSS y AFP con su base) y otros descuentos
//   líquido = (A − C) + B, también en letras.
// La fila guarda las horas como HORAS: pintarlas con `formatMoney` decía $3.00
// por tres horas extra, que es lo que hacía la versión anterior.
//
// «Compartir o imprimir» arma el MISMO papel que imprime el portal
// (`boletaDePapel`) y lo pasa a la hoja de compartir o a AirPrint. Es una
// salida de datos: se anota con `registrarEgreso`, como las del portal.
import { useState } from 'react';
import { ActionSheetIOS, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useStaffStore } from '@nucleo/store/staffStore';
import { montoEnLetras, partidasDeBoleta, rotuloDePeriodo } from '@nucleo/utils/planilla';
import { documentoDeBoletas } from '@nucleo/utils/boletaDePapel';
import { registrarEgreso } from '@nucleo/data/egreso';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Dato, Seccion } from '../../componentes/formulario/Piezas';
import { fallo } from '../../componentes/Progreso';
import { compartirPdf, imprimirPapel } from '../../componentes/pdf';
import Avatar from '../../componentes/Avatar';
import Vidrio from '../../componentes/Vidrio';

export default function Boleta() {
  const { id } = useLocalSearchParams();
  const e = useStaffStore((s) => (s.payrollEntries || []).find((x) => String(x.id) === String(id)));
  const periodo = useStaffStore((s) => (s.payrollPeriods || []).find((p) => String(p.id) === String(e?.period_id)));
  const branches = useStaffStore((s) => s.branches);
  // El sueldo se lee de la ficha VIVA y no de la copia pegada a la fila: la
  // fila se arma al cargar la quincena, y si eso pasó antes de que el arranque
  // trajera los salarios (entrar directo a Nómina), la copia quedó sin sueldo
  // y la boleta convertía las horas extra a $0.
  const ficha = useStaffStore((s) => (s.employees || []).find((x) => String(x.id) === String(e?.employee_id)));
  const [armando, setArmando] = useState(false);
  if (!e) return <Aviso tono="freno" texto="No se encontró la boleta." />;
  const empleado = { ...(e.employee || {}), ...(ficha || {}) };
  const p = partidasDeBoleta(e, empleado.base_salary);
  const ultimaEdicion = (e.edit_history || []).at(-1);

  const filas = (lista) => lista.map((x, i) => (
    <Dato key={x.rotulo} primero={i === 0} rotulo={x.horas ? `${x.rotulo} · ${formatQty(x.horas)} h` : x.rotulo} valor={formatMoney(x.monto)} />
  ));
  const papel = () => documentoDeBoletas([{ ...e, employee: empleado }], periodo ?? {}, branches || []);
  const anotar = (formato) => registrarEgreso('nomina', { formato, filas: 1, detalle: { boleta: e.id, periodo: e.period_id, via: 'app' } });

  const compartir = async () => {
    setArmando(true);
    try {
      const nombre = `Boleta ${empleado.name ? shortEmployeeName(empleado) : ''} ${periodo ? rotuloDePeriodo(periodo.start_date, periodo.end_date) : ''}`;
      if (await compartirPdf({ html: papel(), nombre })) anotar('pdf');
    } catch (err) {
      fallo('No se pudo armar el PDF', err?.message || '');
    } finally {
      setArmando(false);
    }
  };
  const imprimir = async () => {
    try { await imprimirPapel(papel()); anotar('impresion'); }
    catch (err) { fallo('No se pudo imprimir', err?.message || ''); }
  };
  const menu = () => {
    Haptics.selectionAsync().catch(() => {});
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Compartir PDF', 'Imprimir', 'Cancelar'], cancelButtonIndex: 2 },
      (i) => { if (i === 0) compartir(); else if (i === 1) imprimir(); },
    );
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Boleta', headerLargeTitle: false }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }} contentInsetAdjustmentBehavior="automatic">
        <Vidrio radio={24} tinte="rgba(18,183,106,0.12)">
          <View style={{ padding: 18, gap: 6, alignItems: 'center' }}>
            <Avatar empleado={e.employee ?? { name: '?' }} tamano={56} />
            <Text style={{ color: colorSistema.texto, fontSize: 19, fontWeight: '800' }}>{e.employee ? shortEmployeeName(e.employee) : 'Sin ficha'}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13, textAlign: 'center' }}>
              {[periodo ? rotuloDePeriodo(periodo.start_date, periodo.end_date) : null, `${formatQty(e.days_worked ?? 0)} días trabajados`].filter(Boolean).join(' · ')}
            </Text>
            <Text style={{ color: colorSistema.texto, fontSize: 34, fontWeight: '800', marginTop: 4 }}>{formatMoney(p.liquido)}</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 12, textAlign: 'center' }}>{montoEnLetras(p.liquido)}</Text>
          </View>
        </Vidrio>
        {p.diario ? (
          <Seccion titulo="Base">
            <Dato primero rotulo="Sueldo base mensual" valor={formatMoney(empleado.base_salary)} />
            <Dato rotulo="Sueldo diario" valor={formatMoney(p.diario)} />
            <Dato rotulo="Sueldo por hora" valor={formatMoney(p.porHora)} />
          </Seccion>
        ) : null}
        <Seccion titulo="A · Ingresos sujetos a retención">
          {filas(p.sujetos)}
          <Dato rotulo="Subtotal A" valor={formatMoney(p.subtotalA)} fuerte />
        </Seccion>
        <Seccion titulo="B · Otros ingresos">
          {filas(p.noSujetos)}
          <Dato primero={!p.noSujetos.length} rotulo="Subtotal B" valor={formatMoney(p.subtotalB)} fuerte />
        </Seccion>
        <Seccion titulo="C · Retenciones y descuentos">
          {filas([...p.retenciones, ...p.otrosDescuentos])}
          <Dato primero={!p.retenciones.length && !p.otrosDescuentos.length} rotulo="Total C" valor={formatMoney(p.totalDescuentos)} fuerte />
        </Seccion>
        <Seccion titulo="Líquido a recibir">
          <Dato primero rotulo="(A − C) + B" valor={formatMoney(p.liquido)} fuerte />
        </Seccion>
        {e.viaticos_detail ? <Seccion titulo="Concepto de viáticos"><Text style={{ color: colorSistema.texto, fontSize: 14 }}>{String(e.viaticos_detail)}</Text></Seccion> : null}
        {ultimaEdicion ? <Aviso tono="cuidado" texto={`Boleta editada. Última edición: ${ultimaEdicion.by ?? '—'} — ${ultimaEdicion.reason ?? ''}`} /> : null}
        <BotonGrande texto={armando ? 'Armando el PDF…' : 'Compartir o imprimir'} onPress={menu} deshabilitado={armando} />
      </ScrollView>
    </>
  );
}
