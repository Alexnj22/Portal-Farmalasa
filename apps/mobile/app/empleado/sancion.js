// Sanción, NATIVA — el `SancionModal` de la ficha del portal (Art. 83 del
// Reglamento Interno): la falta del catálogo, la escalera que propone la base
// (`escalera_disciplinaria`: faltas en 60 días, verbales por la misma causa,
// la rectificación del Art. 86) con los cinco peldaños —el quinto no se elige:
// es una baja—, la fecha, los días sin goce en una suspensión, la autorización
// de Inspección de Trabajo en el peldaño 4, y qué pasó.
//
// Se registra con `registrarSancion` (la MISMA función; el permiso lo exige la
// base) y la constancia sale igual que en el portal, armada con la MISMA
// definición (`htmlDeLaConstancia`) y compartida como PDF para imprimirla,
// firmarla con el trabajador y subirla al expediente. Las reglas viven en el
// núcleo (`sancion`). El borrador se guarda solo (`sancion:<id>`, la misma
// clave del portal).
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { PELDANOS, consultarEscalera, listarFaltas, registrarSancion } from '@nucleo/data/disciplina';
import { EVENT_TYPES } from '@nucleo/data/constants';
import { codigoDeSancion, diasAlElegir, esSuspension, hastaDeLaSuspension, motivoDeLaPropuesta, sancionCompleta } from '@nucleo/utils/sancion';
import { htmlDeLaConstancia, nombreDeLaConstancia } from '@nucleo/utils/constanciaDeSancion';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import useBorrador from '@nucleo/hooks/useBorrador';
import { BARRA_NATIVA } from '../../componentes/PilaDePestana';
import { colorSistema } from '../../componentes/Formulario';
import { Aviso, BotonGrande, Campo, Opciones, Seccion } from '../../componentes/formulario/Piezas';
import { Pildora } from '../../componentes/avisos/Piezas';
import Fecha from '../../componentes/formulario/Fecha';
import Vidrio from '../../componentes/Vidrio';
import { compartirPdf } from '../../componentes/pdf';
import { MARCA } from '../../componentes/inicio/marca';
import { fallo, listo, trabajando } from '../../componentes/Progreso';
import { volver } from '../../componentes/volver';

