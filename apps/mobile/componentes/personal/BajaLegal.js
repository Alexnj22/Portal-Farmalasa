// La baja de un empleado en lo legal, NATIVA — gemela de
// `src/components/forms/BajaLegal.jsx` (2026-11-14, «dejemos TODO
// completamente nativo»). Lo que la ley pide según el motivo (hoja de
// renuncia, causal del Art. 50, fuero, ausencias, intento de contacto), la
// liquidación estimada y el cierre. Las reglas NO viven acá: son las de
// `bajaLegal.js` del núcleo, las mismas que frenan el guardado del portal
// (`problemaDeBaja`, por `validarNovedad`). Todo viaja en `metadata` del evento.
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Presionable as Pressable } from '../Tocable';
import Interruptor from '../Interruptor';
import { TERMINATION_REASONS, opcionesDeCatalogo } from '@nucleo/data/constants';
import {
  CAUSALES_ART_50, DIAS_DE_LA_SEMANA, DOCUMENTO_DE_BAJA, SALARIO_MINIMO_INICIAL,
  avisosDeBaja, diasDePreaviso, liquidacionEstimada, pendientesDeBaja,
} from '@nucleo/utils/bajaLegal';
import { htmlDeActaYCarta } from '@nucleo/utils/papelDeBaja';
import { registrarEgreso } from '@nucleo/data/egreso';
import { useStaffStore } from '@nucleo/store/staffStore';
import { BotonGrande } from '../formulario/Piezas';
import { ofrecerPapel } from '../pdf';
import { fallo } from '../Progreso';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { colorSistema } from '../Formulario';
import { Aviso, Campo, Opciones, Seccion, Vacio } from '../formulario/Piezas';
import Fecha from '../formulario/Fecha';
import { MARCA } from '../inicio/marca';

const larga = (f) => (f ? fechaTexto(f, { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

function Fila({ rotulo, children }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 44 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 16, flex: 1 }}>{rotulo}</Text>
      {children}
    </View>
  );
}

function Rotulo({ texto }) {
  return <Text style={{ color: colorSistema.texto2, fontSize: 13, fontWeight: '600', marginBottom: -4, marginLeft: 2 }}>{texto}</Text>;
}

/** Una fecha que puede estar vacía: en iPhone el selector sin valor muestra
 *  HOY, y en una baja eso se leería como un dato que nadie escribió. */
function FechaDeLey({ rotulo, valor, onCambiar, hasta }) {
  return (
    <Fila rotulo={rotulo}>
      {valor ? <Fecha valor={valor} onCambiar={onCambiar} hasta={hasta} /> : (
        <Pressable hitSlop={8} onPress={() => onCambiar(hasta && hasta < hoySV() ? hasta : hoySV())} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 16, fontWeight: '700' }}>Elegir</Text>
        </Pressable>
      )}
    </Fila>
  );
}

const SI_NO = [{ id: 'NO', label: 'No' }, { id: 'SI', label: 'Sí — embarazo, postnatal, incapacidad o directiva sindical' }];

