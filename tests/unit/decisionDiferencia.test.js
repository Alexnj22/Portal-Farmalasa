import { describe, it, expect } from 'vitest';
import { turnoDe, esCargoDeSupervision } from '../../src/utils/decisionDiferencia';

// El circuito acordado con el usuario el 2026-08-17, sobre el pedido 116 de
// La Popular: la propone la SALA, contesta BODEGA, si bodega contrapropone
// contesta la SALA, y sin acuerdo decide SUPERVISIÓN.
const SALA   = { esSala: true,  esSupervision: false };
const BODEGA = { esSala: false, esSupervision: false };
const SUPER  = { esSala: false, esSupervision: true  };

describe('turnoDe', () => {
    it('sin nada propuesto, le toca a la sala', () => {
        expect(turnoDe(null, SALA)).toBe('yo');
        expect(turnoDe(null, BODEGA)).toBe('sala');
    });

    it('sobre una propuesta de la sala contesta bodega', () => {
        expect(turnoDe('propuesta', BODEGA)).toBe('yo');
        expect(turnoDe('propuesta', SALA)).toBe('bodega');
    });

    it('sobre una contrapropuesta de bodega contesta la sala', () => {
        expect(turnoDe('contrapropuesta', SALA)).toBe('yo');
        expect(turnoDe('contrapropuesta', BODEGA)).toBe('sala');
    });

    it('sin acuerdo decide supervisión, y nadie más', () => {
        expect(turnoDe('escalada', SUPER)).toBe('yo');
        expect(turnoDe('escalada', SALA)).toBe('supervision');
        expect(turnoDe('escalada', BODEGA)).toBe('supervision');
    });

    it('supervisión puede contestar en cualquier turno — cubre a quien no está', () => {
        expect(turnoDe(null, SUPER)).toBe('yo');
        expect(turnoDe('propuesta', SUPER)).toBe('yo');
        expect(turnoDe('contrapropuesta', SUPER)).toBe('yo');
    });

    it('acordado o cerrado ya no es una respuesta que se espera', () => {
        // Lo que falta ahí es que llegue el producto o que termine el
        // movimiento, y eso lo pinta otro bloque: si esto dijera «yo», la
        // pantalla ofrecería aceptar algo que ya se aceptó.
        expect(turnoDe('acordada', SALA)).toBe('nadie');
        expect(turnoDe('acordada', BODEGA)).toBe('nadie');
        expect(turnoDe('confirmada', SUPER)).toBe('nadie');
    });

    it('sin decir quién soy, no me toca nada', () => {
        expect(turnoDe('propuesta')).toBe('yo');   // nadie es la sala → contesta el otro lado
        expect(turnoDe(null)).toBe('sala');
    });
});

describe('esCargoDeSupervision', () => {
    it('reconoce los mismos tres cargos que la base', () => {
        expect(esCargoDeSupervision('SUPERVISOR')).toBe(true);
        expect(esCargoDeSupervision('ADMIN')).toBe(true);
        expect(esCargoDeSupervision('SUPERADMIN')).toBe(true);
    });

    it('y no confunde un alcance con un cargo', () => {
        // Bodega tiene alcance «todas las salas» sobre Pedidos y NO es
        // supervisión: confundirlos fue el hueco del 2026-08-17.
        expect(esCargoDeSupervision('EMPLEADO')).toBe(false);
        expect(esCargoDeSupervision('JEFE')).toBe(false);
        expect(esCargoDeSupervision(undefined)).toBe(false);
    });
});

// El corte que ordena la lista: arriba lo que me toca, abajo lo que espero.
import { tengoAlgoQueHacer } from '../../src/utils/decisionDiferencia';

const SIN_MOVER  = { mueve: 'ninguno', cierra_con: 'llegada_sala' };
const A_BODEGA   = { mueve: 'ninguno', cierra_con: 'llegada_bodega' };
const CON_MOVIM  = { mueve: 'devolucion', cierra_con: 'entrada_bodega' };

describe('tengoAlgoQueHacer', () => {
    it('sin proponer, le toca a la sala', () => {
        expect(tengoAlgoQueHacer({ estado: null, ...SALA })).toBe(true);
        expect(tengoAlgoQueHacer({ estado: null, ...BODEGA })).toBe(false);
    });

    it('una propuesta esperando a bodega NO le pide nada a la sala', () => {
        // Es el caso que hizo cambiar el corte: agrupando por estado, esto
        // seguía arriba ocupándole el lugar a lo que sí le toca.
        expect(tengoAlgoQueHacer({ estado: 'propuesta', ...SALA })).toBe(false);
        expect(tengoAlgoQueHacer({ estado: 'propuesta', ...BODEGA })).toBe(true);
    });

    it('acordado «que lo manden»: lo firma quien lo recibe', () => {
        expect(tengoAlgoQueHacer({ estado: 'acordada', op: SIN_MOVER, ...SALA })).toBe(true);
        expect(tengoAlgoQueHacer({ estado: 'acordada', op: SIN_MOVER, ...BODEGA })).toBe(false);
    });

    it('acordado «devolver en físico»: lo firma bodega', () => {
        expect(tengoAlgoQueHacer({ estado: 'acordada', op: A_BODEGA, ...SALA })).toBe(false);
        expect(tengoAlgoQueHacer({ estado: 'acordada', op: A_BODEGA, ...BODEGA })).toBe(true);
    });

    it('con un movimiento en vuelo, lo mueve bodega', () => {
        const dev = { estado: 'aceptada' };
        expect(tengoAlgoQueHacer({ estado: 'acordada', op: CON_MOVIM, dev, ...BODEGA })).toBe(true);
        expect(tengoAlgoQueHacer({ estado: 'acordada', op: CON_MOVIM, dev, ...SALA })).toBe(false);
    });

    it('el movimiento ya recibido no le pide nada a nadie', () => {
        const dev = { estado: 'recibida' };
        expect(tengoAlgoQueHacer({ estado: 'acordada', op: CON_MOVIM, dev, ...BODEGA })).toBe(false);
    });

    it('lo cerrado nunca pide nada', () => {
        expect(tengoAlgoQueHacer({ estado: 'confirmada', ...SALA })).toBe(false);
        expect(tengoAlgoQueHacer({ estado: 'confirmada', ...SUPER })).toBe(false);
    });

    it('supervisión puede actuar en todo lo abierto — es la que destraba', () => {
        expect(tengoAlgoQueHacer({ estado: 'escalada', ...SUPER })).toBe(true);
        expect(tengoAlgoQueHacer({ estado: 'propuesta', ...SUPER })).toBe(true);
        expect(tengoAlgoQueHacer({ estado: 'acordada', op: A_BODEGA, ...SUPER })).toBe(true);
    });
});
