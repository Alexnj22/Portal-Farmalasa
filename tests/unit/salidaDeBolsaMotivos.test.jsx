import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';

// ═══════════════════════════════════════════════════════════════════════════
// El formulario de «Sacar dinero de una bolsa» sale del CATÁLOGO.
//
// Lo que estas pruebas anclan es que **el catálogo mande de verdad**: qué
// campos aparecen, cuáles frenan y cuáles no. Escrito con `if`s en el `.jsx`
// —que es como estaba antes— un motivo nuevo aparecía en la base y no en la
// pantalla, y nada lo delataba.
//
// El disparador fue el repaso del usuario del 2026-08-19, motivo por motivo:
// «pago a proveedor: no lleva número de boleta, porque no es por POS. foto del
// comprobante tampoco porque a veces no deja el DTE, que sea opcional la foto.
// quien se lleva el efectivo no debe salir, porque no es de la empresa».
//
// Los tres casos que se prueban son los tres que se pueden romper por separado:
// la foto OBLIGATORIA que frena, la OPCIONAL que no frena, y el receptor que
// manda a un segundo paso en vez de registrar.
// ═══════════════════════════════════════════════════════════════════════════

const registrarSalida = vi.fn(async () => ({ data: { folio: 'PAG-1' }, error: null }));
/* Lo que el lector de la boleta contesta. Por defecto: leyó bien la boleta
   000318 por $100.00 — la remesa real del 2026-08-21. */
const leerBoleta = vi.fn(async () => ({
    leido: { es_boleta: true, legible: true, monto: 100, numero_boleta: '000318',
             entidad: 'BANCO PROMERICA', nombres: ['BANCO PROMERICA', 'RIA'],
             // Lo que el papel dice que FUE. Arriba lleva el banco del POS y en
             // el detalle la red que entrega el dinero: son dos nombres
             // distintos y la operación se lee del segundo.
             tipo_operacion: 'REMESA', red_remesas: 'RIA' },
    coincide: { entidad: null, numeroBoleta: null, monto: null },
    veredicto: 'OK',
    avisos: [],
}));

/* El catálogo, calcado de las filas reales de `bolsas_tipos_salida` — con los
 * motivos APAGADOS incluidos, que es como llega desde el 2026-09-02: la lista
 * completa hace falta para nombrar salidas viejas, y `activo` es lo que decide
 * cuáles se ofrecen. */
const TIPOS = [
    { codigo: 'POS_PROMERICA', etiqueta: 'POS Promerica', prefijo: 'POS', signo: -1,
      etiqueta_entidad: 'Remesadora', pide_boleta: true, foto: 'OBLIGATORIA',
      pide_receptor: false, entidad_la_dice_el_papel: true, activo: true },
    { codigo: 'PAGO_PROVEEDOR', etiqueta: 'Pago a proveedor', prefijo: 'PAG', signo: -1,
      etiqueta_entidad: 'Proveedor', pide_boleta: false, foto: 'OPCIONAL',
      pide_receptor: false, entidad_la_dice_el_papel: false, activo: true },
    { codigo: 'GASTO', etiqueta: 'Gasto o compra urgente', prefijo: 'GAS', signo: -1,
      etiqueta_entidad: null, pide_boleta: false, foto: 'OPCIONAL',
      pide_receptor: true, entidad_la_dice_el_papel: false, activo: true },
    // Apagado el 2-sep a favor de «POS Promerica». Sigue en el catálogo porque
    // 50 salidas le apuntan y tienen que poder decir qué fueron.
    { codigo: 'REMESA', etiqueta: 'Remesa entregada a un cliente', prefijo: 'REM', signo: -1,
      etiqueta_entidad: 'Remesadora', pide_boleta: true, foto: 'OBLIGATORIA',
      pide_receptor: false, entidad_la_dice_el_papel: false, activo: false },
];