export default function BajaLegal({ f, pon, emp }) {
  const motivo = f.terminationReason || '';
  const esRenuncia = motivo === 'RENUNCIA';
  const esSinResp = motivo === 'DESPIDO_SIN_RESPONSABILIDAD';
  const esDespido = esSinResp || motivo === 'DESPIDO_CON_RESPONSABILIDAD' || motivo === 'ABANDONO';
  const pideAusencias = motivo === 'ABANDONO' || (esSinResp && Number(f.causalArt50) === 12);
  const [ausencia, setAusencia] = useState(null);
  const sucursales = useStaffStore((s) => s.branches);
  const conActa = motivo === 'ABANDONO' || esSinResp;
  const imprimirActaYCarta = () => {
    const sucursal = (sucursales || []).find((b) => String(b.id) === String(emp?.branchId ?? emp?.branch_id))?.name;
    ofrecerPapel({
      html: htmlDeActaYCarta({ empleado: emp, sucursal, cargo: emp?.role, formData: f }),
      nombre: `Terminacion ${emp?.name || ''}`.trim(),
      titulo: 'Acta y carta de terminación',
      alTerminar: (via) => registrarEgreso('personal', { formato: 'pdf', filas: 1, detalle: { papel: 'acta_y_carta_de_terminacion', employee_id: emp?.id, via: `app-${via}` } }),
      alFallar: (e) => fallo('No se pudo preparar el papel', e?.message || 'Intenta de nuevo.'),
    });
  };

  const salario = emp?.base_salary ?? emp?.salary ?? null;
  const ingreso = emp?.hire_date || emp?.hireDate || null;
  const minimoTexto = f.salarioMinimoUsado ?? SALARIO_MINIMO_INICIAL;
  const minimo = Number(String(minimoTexto).replace(',', '.'));
  const acordadoTexto = f.montoAcordado ?? '';
  const acordado = Number(String(acordadoTexto).replace(',', '.'));
  const preavisoDias = diasDePreaviso(f);

  const liquidacion = useMemo(() => liquidacionEstimada({
    motivo, salarioMensual: salario, ingreso, baja: f.date, salarioMinimoMensual: minimo, preavisoDias,
  }), [motivo, salario, ingreso, f.date, minimo, preavisoDias]);

  // La estimación se guarda con la baja, con el mínimo que se usó (igual que el portal).
  useEffect(() => {
    const nueva = liquidacion ? { total: liquidacion.total, rubros: liquidacion.rubros, aniosDeServicio: liquidacion.aniosDeServicio } : null;
    if (JSON.stringify(nueva) !== JSON.stringify(f.liquidacionEstimada ?? null)) pon({ liquidacionEstimada: nueva, salarioMinimoUsado: minimoTexto });
  }, [liquidacion]); // eslint-disable-line react-hooks/exhaustive-deps

  const avisos = avisosDeBaja(f, emp);
  const ausencias = f.diasDeAusencia || [];

  return (
    <>
      <Seccion titulo="Motivo legal de la baja">
        <Opciones valor={motivo} onCambiar={(v) => pon({ terminationReason: v })}
          opciones={opcionesDeCatalogo(TERMINATION_REASONS).map((o) => ({ id: o.value, label: o.label }))} />
      </Seccion>

      {motivo ? (
        <>
          <Seccion titulo="Fechas" pie={esRenuncia ? 'La renuncia sólo vale en la hoja del Ministerio de Trabajo o del juzgado, presentada dentro de los 10 días de expedida (Art. 402 CT). El preaviso pide 15 días antes de la baja (30 en jefaturas).' : null}>
            <FechaDeLey rotulo="Último día que trabajó" valor={f.ultimoDiaLaborado} hasta={f.date || undefined} onCambiar={(v) => pon({ ultimoDiaLaborado: v })} />
            {esRenuncia ? (
              <>
                <FechaDeLey rotulo="Hoja oficial expedida el" valor={f.hojaRenunciaExpedida} onCambiar={(v) => pon({ hojaRenunciaExpedida: v })} />
                <FechaDeLey rotulo="La presentó el" valor={f.renunciaPresentada} onCambiar={(v) => pon({ renunciaPresentada: v })} />
              </>
            ) : null}
          </Seccion>

          {esDespido ? (
            <Seccion titulo="¿Tiene fuero?" pie="Embarazo, descanso postnatal, incapacidad vigente o directiva sindical.">
              <Opciones valor={f.fueroDeclarado || ''} onCambiar={(v) => pon({ fueroDeclarado: v })} opciones={SI_NO} />
            </Seccion>
          ) : null}

          {esSinResp ? (
            <Seccion titulo="La causal (Art. 50 CT)">
              <Opciones valor={f.causalArt50 ? String(f.causalArt50) : ''} onCambiar={(v) => pon({ causalArt50: v ? Number(v) : null })}
                opciones={CAUSALES_ART_50.map((c) => ({ id: String(c.n), label: `${c.n}. ${c.texto}` }))} />
              <FechaDeLey rotulo="Fecha de los hechos" valor={f.fechaDeLosHechos} onCambiar={(v) => pon({ fechaDeLosHechos: v })} />
              <Rotulo texto="Pruebas de la causal" />
              <Campo value={f.pruebas || ''} onChangeText={(t) => pon({ pruebas: t })} style={{ minHeight: 80 }}
                placeholder="Actas, testigos, sanciones previas, cámaras, reportes…" />
            </Seccion>
          ) : null}

          {pideAusencias ? (
            <Seccion titulo="Su día de descanso semanal" pie="Si falta el sábado y el lunes y el domingo es su descanso, son dos días laborales seguidos.">
              <Opciones valor={f.diaDeDescanso != null ? String(f.diaDeDescanso) : ''}
                onCambiar={(v) => pon({ diaDeDescanso: String(f.diaDeDescanso) === v ? null : Number(v) })}
                opciones={DIAS_DE_LA_SEMANA.map((d, i) => ({ id: String(i), label: d }))} />
            </Seccion>
          ) : null}

          {pideAusencias ? (
            <Seccion titulo={`Días que faltó sin permiso · ${ausencias.length}`} pie="Cuentan 2 días laborales completos seguidos, o 3 (también medios días) en un mismo mes (Art. 50, causal 12).">
              <Fila rotulo="Agregar el día">
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Fecha valor={ausencia || f.date || hoySV()} onCambiar={setAusencia} />
                  <Pressable hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => {
                    const d = ausencia || f.date || hoySV();
                    if (!ausencias.includes(d)) pon({ diasDeAusencia: [...ausencias, d].sort() });
                  }}>
                    <Text style={{ color: MARCA.azulClaro, fontSize: 16, fontWeight: '700' }}>Agregar</Text>
                  </Pressable>
                </View>
              </Fila>
              {ausencias.map((d) => (
                <Fila key={d} rotulo={larga(d)}>
                  <Pressable hitSlop={8} onPress={() => pon({ diasDeAusencia: ausencias.filter((x) => x !== d) })}>
                    <Text style={{ color: MARCA.rojo, fontSize: 15, fontWeight: '600' }}>Quitar</Text>
                  </Pressable>
                </Fila>
              ))}
              {!ausencias.length ? <Vacio enSeccion>Ninguno todavía.</Vacio> : null}
            </Seccion>
          ) : null}

          {motivo === 'ABANDONO' ? (
            <Seccion titulo="Cómo se le intentó contactar">
              <Campo value={f.intentoDeContacto || ''} onChangeText={(t) => pon({ intentoDeContacto: t })} style={{ minHeight: 70 }}
                placeholder="Llamadas, mensajes, visita al domicilio — con fechas" />
            </Seccion>
          ) : null}

          {avisos.map((a) => <Aviso key={a} tono="cuidado" texto={a} />)}

          <Seccion titulo="Liquidación" pie={salario == null ? null : `El mínimo de comercio y servicios es $${SALARIO_MINIMO_INICIAL.toFixed(2)}; cámbialo si es otro. Si se pagará un total distinto al estimado, escríbelo; vacío = el estimado. Es una estimación: confírmala con el contador o el abogado antes de pagar.`}>
            {salario == null ? <Vacio enSeccion>Sólo la ve quien tiene permiso para ver salarios.</Vacio>
              : !ingreso || !f.date ? <Vacio enSeccion>Faltan la fecha de ingreso de la ficha o la fecha de la baja.</Vacio>
                : !(minimo > 0) ? <Aviso tono="cuidado" texto="Escribe el salario mínimo para calcularla." />
                  : liquidacion ? (
                    <>
                      {liquidacion.rubros.map((r) => (
                        <View key={r.clave} style={{ flexDirection: 'row', gap: 10, paddingVertical: 6 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: r.aplica === true ? colorSistema.texto : colorSistema.texto2, fontSize: 15 }}>
                              {`${r.texto}${r.aplica === 'revisar' ? ' — a revisar, no se suma' : r.aplica === false ? ' — no corresponde' : ''}`}
                            </Text>
                            <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{r.base}</Text>
                          </View>
                          <Text style={{ color: r.aplica === true ? colorSistema.texto : colorSistema.texto2, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{formatMoney(r.monto)}</Text>
                        </View>
                      ))}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: colorSistema.separador, paddingTop: 8 }}>
                        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800' }}>Total estimado</Text>
                        <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(liquidacion.total)}</Text>
                      </View>
                      <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`Con ${liquidacion.aniosDeServicio} años de servicio. Los días trabajados del último período se pagan en la planilla, no aquí.`}</Text>
                    </>
                  ) : null}
            {salario == null ? null : (
              <>
                <Rotulo texto="Salario mínimo mensual" />
                <Campo multiline={false} keyboardType="decimal-pad" value={String(minimoTexto)} onChangeText={(t) => pon({ salarioMinimoUsado: t.replace(/[^0-9.,]/g, '') })} />
                <Rotulo texto="Total que se pagará (opcional)" />
                <Campo multiline={false} keyboardType="decimal-pad" value={String(acordadoTexto)} placeholder={liquidacion ? String(liquidacion.total) : 'Opcional'}
                  onChangeText={(t) => pon({ montoAcordado: t.replace(/[^0-9.,]/g, '') })} />
                {acordado > 0 && liquidacion && Math.abs(acordado - liquidacion.total) >= 0.01 ? (
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
                    {`Se pagará ${formatMoney(acordado)}, ${formatMoney(Math.abs(acordado - liquidacion.total))} ${acordado > liquidacion.total ? 'más' : 'menos'} que lo estimado. Quedan guardados los dos.`}
                  </Text>
                ) : null}
              </>
            )}
          </Seccion>

          <Seccion titulo="Cierre" pie="Se puede completar después, corrigiendo la baja desde el historial.">
            {pendientesDeBaja(motivo).map((p) => (
              <Fila key={p.clave} rotulo={p.texto}><Interruptor value={!!f[p.clave]} onValueChange={(v) => pon({ [p.clave]: v })} /></Fila>
            ))}
          </Seccion>

          <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>{`Respaldo que se adjunta abajo: ${DOCUMENTO_DE_BAJA[motivo]}.`}</Text>
          {conActa ? (
            <>
              <BotonGrande texto="Imprimir acta y carta" borde color={MARCA.azulClaro} onPress={imprimirActaYCarta} />
              <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 4 }}>La persona no tiene que firmar: la carta la firma el patrono o su representante, y se entrega o se envía a su domicilio (Art. 55 CT).</Text>
            </>
          ) : null}
        </>
      ) : null}
    </>
  );
}
