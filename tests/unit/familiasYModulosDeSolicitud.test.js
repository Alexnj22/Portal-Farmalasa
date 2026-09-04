// Qué se puede abrir y quién puede decidirlo.
//
// Son dos listas chicas y las dos son ESPEJOS de algo que vive en la base. Un
// espejo que se desincroniza no da error: da un botón que rebota sin explicar
// nada, o uno que falta cuando sí se podía.
//
//   · `MODULO_QUE_DECIDE` es el espejo de `modulo_de_aprobacion()` en Postgres.
//     La policy rechaza igual; esto sólo evita ofrecer un botón condenado.
//   · `familiasDisponibles` decide si la vista dibuja «Nueva solicitud», y
//     pregunta por la MISMA llave que gobierna la baldosa del tablero — dos
//     interruptores para una puerta es lo que se terminó con «Mis Solicitudes».

import { describe, it, expect } from 'vitest';
import { MODULO_QUE_DECIDE, QUIEN_RESUELVE } from '../../src/constants/solicitudModulos';
import { areaQueDecide } from '../../src/views/solicitudes/movimientoTexto';
import { FAMILIAS, familiasDisponibles } from '../../src/views/solicitudes/familiasOperativas';

describe('qué módulo decide cada tipo de solicitud', () => {
    it('los cuatro tipos de facturación caen en el mismo módulo', () => {
        for (const t of ['ANNULMENT_REQUEST', 'PAYMENT_CHANGE_REQUEST',
                         'VENDOR_CHANGE_REQUEST', 'CLIENT_CHANGE_REQUEST'])
            expect(MODULO_QUE_DECIDE[t]).toBe('requests_facturacion');
    });

    it('cargar y descargar inventario los decide el mismo', () => {
        expect(MODULO_QUE_DECIDE.INVENTORY_LOAD_REQUEST).toBe('requests_inventario');
        expect(MODULO_QUE_DECIDE.INVENTORY_DISCARD_REQUEST).toBe('requests_inventario');
    });

    it('Min·Máx tiene el suyo: aprobar dejó de ser un solo interruptor', () => {
        // Desde v2.576.0 se cobra por familia, para poder delegar una parte sin
        // entregar el resto.
        expect(MODULO_QUE_DECIDE.MINMAX_CHANGE_REQUEST).toBe('requests_minmax');
    });

    it('el traslado NO figura, y esa ausencia es la regla', () => {
        // No se decide en la bandeja sino en Traslados, que relee la existencia
        // de la sala antes de despachar. Lo que no está acá cae en el módulo del
        // ámbito, igual que en la policy.
        expect(MODULO_QUE_DECIDE.INVENTORY_TRANSFER_REQUEST).toBeUndefined();
    });

    it('todo lo declarado apunta a un módulo `requests_*`', () => {
        // Un valor con otra forma no existe como módulo y la policy lo
        // rechazaría: el botón aparecería y rebotaría.
        for (const [tipo, modulo] of Object.entries(MODULO_QUE_DECIDE)) {
            expect(tipo, `${tipo} no parece un tipo de solicitud`).toMatch(/^[A-Z_]+$/);
            // `[a-z_]` y no `[a-z]`: `requests_cuentas_por_cobrar` es un
            // módulo real desde el 2-sep y el regex viejo lo rechazaba —
            // la prueba llevaba fallando desde entonces por su propia
            // forma, no por un módulo mal escrito.
            expect(modulo).toMatch(/^requests_[a-z_]+$/);
        }
    });
});