const corta = (f) => (f ? fechaTexto(String(f).slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function Sancion() {
  const { id } = useLocalSearchParams();
  const { user } = useAuth();
  const empleados = useStaffStore((s) => s.employees);
  const sucursales = useStaffStore((s) => s.branches);
  const emp = useMemo(() => (empleados || []).find((e) => String(e.id) === String(id)), [empleados, id]);
  const sala = useMemo(() => (sucursales || []).find((b) => String(b.id) === String(emp?.branchId ?? emp?.branch_id))?.name, [sucursales, emp]);

  const [faltas, setFaltas] = useState(null);
  const [f, setF] = useState({ falta: '', fecha: hoySV(), dias: '', autorizacion: '', nota: '' });
  const [peldano, setPeldano] = useState(null);
  const [escalera, setEscalera] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const pon = (c) => setF((p) => ({ ...p, ...c }));

  const { recuperado, descartar } = useBorrador(emp ? `sancion:${emp.id}` : null, f);
  const [repuesto, setRepuesto] = useState(false);
  if (recuperado && !repuesto) { setRepuesto(true); setF((p) => ({ ...p, ...recuperado })); }

  useEffect(() => {
    Promise.resolve(listarFaltas()).then(setFaltas).catch((e) => { setFaltas([]); fallo('No se pudo leer el catálogo de faltas', mensajeAmigable(e)); });
  }, []);
  useEffect(() => {
    if (!f.falta || !emp?.id) return undefined;
    let vivo = true;
    setCargando(true);  
    Promise.resolve(consultarEscalera(emp.id, f.falta, f.fecha))
      .then((r) => { if (vivo) { setEscalera(r); setPeldano((p) => p ?? r?.peldano ?? 1); } })
      .catch((e) => { if (vivo) fallo('No se pudo leer la escalera', mensajeAmigable(e)); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [f.falta, f.fecha, emp?.id]);

  if (!emp) return <Aviso tono="freno" texto="No se encontró a esta persona." />;

  const suspension = esSuspension(peldano);
  const hasta = hastaDeLaSuspension(peldano, f.fecha, f.dias);
  const completa = sancionCompleta({ falta: f.falta, peldano, fecha: f.fecha, dias: f.dias, autorizacion: f.autorizacion });
  const antecedentes = escalera?.antecedentes || [];
  const elegida = (faltas || []).find((x) => x.clave === f.falta);
  const elegir = (n) => { Haptics.selectionAsync().catch(() => {}); setPeldano(n); pon({ dias: diasAlElegir(n, f.dias) }); };

  const datosDeLaConstancia = (codigo) => ({
    nombre: emp.name, dui: emp.dui, cargo: emp.role, sala,
    falta: elegida?.nombre || f.falta, faltaArticulo: elegida?.articulo, peldano, fecha: f.fecha,
    dias: suspension ? Number(f.dias) : null, hasta, autorizacion: f.autorizacion.trim() || null,
    hechos: f.nota.trim() || null, impuestaPor: user?.name, codigo,
  });

  const guardar = () => {
    const p = PELDANOS.find((x) => x.n === peldano);
    Alert.alert(`¿Registrar ${p?.nombre?.toLowerCase() || 'la sanción'}?`,
      `Queda en el expediente de ${shortEmployeeName(emp)}. Después se comparte la constancia para imprimirla y firmarla.`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Registrar', style: 'destructive', onPress: async () => {
          setGuardando(true); trabajando('Registrando…');
          try {
            const eventoId = await registrarSancion({
              employeeId: emp.id, falta: f.falta, peldano, fecha: f.fecha,
              dias: suspension ? Number(f.dias) : null, nota: f.nota.trim() || null, autorizacion: f.autorizacion.trim() || null,
            });
            descartar();
            listo('Sanción registrada', 'Comparte la constancia para imprimirla y firmarla.');
            const datos = datosDeLaConstancia(codigoDeSancion(eventoId, f.fecha));
            await compartirPdf({ html: htmlDeLaConstancia(datos), nombre: nombreDeLaConstancia(emp.name, f.fecha).replace(/\.pdf$/, '') })
              .catch(() => fallo('La constancia no se pudo armar', 'La sanción sí quedó registrada.'));
            volver(`/empleado/${emp.id}`);
          } catch (e) {
            fallo('No se registró', mensajeAmigable(e, 'Intenta de nuevo.'));
          } finally { setGuardando(false); }
        } },
      ]);
  };

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Sanción', headerLargeTitle: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
          <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>{`${shortEmployeeName(emp)} · ${emp.role || 'Sin cargo'}${sala ? ` · ${sala}` : ''}`}</Text>
          <Seccion titulo="Falta cometida">
            {faltas == null ? <ActivityIndicator /> : (
              <Opciones valor={f.falta} onCambiar={(v) => { pon({ falta: v }); setPeldano(null); setEscalera(null); }}
                opciones={faltas.map((x) => ({ id: x.clave, label: x.nombre, detalle: x.articulo || null }))} />
            )}
          </Seccion>

          {cargando ? <ActivityIndicator /> : null}
          {escalera && !cargando ? (
            <>
              <Aviso tono={escalera.faltas_en_60_dias > 0 ? 'cuidado' : 'nota'} texto={motivoDeLaPropuesta(escalera, corta)} />
              <View style={{ gap: 8 }}>
                {PELDANOS.map((p) => {
                  const elegido = peldano === p.n;
                  return (
                    <Pressable key={p.n} disabled={p.noElegible || guardando} onPress={() => elegir(p.n)} accessibilityRole="button"
                      style={({ pressed }) => ({ opacity: p.noElegible ? 0.5 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
                      <Vidrio radio={16} tinte={elegido ? 'rgba(59,130,246,0.25)' : undefined}>
                        <View style={{ padding: 12, gap: 4 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700', flex: 1 }}>{`${p.n}. ${p.nombre}`}</Text>
                            {escalera.peldano === p.n ? <Pildora texto="Propuesta" color={MARCA.azulClaro} /> : null}
                            {p.noElegible ? <Pildora texto="Se registra como baja" color={colorSistema.texto2} /> : null}
                            {elegido ? <Text style={{ color: MARCA.azulClaro, fontSize: 19, fontWeight: '700' }}>✓</Text> : null}
                          </View>
                          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{p.detalle}</Text>
                        </View>
                      </Vidrio>
                    </Pressable>
                  );
                })}
              </View>
              {antecedentes.length ? (
                <Seccion titulo="Antecedentes">
                  {antecedentes.slice(0, 6).map((a, i) => (
                    <View key={a.id ?? i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 }}>
                      <Text style={{ color: colorSistema.texto2, fontSize: 13, width: 92 }}>{corta(a.fecha || a.date)}</Text>
                      <Text style={{ color: colorSistema.texto, fontSize: 14, flex: 1 }}>{EVENT_TYPES[a.type]?.label || a.type}</Text>
                      {a.reclamo === 'REVOCADA' ? <Pildora texto="Revocada" color={colorSistema.texto2} /> : null}
                    </View>
                  ))}
                </Seccion>
              ) : null}
            </>
          ) : null}

          {f.falta ? (
            <>
              <Seccion titulo="Fecha y días">
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Fecha</Text>
                  <Fecha valor={f.fecha} onCambiar={(v) => pon({ fecha: v })} />
                </View>
                {suspension ? (
                  <>
                    <Campo multiline={false} keyboardType="number-pad" editable={peldano !== 3} placeholder="Días sin goce de salario"
                      value={String(f.dias || '')} onChangeText={(t) => pon({ dias: t.replace(/\D/g, '') })} />
                    {hasta ? <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`Hasta el ${corta(hasta)}`}</Text> : null}
                  </>
                ) : null}
              </Seccion>
              {peldano === 4 ? (
                <Seccion titulo="Autorización">
                  <Aviso tono="cuidado" texto="Una suspensión de más de un día necesita la autorización y calificación de motivos del Director General de Inspección de Trabajo. Sin ese dato no se guarda." />
                  <Campo multiline={false} placeholder="Resolución y fecha" value={f.autorizacion} onChangeText={(t) => pon({ autorizacion: t })} />
                </Seccion>
              ) : null}
              <Seccion titulo="Qué pasó">
                <Campo value={f.nota} onChangeText={(t) => pon({ nota: t })} style={{ minHeight: 90 }} placeholder="Los hechos, en las palabras de quien los presenció" />
              </Seccion>
              <Aviso texto="Al guardar se comparte la constancia. Fírmala con el trabajador —el reglamento exige la firma de ambas partes y su compromiso escrito a mano— y súbela al expediente." />
              <BotonGrande texto={guardando ? 'Registrando…' : 'Registrar la sanción'} color={MARCA.rojo} deshabilitado={!completa || guardando} onPress={guardar} />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}
