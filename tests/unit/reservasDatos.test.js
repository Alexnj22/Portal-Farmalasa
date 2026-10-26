import { describe, it, expect, vi, beforeEach } from 'vitest';

// Reservas, encargos y saldo a favor (app de clientes, lado de la sala). Lo
// que se prueba es lo que sale hacia el cliente —los mensajes de WhatsApp y el
// número al que van— y las cuentas que la pantalla muestra ANTES de confirmar,
// que tienen que coincidir con las que hace la base.

let respuesta = { data: null, error: null };
const pedidas = [];
const invocar = vi.fn();
vi.mock('@nucleo/supabaseClient', () => {
    const cadena = (tabla) => {
        const q = { tabla, ops: [] };
        const p = new Proxy({}, {
            get(_, op) {
                if (op === 'then') return (res, rej) => { pedidas.push(q); return Promise.resolve(respuesta).then(res, rej); };
                return (...a) => { q.ops.push([op, ...a]); return p; };
            },
        });
        return p;
    };
    return { supabase: {
        from: cadena,
        rpc: vi.fn(async () => respuesta),
        functions: { invoke: (...a) => invocar(...a) },
    } };
});
vi.mock('@nucleo/utils/storageFiles', () => ({ subirArchivo: vi.fn(async (b, ruta) => `public/${b}/${ruta}`) }));

const r = await import('@nucleo/data/reservas');
const { supabase } = await import('@nucleo/supabaseClient');
const { subirArchivo } = await import('@nucleo/utils/storageFiles');

beforeEach(() => { respuesta = { data: null, error: null }; pedidas.length = 0; vi.clearAllMocks(); });
const sinDuros = (s) => s.replace(/\u00a0/g, ' ');

describe('códigos y teléfono', () => {
    it('el código de reserva y de encargo llevan seis dígitos', () => {
        expect(r.codigoDeReserva(42)).toBe('R-000042');
        expect(r.codigoDeEncargo(1234567)).toBe('E-1234567');
    });

    it('whatsappDe: 8 dígitos llevan el 503; con 503 se queda; lo demás no es un número válido', () => {
        expect(r.whatsappDe('7777-8888')).toBe('50377778888');
        expect(r.whatsappDe('+503 7777 8888')).toBe('50377778888');
        expect(r.whatsappDe('777788')).toBeNull();
        expect(r.whatsappDe('1 305 555 0101')).toBeNull();
        expect(r.whatsappDe(null)).toBeNull();
    });
});

describe('los mensajes que manda la sala', () => {
    it('reserva lista: saluda por el primer nombre, bien escrito, con el código y el producto', () => {
        const m = r.mensajeDeReservaLista({ id: 7, cliente: 'MARÍA JOSÉ PÉREZ', cantidad: 2, producto: 'Ibuprofeno 400', oferta: true }, 'Salud 4');
        expect(m).toMatch(/^Hola María, le saludamos de Farmacia Salud Salud 4\./);
        expect(m).toContain('R-000007 (2 × Ibuprofeno 400)');
        expect(m).toContain('el precio de oferta se respeta');
    });

    it('sin oferta promete el precio con que se apartó, no uno de oferta', () => {
        const m = r.mensajeDeReservaLista({ id: 7, cliente: '', cantidad: 1, producto: 'X', oferta: false }, 'Salud 1');
        expect(m.startsWith('Hola, le saludamos')).toBe(true);
        expect(m).toContain('se respeta el precio con que la apartó');
        expect(m).not.toContain('oferta');
    });

    it('con vencimiento dice el DÍA hasta el que se puede retirar, no una hora', () => {
        const m = sinDuros(r.mensajeDeReservaLista({ id: 1, cliente: 'ANA', cantidad: 1, producto: 'X', vence_at: '2026-10-30T23:59:00-06:00' }, 'S'));
        expect(m).toMatch(/hasta el viernes, 30 de octubre|hasta el viernes 30 de octubre/);
        expect(m).not.toMatch(/\d:\d\d/);
    });

    it('encargo conseguido: precio, total y fecha; encargo listo: que ya llegó', () => {
        const conseguido = sinDuros(r.mensajeDeEncargo({ cliente: 'LUIS', codigo: 'E-000003', cantidad: 3, producto: 'Y',
            precio_unitario: 2.5, anticipo: 7.5, estado: 'confirmado' }, 'Salud 2'));
        expect(conseguido).toMatch(/\$\s?2\.50 c\/u, total \$\s?7\.50/);
        expect(conseguido).toContain('se paga completo en la sala');
        const listo = r.mensajeDeEncargo({ cliente: 'LUIS', codigo: 'E-000003', cantidad: 3, producto: 'Y', estado: 'listo', sala: 'Salud 9' });
        expect(listo).toContain('ya llegó');
        expect(listo).toContain('Farmacia Salud Salud 9');
    });

    it('el enlace de pago lleva monto, código y la URL', () => {
        const m = sinDuros(r.mensajeDeEnlaceDePago({ cliente: 'ANA', monto: 12, codigo: 'R-000001', url: 'https://pagar/x' }, 'S'));
        expect(m).toMatch(/pagar \$\s?12\.00 de R-000001: https:\/\/pagar\/x/);
    });
});

