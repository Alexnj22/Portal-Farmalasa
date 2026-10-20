// Datos de MUESTRA del modo de prueba (2026-10-20, pedido del dueño: «¿dónde
// veo el saldo a favor? agrégalo en modo de prueba para verlo. Dame más
// herramientas en modo de prueba para que sea demo»).
//
// Todo vive en la memoria del teléfono: nada de esto se pide ni se escribe en
// el servidor. Las reservas de muestra llevan un id `muestra-…` y Mis reservas
// no las manda a ninguna acción del servidor (pagar, cancelar, subir la foto,
// quitar lo bajo receta): las cambia aquí, en `useModoPrueba.cambiosReservas`.
//
// Sólo existe para la cuenta de PRUEBA: `useDemo` devuelve null si el último
// resumen no dijo `prueba: true` (`useModoPrueba.cuentaDePrueba`, que pone
// lib/cuenta.js). La cuenta del revisor de las tiendas tiene muestras pero no
// `modo_prueba`: para ella esto no existe, igual que el panel.
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModoPrueba } from './prueba';

const PREFIJO = 'muestra-';
/** ¿Es una reserva de muestra (no existe en el servidor)? */
export const esDeMuestra = (r) => String(r?.id ?? '').startsWith(PREFIJO);

/** El estado del demo que importa a las pantallas, o null si no hay nada encendido. */
export function useDemo() {
  const s = useModoPrueba(useShallow((x) => ({
    cuenta: x.cuentaDePrueba, saldo: x.saldoFavor, reservas: x.reservasMuestra,
    codigo: x.vistaCodigo, cambios: x.cambiosReservas, base: x.baseMuestra,
  })));
  return useMemo(() => {
    if (!s.cuenta) return null;
    if (s.saldo === 'no' && !s.reservas && !s.codigo) return null;
    return { saldo: s.saldo, reservas: s.reservas, codigo: s.codigo, cambios: s.cambios, base: s.base };
  }, [s.cuenta, s.saldo, s.reservas, s.codigo, s.cambios, s.base]);
}

