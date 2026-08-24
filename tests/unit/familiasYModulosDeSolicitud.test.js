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
import { MODULO_QUE_DECIDE } from '../../src/constants/solicitudModulos';
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
            expect(modulo).toMatch(/^requests_[a-z]+$/);
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