describe('el reparto del dinero al ajustar una reserva (la misma cuenta que la base)', () => {
    it('lo pagado cubre primero lo que se queda, después la alternativa, y el resto queda a favor', () => {
        expect(r.repartoDelAjuste({ pagado: 20, precio: 3, cantidad: 2, totalAlternativa: 5 })).toEqual({ queda: 6, alternativa: 5, aFavor: 9 });
    });
    it('si lo que se queda vale más que lo pagado, todo va a eso y nada a favor', () => {
        expect(r.repartoDelAjuste({ pagado: 4, precio: 3, cantidad: 2, totalAlternativa: 5 })).toEqual({ queda: 4, alternativa: 0, aFavor: 0 });
    });
    it('sin quedarse nada, todo lo pagado sin alternativa queda a favor, al centavo', () => {
        expect(r.repartoDelAjuste({ pagado: 10.1, precio: 3.37, cantidad: 0 })).toEqual({ queda: 0, alternativa: 0, aFavor: 10.1 });
        // Pagada entera (en línea el anticipo queda en 0): cuenta el total; un cobro de prueba no.
        expect(r.pagadoDeReserva({ precio: 10, cantidad: 3, anticipo: 0, pago_estado: 'pagado' })).toBe(30);
        expect(r.pagadoDeReserva({ precio: 10, cantidad: 3, anticipo: 0, pago_estado: 'pagado', pago_prueba: true })).toBe(0);
        expect(r.pagadoDeReserva({ precio: 10, cantidad: 3, anticipo: 15, pago_estado: 'anticipo' })).toBe(15);
        const x = r.repartoDelAjuste({ pagado: 0.3, precio: 0.1, cantidad: 1, totalAlternativa: 0.1 });
        expect(x).toEqual({ queda: 0.1, alternativa: 0.1, aFavor: 0.1 });
    });
});

describe('qué reserva espera algo de la sala', () => {
    it('lo que falta pedir descuenta lo que llegó y lo que viene, sin bajar de cero', () => {
        expect(r.faltaDeReserva({ cantidad: 5, traslado_llegaron: 1, traslado_por_llegar: 2 })).toBe(2);
        expect(r.faltaDeReserva({ cantidad: 2, traslado_llegaron: 3 })).toBe(0);
        expect(r.faltaDeReserva(null)).toBe(0);
    });

    it('por resolver: pendiente con un traslado que no salió entero', () => {
        expect(r.reservaPorResolver({ origen: 'app', estado: 'pendiente', traslado_estado: 'parcial' })).toBe(true);
        expect(r.reservaPorResolver({ origen: 'app', estado: 'lista', traslado_estado: 'parcial' })).toBe(false);
        expect(r.reservaPorResolver({ origen: 'app', estado: 'pendiente', traslado_estado: 'enviado' })).toBe(false);
    });

    it('por traer: sólo la de la app pendiente que la sala todavía no pidió', () => {
        expect(r.reservaPorTraer({ origen: 'app', estado: 'pendiente', traslado_estado: null })).toBe(true);
        expect(r.reservaPorTraer({ origen: 'sucursal', estado: 'pendiente' })).toBe(false);
        expect(r.reservaPorTraer({ origen: 'app', estado: 'pendiente', traslado_estado: 'enviado' })).toBe(false);
    });

    it('devoluciones por entregar: pedidas, autorizadas y sin entregar', () => {
        const filas = [
            { id: 1, devolucion_pedida_at: 'x', saldo_favor_devuelto_at: 'y', devolucion_entregada_at: null },
            { id: 2, devolucion_pedida_at: 'x', saldo_favor_devuelto_at: null },
            { id: 3, devolucion_pedida_at: 'x', saldo_favor_devuelto_at: 'y', devolucion_entregada_at: 'z' },
        ];
        expect(r.devolucionesPorEntregar(filas).map((f) => f.id)).toEqual([1]);
        expect(r.devolucionesPorEntregar(null)).toEqual([]);
    });
});