// Fechas relativas a cuando se encendió el demo (`base`): la cuenta regresiva
// de «lista para retirar» corre de verdad y no se reinicia en cada pantalla.
const iso = (base, horas) => new Date(base + horas * 3600000).toISOString();
const dia = (base, dias) => {
  const d = new Date(base + dias * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const SALA = { sala: 'La Salud - San Antonio', sala_direccion: 'Barrio San Antonio, Chalatenango' };
// El saldo a favor de muestra: lo pagado en línea de una reserva que la
// sucursal no alcanzó a preparar.
const SALDO = 14.75;

function fila(id, base, f) {
  const precio = f.precio_unitario ?? null;
  const cantidad = f.cantidad ?? 1;
  return {
    id: `${PREFIJO}${id}`, codigo: `R-${String(900000 + id)}`, origen: 'app', documento: null,
    estado: 'pendiente', pedido: null, producto_nombre: '', cantidad, precio_unitario: precio, precio_normal: null,
    oferta_titulo: null, oferta_fin: null, branch_id: null, lista_at: null, vence_at: null,
    created_at: iso(base, -(f.horasAtras ?? 2)), cerrada_at: null, anticipo: null,
    pago_estado: 'pendiente', pago_metodo: 'al_retirar', pagado_at: null, entrega: 'retiro', direccion_entrega: null, costo_envio: 0,
    saldo_favor: null, saldo_favor_vence: null, saldo_favor_usado_at: null, saldo_favor_origen: null, saldo_favor_devuelto_at: null,
    receta_estado: null, receta_motivo: null, receta_subida_at: null, receta_url: null, bajo_receta: false,
    pago_prueba: false, vencida_motivo: null, tipo: f.oferta_titulo ? 'promocion' : 'producto',
    total: precio != null ? Math.round(precio * cantidad * 100) / 100 : null, total_pedido: null,
    ...SALA, ...f,
  };
}

/**
 * Las reservas de muestra: una en cada paso. `saldo` decide si la vencida
 * pagada en línea muestra su saldo vigente o ya usado. Con sólo el saldo
 * encendido (sin las reservas) va únicamente esa vencida, que es donde vive.
 */
export function reservasDeMuestra(demo) {
  if (!demo || (!demo.reservas && demo.saldo === 'no')) return [];
  const b = demo.base;
  const vencida = fila(8, b, {
    estado: 'vencida', vencida_motivo: 'sin_preparar', producto_nombre: 'Ensure Advance vainilla 400 g', precio_unitario: SALDO,
    horasAtras: 80, cerrada_at: iso(b, -30), pago_estado: 'pagado', pago_metodo: 'en_linea', pagado_at: iso(b, -79),
    saldo_favor: SALDO, saldo_favor_vence: dia(b, 60), saldo_favor_origen: 'pago_en_linea',
    saldo_favor_usado_at: demo.saldo === 'usado' ? iso(b, -1) : null,
  });
  if (!demo.reservas) return aplicar([vencida], demo.cambios);
  const filas = [
    // En revisión: falta la foto de la receta.
    fila(1, b, { estado: 'en_revision', producto_nombre: 'Azitromicina 500 mg, caja de 3 tabletas', precio_unitario: 9.6,
      bajo_receta: true, horasAtras: 1 }),
    // En revisión: la foto ya se mandó y la sucursal la está revisando.
    fila(2, b, { estado: 'en_revision', producto_nombre: 'Levofloxacina 500 mg, caja de 7 tabletas', precio_unitario: 18.4,
      bajo_receta: true, receta_estado: 'pendiente', receta_subida_at: iso(b, -3), horasAtras: 4 }),
    // Pedido mixto: la sucursal pidió otra foto. Se puede reenviar o quitar lo bajo receta.
    fila(3, b, { estado: 'en_revision', pedido: 'P-DEMO01', producto_nombre: 'Claritromicina 500 mg, caja de 10 tabletas', precio_unitario: 21.5,
      bajo_receta: true, receta_estado: 'otra_foto', receta_motivo: 'La foto salió borrosa: no se lee la firma del médico.',
      receta_subida_at: iso(b, -6), horasAtras: 7, total_pedido: 26.25 }),
    fila(4, b, { estado: 'en_revision', pedido: 'P-DEMO01', codigo: 'R-900004', producto_nombre: 'Vitamina C 1 g efervescente, tubo de 10', precio_unitario: 4.75,
      horasAtras: 7, total_pedido: 26.25 }),
    // En preparación, sin pagar.
    fila(5, b, { estado: 'pendiente', producto_nombre: 'Protector solar FPS 50, 120 ml', precio_unitario: 12.9, precio_normal: 15.5,
      oferta_titulo: 'Verano sin manchas', oferta_fin: dia(b, 10), horasAtras: 5 }),
    // Lista para retirar, sin pagar.
    fila(6, b, { estado: 'lista', producto_nombre: 'Loratadina 10 mg, caja de 10 tabletas', precio_unitario: 3.25, cantidad: 2,
      lista_at: iso(b, -2), vence_at: iso(b, 22), horasAtras: 20 }),
    // Lista y pagada en línea (un pedido de dos productos).
    fila(7, b, { estado: 'lista', pedido: 'P-DEMO02', producto_nombre: 'Pañales talla M, paquete de 40', precio_unitario: 11.95,
      lista_at: iso(b, -1), vence_at: iso(b, 7 * 24 - 1), pago_estado: 'pagado', pago_metodo: 'en_linea', pagado_at: iso(b, -26), horasAtras: 26, total_pedido: 16.45 }),
    fila(70, b, { estado: 'lista', pedido: 'P-DEMO02', producto_nombre: 'Toallitas húmedas, paquete de 80', precio_unitario: 4.5,
      lista_at: iso(b, -1), vence_at: iso(b, 7 * 24 - 1), pago_estado: 'pagado', pago_metodo: 'en_linea', pagado_at: iso(b, -26), horasAtras: 26, total_pedido: 16.45 }),
    // Lista con un cobro de PRUEBA: no fue dinero, se paga al retirar.
    fila(9, b, { estado: 'lista', producto_nombre: 'Omeprazol 20 mg, caja de 14 cápsulas', precio_unitario: 6.8,
      lista_at: iso(b, -3), vence_at: iso(b, 7 * 24 - 3), pago_estado: 'pagado', pago_metodo: 'en_linea', pago_prueba: true, pagado_at: iso(b, -28), horasAtras: 28 }),
    // Vencida, con lo pagado a favor.
    vencida,
    // Receta rechazada (ya cerrada).
    fila(10, b, { estado: 'cancelada', producto_nombre: 'Moxifloxacina 400 mg, caja de 5 tabletas', precio_unitario: 24.3,
      bajo_receta: true, receta_estado: 'rechazada', receta_motivo: 'La receta tiene más de 30 días.', horasAtras: 120, cerrada_at: iso(b, -100) }),
    // Retirada.
    fila(11, b, { estado: 'retirada', producto_nombre: 'Acetaminofén 500 mg, caja de 100 tabletas', precio_unitario: 5.4,
      horasAtras: 200, cerrada_at: iso(b, -190), pago_estado: 'pagado', pago_metodo: 'efectivo', pagado_at: iso(b, -190) }),
  ];
  return aplicar(filas, demo.cambios);
}

// Lo que se «hizo» sobre una reserva de muestra (pagar, cancelar, subir la
// foto…), encima de cómo nació.
function aplicar(filas, cambios) {
  if (!cambios || !Object.keys(cambios).length) return filas;
  return filas.map((r) => (cambios[r.id] ? { ...r, ...cambios[r.id] } : r));
}

const ABIERTAS = new Set(['en_revision', 'pendiente', 'lista']);
const DEL_FILTRO = {
  todas: () => true, abiertas: (r) => ABIERTAS.has(r.estado),
  retiradas: (r) => r.estado === 'retirada', cerradas: (r) => r.estado === 'vencida' || r.estado === 'cancelada',
};

/** El saldo a favor vigente de muestra, con la forma de `saldo_a_favor` del servidor (o null). */
export function saldoDeMuestra(demo) {
  const v = reservasDeMuestra(demo).filter((r) => Number(r.saldo_favor) > 0 && !r.saldo_favor_usado_at && !r.saldo_favor_devuelto_at);
  if (!v.length) return null;
  const total = Math.round(v.reduce((t, r) => t + Number(r.saldo_favor), 0) * 100) / 100;
  const ordenadas = [...v].sort((a, c) => String(a.saldo_favor_vence).localeCompare(String(c.saldo_favor_vence)));
  return {
    total, vence: ordenadas[0].saldo_favor_vence,
    detalle: ordenadas.map((r) => ({ codigo: r.pedido ?? r.codigo, monto: Number(r.saldo_favor), vence: r.saldo_favor_vence, origen: r.saldo_favor_origen })),
  };
}

/**
 * La respuesta de `mis_reservas` con las de muestra: arriba de las reales, según
 * el filtro, y el saldo a favor de muestra sumado al real.
 */
export function misReservasConDemo(d, demo, filtro) {
  if (!d?.ok || !demo) return d;
  const muestra = reservasDeMuestra(demo).filter(DEL_FILTRO[filtro] ?? DEL_FILTRO.todas);
  return { ...d, reservas: [...muestra, ...(d.reservas ?? [])], saldo_a_favor: sumarSaldo(d.saldo_a_favor, saldoDeMuestra(demo)) };
}

function sumarSaldo(real, muestra) {
  if (!muestra) return real;
  if (!(real?.total > 0)) return muestra;
  const detalle = [...(muestra.detalle ?? []), ...(real.detalle ?? [])];
  const vence = [muestra.vence, real.vence].filter(Boolean).sort()[0] ?? null;
  return { total: Math.round((Number(real.total) + Number(muestra.total)) * 100) / 100, vence, detalle };
}

/**
 * El resumen (Inicio y Cuenta) con lo del demo: el saldo a favor, cuántas
 * reservas hay en curso y listas, y la sesión de código simulada.
 */
export function resumenConDemo(resumen, demo) {
  if (!resumen || resumen.pendiente || !demo) return resumen;
  const abiertas = reservasDeMuestra(demo).filter((r) => ABIERTAS.has(r.estado));
  return {
    ...resumen,
    saldo_a_favor: sumarSaldo(resumen.saldo_a_favor, saldoDeMuestra(demo)),
    reservas_abiertas: Number(resumen.reservas_abiertas ?? 0) + abiertas.length,
    reservas_listas: Number(resumen.reservas_listas ?? 0) + abiertas.filter((r) => r.estado === 'lista').length,
    alcance: demo.codigo ? 'codigo' : resumen.alcance,
  };
}

/**
 * «Avanzar un paso» las reservas de muestra, como si la sucursal trabajara:
 * la receta enviada se aprueba y pasa a preparación, lo que se preparaba
 * queda listo para retirar (con sus 24 horas, o 7 días si está pagado).
 */
export function avanzarMuestra(demo) {
  const ahora = Date.now();
  const cambios = {};
  for (const r of reservasDeMuestra(demo)) {
    if (r.estado === 'en_revision' && r.receta_estado === 'pendiente') {
      cambios[r.id] = { estado: 'pendiente', receta_estado: 'aprobada' };
    } else if (r.estado === 'pendiente') {
      const horas = r.pago_estado === 'pagado' ? 7 * 24 : 24;
      cambios[r.id] = { estado: 'lista', lista_at: new Date(ahora).toISOString(), vence_at: new Date(ahora + horas * 3600000).toISOString() };
    }
  }
  return cambios;
}