describe('a quién espera una solicitud pendiente', () => {
    /* `approver_id` es el primer destinatario del AVISO, no el dueño de la
     * decisión: la resuelve cualquiera con el permiso del módulo. Pintar su
     * cara se lee como que hay que esperar a esa persona — reportado dos veces,
     * el 3-sep sobre las del dinero y el 4-sep sobre la anulación de factura
     * («si varios tienen activados el de confirmar este tipo de solicitud, ¿por
     * qué siempre dice edwin?»). En producción esa familia la pueden resolver
     * cuatro personas y la tarjeta nombraba a una sola, siempre la misma. */
    const req = (extra) => ({ type: 'ANNULMENT_REQUEST', status: 'PENDING', ...extra });

    it('nombra el área cuando pueden resolverla varios', () => {
        expect(areaQueDecide(req({ metadata: { aprobadores_n: 4 } })))
            .toBe('Quien apruebe facturación');
    });

    it('con uno solo nombra a la persona: se sabe a quién ir a buscar', () => {
        expect(areaQueDecide(req({ metadata: { aprobadores_n: 1 } }))).toBeNull();
    });

    it('sin el dato asume que son varios', () => {
        // Las filas anteriores al trigger que lo escribe no lo tienen. Nombrar
        // a alguien que no es el único es el error caro; decir el área de más
        // sólo pierde una cara.
        expect(areaQueDecide(req({ metadata: {} }))).toBe('Quien apruebe facturación');
        expect(areaQueDecide(req({}))).toBe('Quien apruebe facturación');
    });

    it('`metadata` como TEXTO se parsea antes de leerla', () => {
        // Llega así según por dónde entró la fila, y `'{"a":1}'.aprobadores_n`
        // es `undefined` sin quejarse: sin el parseo diría el área siempre.
        expect(areaQueDecide(req({ metadata: '{"aprobadores_n":1}' }))).toBeNull();
        expect(areaQueDecide(req({ metadata: 'no es json' })))
            .toBe('Quien apruebe facturación');
    });

    it('ya decidida vuelve a ser una persona, con su cara y su hora', () => {
        // Ahí `approver_id` deja de ser un destinatario: lo firma
        // `firmar_quien_decide` con `auth_employee_id()`.
        for (const status of ['APPROVED', 'REJECTED', 'CANCELLED'])
            expect(areaQueDecide(req({ status, metadata: { aprobadores_n: 4 } }))).toBeNull();
    });

    it('un traslado no cae acá: lo espera una SALA, no un módulo', () => {
        expect(areaQueDecide({ type: 'INVENTORY_TRANSFER_REQUEST', status: 'PENDING' }))
            .toBeNull();
    });

    it('las nueve que se deciden por permiso tienen su área escrita', () => {
        // Es el mismo alcance que `modulo_de_aprobacion()` en Postgres, que
        // devuelve NULL para todo lo demás. Una solicitud personal la resuelve
        // una jefatura concreta y ahí el nombre ES el dato.
        expect(Object.keys(QUIEN_RESUELVE).sort()).toEqual([
            'ABONO_APROBACION', 'ABONO_CREDITO_CHANGE', 'ANNULMENT_REQUEST',
            'CAJA_MOVIMIENTO_CHANGE', 'CLIENT_CHANGE_REQUEST',
            'INVENTORY_DISCARD_REQUEST', 'INVENTORY_LOAD_REQUEST',
            'PAYMENT_CHANGE_REQUEST', 'VENDOR_CHANGE_REQUEST',
        ]);
    });

    it('ninguna área nombra a una persona ni a un sistema de origen', () => {
        for (const area of Object.values(QUIEN_RESUELVE)) {
            expect(area).toMatch(/^Quien /);
            expect(area).not.toMatch(/ERP|erp/);
        }
    });
});

describe('las familias que se pueden abrir desde «Nueva solicitud»', () => {
    it('son cuatro, y hablan de la sala', () => {
        expect(FAMILIAS.map(f => f.key)).toEqual(['inventario', 'facturacion', 'minmax', 'traslado']);
    });

    it('«Pedir a otra sala» usa la llave de la consulta de inventario', () => {
        // Es la MISMA capacidad y la MISMA pantalla: `FormularioPedirASala` es
        // el cuerpo de la consulta del tablero. Una llave nueva sería un segundo
        // interruptor para una puerta que ya tiene el suyo.
        expect(FAMILIAS.find(f => f.key === 'traslado').permiso).toBe('dash_inv_search');
    });

    it('cada familia pregunta por una llave del tablero', () => {
        // El prefijo `dash_` es herencia de haber nacido ahí, no una decisión de
        // este archivo — pero si alguna dejara de tenerlo, estaría preguntando
        // por una llave que la baldosa no usa y las dos puertas se separarían.
        for (const f of FAMILIAS) expect(f.permiso).toMatch(/^dash_/);
    });

    it('ningún rótulo dice «traslado» al que lo pide', () => {
        // Quien lo pide está pensando en que le falta un producto, no en el
        // nombre del movimiento. El módulo sigue llamándose Traslados donde se
        // administra.
        const t = FAMILIAS.find(f => f.key === 'traslado');
        expect(`${t.label} ${t.desc}`.toLowerCase()).not.toContain('traslad');
    });

    it('ningún rótulo nombra el sistema de origen', () => {
        for (const f of FAMILIAS) {
            const texto = `${f.label} ${f.desc}`;
            expect(texto).not.toMatch(/\bERP\b/i);
            expect(texto.toLowerCase()).not.toMatch(/sincroniz/);
        }
    });

    it('no hay dos familias del mismo color en la misma lista', () => {
        // Conviven las cuatro en un solo menú: dos del mismo color dejan de
        // distinguirse. Por eso «Pedir a otra sala» es `chart-3` y no el
        // `warning` que tiene su baldosa en el tablero.
        const colores = FAMILIAS.map(f => f.color);
        expect(new Set(colores).size).toBe(colores.length);
    });

    it('se muestran sólo las que la persona puede ver', () => {
        const puede = (llave, accion) => accion === 'can_view' && llave === 'dash_minmax_req';
        expect(familiasDisponibles(puede).map(f => f.key)).toEqual(['minmax']);
    });

    it('sin ningún permiso no queda ninguna — y ahí no se dibuja el botón', () => {
        expect(familiasDisponibles(() => false)).toEqual([]);
    });

    it('pregunta por `can_view`, no por `can_edit`', () => {
        const vistas = [];
        familiasDisponibles((llave, accion) => { vistas.push(accion); return false; });
        expect(new Set(vistas)).toEqual(new Set(['can_view']));
    });
});