vi.mock('../../src/data/bolsas', () => ({
    fetchTiposDeSalida: vi.fn(async () => TIPOS),
    fetchEntidadesDeSalida: vi.fn(async () => [
        { tipo: 'POS_PROMERICA', nombre: 'MONEYGRAM' },
        { tipo: 'POS_PROMERICA', nombre: 'RIA' },
    ]),
    registrarSalida: (...a) => registrarSalida(...a),
    subirComprobante: vi.fn(async () => 'https://x/f.jpg'),
    leerBoleta: (...a) => leerBoleta(...a),
    guardarLecturaDeBoleta: vi.fn(async () => {}),
    boletaYaRegistrada: vi.fn(async () => []),
    identificarPorCarne: vi.fn(),
    identificarPorUsuario: vi.fn(),
}));
/* El editor de la foto se reemplaza por un botón: acá no se prueba el recorte
   —eso vive en `fotoDocumento.test.js`— sino qué hace el formulario con la foto
   ya preparada. El de verdad monta un lienzo, que en estas pruebas no existe. */
vi.mock('../../src/components/common/EditorDeDocumento', () => ({
    default: ({ file, onConfirm }) => (
        <button type="button" onClick={() => onConfirm(file)}>preparar la foto</button>
    ),
}));
vi.mock('../../src/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('../../src/store/toastStore', () => ({ useToastStore: () => vi.fn() }));

const SalidaDeBolsa = (await import('../../src/components/bolsas/SalidaDeBolsa')).default;

const BOLSAS = [{ id: 1, folio: 'BOL-1', branch_id: 3, estado: 'ABIERTA',
    fecha: '2026-08-18', hora: '18:00:00', monto_inicial: 500 }];
const SALDOS = new Map([[1, { bolsa_id: 1, saldo: 500 }]]);

const abrir = async () => {
    const r = render(
        <SalidaDeBolsa abierto bolsas={BOLSAS} saldos={SALDOS} onClose={() => {}} onHecho={() => {}} />,
    );
    // Los dos `fetch` del catálogo resuelven en microtareas.
    await act(async () => {});
    return r;
};

/** Elegir un motivo en el `LiquidSelect`, que es un botón + lista. */
const elegirMotivo = async (etiqueta) => {
    fireEvent.click(screen.getByLabelText('Motivo de la salida'));
    await act(async () => {});
    fireEvent.click(screen.getByText(etiqueta));
    await act(async () => {});
};

const escribirMonto = async (v) => {
    fireEvent.change(screen.getByLabelText(/Cuánto/i), { target: { value: v } });
    await act(async () => {});
};

beforeEach(() => { registrarSalida.mockClear(); leerBoleta.mockClear(); });

/** La tarjeta del dato que trajo la boleta, buscada por su rótulo. */
const tarjeta = (rotulo) => screen.getByText(rotulo).closest('[data-surface="card"]');

/** Elegir la foto del comprobante y confirmarla en el editor. */
const elegirFoto = async () => {
    const input = document.querySelector('input[type="file"]');
    const f = new File(['x'], 'boleta.jpg', { type: 'image/jpeg' });
    await act(async () => { fireEvent.change(input, { target: { files: [f] } }); });
    await act(async () => { fireEvent.click(screen.getByText('preparar la foto')); });
};

describe('SalidaDeBolsa — el catálogo decide qué se pide', () => {
    it('sin motivo elegido no dibuja ningún campo del motivo', async () => {
        await abrir();
        expect(screen.queryByText(/Número de boleta/i)).toBeNull();
        expect(screen.queryByText(/Foto del comprobante/i)).toBeNull();
        expect(screen.queryByText(/Remesadora/i)).toBeNull();
    });

    // Lo que el usuario pidió quitar: el pago a proveedor no pasa por el POS.
    it('«Pago a proveedor» no pide boleta y su foto dice que es opcional', async () => {
        await abrir();
        await elegirMotivo('Pago a proveedor');
        expect(screen.queryByText('Número de boleta')).toBeNull();
        expect(screen.getByText(/Foto del comprobante \(opcional\)/i)).toBeTruthy();
    });

    // Y sin foto se puede registrar — que es todo el punto de 'OPCIONAL'.
    it('«Pago a proveedor» se registra SIN foto y sin identificar a nadie', async () => {
        await abrir();
        await elegirMotivo('Pago a proveedor');
        fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'Droguería X' } });
        await escribirMonto('120.50');

        fireEvent.click(screen.getByRole('button', { name: /Registrar e imprimir/i }));
        await act(async () => {});

        expect(registrarSalida).toHaveBeenCalledTimes(1);
        const arg = registrarSalida.mock.calls[0][0];
        expect(arg.tipo).toBe('PAGO_PROVEEDOR');
        expect(arg.monto).toBe(120.5);
        expect(arg.fotoUrl).toBeNull();
        // El cobrador del proveedor no es de la empresa: no hay a quién pedirle
        // carné, y por eso el motivo no lo pide.
        expect(arg.recibidoPor).toBeNull();
        expect(arg.vale).toBeNull();
    });

    // «POS Promerica» NO se relajó: es la única que pasa por el POS. Lo que
    // cambió en v2.703.6 es el ORDEN — la foto va primero porque trae el monto y
    // el número—, así que lo que se ancla es que la foto siga siendo obligatoria
    // y que los datos que ella trae todavía NO se pidan a mano.
    it('«POS Promerica» exige foto, y el monto y el número no se piden antes', async () => {
        await abrir();
        await elegirMotivo('POS Promerica');
        expect(screen.getByText('Foto del comprobante')).toBeTruthy();
        expect(screen.queryByText(/Foto del comprobante \(opcional\)/i)).toBeNull();
        expect(screen.queryByText('Número de boleta')).toBeNull();
        expect(screen.queryByLabelText(/Cuánto/i)).toBeNull();
    });

    /* ── El motivo apagado no se ofrece, pero el catálogo lo conserva ───────
     * Un borrador guardado antes del cambio vuelve con «REMESA» puesto: sin la
     * exigencia de `activo` se podría registrar por una casilla retirada. */
    it('un motivo apagado no aparece en la lista de motivos', async () => {
        await abrir();
        fireEvent.click(screen.getByLabelText('Motivo de la salida'));
        await act(async () => {});
        expect(screen.getByText('POS Promerica')).toBeTruthy();
        expect(screen.queryByText('Remesa entregada a un cliente')).toBeNull();
    });

    /* ── La remesadora ya no se pregunta: la dice el papel ──────────────────
     * Usuario, 2026-09-02: «reemplaza a remesas, pero no sería sólo remesas,
     * sería retiro de efectivo, etc. El voucher lo dice». Un retiro no tiene
     * remesadora ninguna, así que pedirla dejaría trabado todo lo que no es una
     * remesa. */
    it('«POS Promerica» no pide la remesadora: la saca de la boleta', async () => {
        await abrir();
        await elegirMotivo('POS Promerica');
        expect(screen.queryByLabelText('Remesadora')).toBeNull();
        expect(screen.queryByText('Remesadora')).toBeNull();

        await elegirFoto();
        // Sale de la boleta, normalizada contra el catálogo: el papel dice la
        // red en el detalle y arriba lleva el banco del POS.
        fireEvent.click(screen.getByRole('button', { name: /Registrar e imprimir/i }));
        await act(async () => {});
        expect(registrarSalida.mock.calls[0][0].entidad).toBe('RIA');
    });

    /* ── El papel escribe «MONEY GRAM WS» y el catálogo dice «MONEYGRAM» ────
     * Medido sobre las boletas guardadas: la red se imprime de las dos formas,
     * y con el espacio en el medio ninguna contiene a la otra — 4 de las 10
     * remesas de MoneyGram se quedaban sin remesadora. Mientras se elegía a
     * mano no se notaba; desde que la dice el papel, se guarda vacía. */
    it('«Money Gram WS» impreso se guarda como MONEYGRAM', async () => {
        leerBoleta.mockResolvedValueOnce({
            leido: { es_boleta: true, legible: true, monto: 100, numero_boleta: '000318',
                     tipo_operacion: 'REMESA', red_remesas: null,
                     entidad: 'Banco Promerica',
                     nombres: ['Banco Promerica', 'Farmacia La Salud', 'Money Gram WS'] },
            coincide: {}, veredicto: 'OK', avisos: [],
        });
        await abrir();
        await elegirMotivo('POS Promerica');
        await elegirFoto();

        fireEvent.click(screen.getByRole('button', { name: /Registrar e imprimir/i }));
        await act(async () => {});
        expect(registrarSalida.mock.calls[0][0].entidad).toBe('MONEYGRAM');
    });

    /* ── Y un papel que NO es de una remesa no deja remesadora ──────────────
     * «RIA» tiene tres letras y la búsqueda es por contención, así que
     * **«FERRETERIA» la contiene**: una compra quedaba con remesadora RIA. Con
     * el campo a la vista alguien lo corregía; sin campo, se guarda y nadie lo
     * ve. Por eso primero se pregunta si el papel dice que es una remesa. */
    it('un papel que no es de una remesa no deja remesadora', async () => {
        leerBoleta.mockResolvedValueOnce({
            leido: { es_boleta: true, legible: true, monto: 2, numero_boleta: '000901',
                     tipo_operacion: 'COMPRA', red_remesas: null,
                     entidad: 'FERRETERIA DON GENARO',
                     nombres: ['FERRETERIA DON GENARO', 'CONSTRUCCIONES PEREZ'] },
            coincide: {}, veredicto: 'OK', avisos: [],
        });
        await abrir();
        await elegirMotivo('POS Promerica');
        await elegirFoto();

        expect(screen.getByLabelText('Qué fue').value).toBe('Compra en FERRETERIA DON GENARO');

        fireEvent.click(screen.getByRole('button', { name: /Registrar e imprimir/i }));
        await act(async () => {});
        expect(registrarSalida.mock.calls[0][0].entidad).toBe('');
    });

    /* ── Y el concepto lo escribe el papel ──────────────────────────────────
     * «El concepto que se llene solo según el voucher de la foto, junto al
     * número de boleta y monto». Queda ABIERTO a propósito: el monto y el
     * número los coteja el servidor contra el papel, esto es una frase
     * derivada y hay que poder agregarle lo que el papel no dice. */
    it('la boleta llena «Qué fue», y el campo queda abierto', async () => {
        await abrir();
        await elegirMotivo('POS Promerica');
        await elegirFoto();

        const campo = screen.getByLabelText('Qué fue');
        expect(campo.value).toBe('Remesa RIA');
        expect(campo.readOnly).toBe(false);

        fireEvent.change(campo, { target: { value: 'Remesa RIA · retira don Ruti' } });
        await act(async () => {});
        fireEvent.click(screen.getByRole('button', { name: /Registrar e imprimir/i }));
        await act(async () => {});
        expect(registrarSalida.mock.calls[0][0].nota).toBe('Remesa RIA · retira don Ruti');
    });

    // ── El cartel rojo imposible (2026-08-21) ──────────────────────────────
    // «La boleta dice $100.00 y la salida es de $100.00», con el botón trabado.
    // El veredicto se había calculado contra CERO: el campo del monto estaba
    // vacío y `Number('')` es 0, no NaN, así que pasaba el filtro de «¿hay un
    // número?» y viajaba como monto esperado de $0.00.
    it('la foto se lee con el monto VACÍO: no viaja un cero que nadie escribió', async () => {
        await abrir();
        await elegirMotivo('POS Promerica');
        await elegirFoto();

        expect(leerBoleta).toHaveBeenCalledTimes(1);
        const esperado = leerBoleta.mock.calls[0][1];
        expect(esperado.monto).toBeNull();
        expect(esperado.numeroBoleta).toBeNull();
        // Y el motivo tampoco viaja: «POS Promerica» nombra el aparato, no la
        // operación, así que no hay nada que el papel tenga que confirmar.
        expect(esperado.tipo).toBeUndefined();
    });

    // Regla del usuario: «la única forma en que no quede informativo es si la
    // foto no logra distinguir el monto o boleta».
    it('lo que la boleta dijo se muestra como dato y no se puede escribir encima', async () => {
        await abrir();
        await elegirMotivo('POS Promerica');
        await elegirFoto();

        // El monto se busca DENTRO de su tarjeta: «Sale de» también dice
        // $100.00, que es de dónde sale el dinero y no lo que dijo el papel.
        expect(tarjeta('Cuánto').textContent).toContain('$100.00');
        expect(tarjeta('Número de boleta').textContent).toContain('000318');
        // Y ninguno de los dos es un campo de escritura.
        expect(screen.queryByLabelText(/Cuánto/i)).toBeNull();
        expect(screen.queryByLabelText('Número de boleta')).toBeNull();
    });

    // La otra mitad de la regla: si el lector no distinguió un dato, ahí sí se
    // escribe a mano — con su aviso, para que nadie lo deje vacío sin verlo.
    it('lo que la boleta no dejó leer se pide a mano', async () => {
        leerBoleta.mockResolvedValueOnce({
            leido: { es_boleta: true, legible: true, monto: 100, numero_boleta: null },
            coincide: { entidad: null, numeroBoleta: null, monto: null },
            veredicto: 'OK', avisos: [],
        });
        await abrir();
        await elegirMotivo('POS Promerica');
        await elegirFoto();

        expect(tarjeta('Cuánto').textContent).toContain('$100.00');
        expect(screen.getByLabelText('Número de boleta')).toBeTruthy();
        expect(screen.getByText(/no dejó leer el número/i)).toBeTruthy();
    });

    // Un motivo con receptor no se registra desde el formulario: primero hay
    // que identificar a quien se lo lleva, y eso es un paso propio (el lector
    // es un `keydown` global y no puede convivir con campos de texto).
    it('«Gasto» manda a identificar antes de registrar', async () => {
        await abrir();
        await elegirMotivo('Gasto o compra urgente');
        await escribirMonto('40');

        expect(screen.queryByRole('button', { name: /Registrar e imprimir/i })).toBeNull();
        const seguir = screen.getByRole('button', { name: /Continuar/i });
        expect(seguir.disabled).toBe(false);

        fireEvent.click(seguir);
        await act(async () => {});

        // Segundo paso: el formulario ya no está y el botón no puede escribir
        // hasta que haya alguien reconocido.
        expect(screen.queryByLabelText(/Cuánto/i)).toBeNull();
        expect(screen.getByText(/Falta identificar a quien se lo lleva/i)).toBeTruthy();
        expect(screen.getByRole('button', { name: /Registrar e imprimir/i }).disabled).toBe(true);
        expect(registrarSalida).not.toHaveBeenCalled();
    });

    // La coma del teclado en español no puede perderse: es dinero.
    it('el monto acepta coma y la guarda con punto', async () => {
        await abrir();
        await elegirMotivo('Pago a proveedor');
        fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'Droguería X' } });
        await escribirMonto('120,50');

        expect(screen.getByLabelText(/Cuánto/i).value).toBe('120.50');

        fireEvent.click(screen.getByRole('button', { name: /Registrar e imprimir/i }));
        await act(async () => {});
        expect(registrarSalida.mock.calls[0][0].monto).toBe(120.5);
    });
});