describe('lo que va a la base', () => {
    it('las presentaciones repetidas en el catálogo se ofrecen una sola vez', async () => {
        respuesta = { data: [
            { vineta: '1.50', factor: 1, presentaciones: { tipo: 'Unidad' } },
            { vineta: '1.50', factor: 1, presentaciones: { tipo: 'Unidad' } },
            { vineta: '14', factor: 10, presentaciones: { tipo: 'Caja' } },
            { vineta: '2', factor: null, presentaciones: null },
        ], error: null };
        expect(await r.preciosDeProducto('5')).toEqual([
            { precio: 1.5, factor: 1, tipo: 'Unidad' }, { precio: 14, factor: 10, tipo: 'Caja' }, { precio: 2, factor: 1, tipo: 'Unidad' },
        ]);
        expect(pedidas[0].ops).toContainEqual(['eq', 'product_id', 5]);
    });

    it('guardar el envío sin permiso (cero filas) es un error explícito', async () => {
        respuesta = { data: [], error: null };
        await expect(r.guardarAjustesEnvio({ activo: true, costo: '2', gratisDesde: '', nota: ' x ' }, 'e1')).rejects.toThrow('permiso');
        const fila = pedidas[0].ops.find(([o]) => o === 'update')[1];
        expect(fila).toMatchObject({ envio_activo: true, envio_costo: 2, envio_gratis_desde: null, envio_nota: 'x', updated_by: 'e1' });
    });

    it('el saldo a favor viaja con la prueba recortada y el monto como número', async () => {
        await r.usarSaldoAFavor('9', '3.5', ' 0123 ');
        expect(supabase.rpc).toHaveBeenCalledWith('reserva_usar_saldo_favor', { p_id: 9, p_monto: 3.5, p_prueba: '0123' });
        await r.buscarSaldoAFavor(' R-000009 ');
        expect(supabase.rpc).toHaveBeenLastCalledWith('saldo_favor_buscar', { p_codigo: 'R-000009', p_prueba: null });
    });

    it('decidir una receta sin motivo manda null, no una cadena vacía', async () => {
        await r.decidirReceta('4', 'aprobada', '   ');
        expect(supabase.rpc).toHaveBeenCalledWith('reserva_receta_decidir', { p_id: 4, p_decision: 'aprobada', p_motivo: null });
    });

    it('todas las salas = null, no 0', async () => {
        respuesta = { data: null, error: null };
        expect(await r.fetchReservasDeSucursal(null)).toEqual([]);
        expect(supabase.rpc).toHaveBeenCalledWith('reservas_de_sucursal', { p_branch_id: null, p_abiertas: true });
    });

    it('un error de la base se lanza', async () => {
        respuesta = { data: null, error: new Error('FORBIDDEN') };
        await expect(r.prorrogarReserva(1)).rejects.toThrow('FORBIDDEN');
    });

    it('varios productos en un encargo viajan como renglones limpios', async () => {
        await r.crearEncargosEnSucursal({ branchId: '3', customerId: '8', nota: '  ', lineas: [{ productoId: '5', productoNombre: 'A', factor: 0, cantidad: '2' }] });
        expect(supabase.rpc).toHaveBeenCalledWith('encargos_en_sucursal_crear', {
            p_branch_id: 3, p_customer_id: 8, p_nota: null,
            p_lineas: [{ producto_id: 5, producto_nombre: 'A', factor: 1, cantidad: 2 }],
        });
    });

    it('la foto del encargo va a la carpeta de su sala', async () => {
        await r.subirFotoDeEncargo(4, { type: 'image/jpeg' });
        const [bucket, ruta, , opciones] = subirArchivo.mock.calls[0];
        expect(bucket).toBe('encargos-fotos');
        expect(ruta).toMatch(/^4\/.+\.jpg$/);
        expect(opciones).toEqual({ contentType: 'image/jpeg' });
    });
});

describe('enviarPreventa — nunca lanza', () => {
    it('devuelve el motivo que viene en el cuerpo del error', async () => {
        invocar.mockResolvedValueOnce({ data: null, error: { context: { json: async () => ({ error: 'YA_HAY_PREVENTA' }) } } });
        expect(await r.enviarPreventa(['1'])).toEqual({ ok: false, error: 'YA_HAY_PREVENTA' });
        expect(invocar).toHaveBeenCalledWith('preventa-caja', { body: { accion: 'enviar', reservas: [1] } });
    });
    it('si la red se cae, contesta { ok: false } en vez de reventar', async () => {
        invocar.mockRejectedValueOnce(new Error('offline'));
        const x = await r.enviarPreventa([2]);
        expect(x.ok).toBe(false);
        expect(x.error.message).toBe('offline');
    });
    it('sin datos tampoco es un éxito', async () => {
        invocar.mockResolvedValueOnce({ data: null, error: null });
        expect((await r.enviarPreventa([2])).ok).toBe(false);
    });
});
