import { describe, it, expect } from 'vitest';
import { salaQueEspera } from '../../src/views/solicitudes/movimientoTexto';

// El traslado de Rodrigo, tal como está en producción: lo pide Salud 3 y lo
// tiene que entregar Salud 5. `branch_id` es la sala que PIDIÓ y
// `origen_branch_id` la que ENTREGA — la que espera es la segunda, y confundir
// una con la otra pondría en la tarjeta la sala de quien ya hizo su parte.
const TRASLADO = {
    type: 'INVENTORY_TRANSFER_REQUEST',
    status: 'PENDING',
    metadata: {
        branch_id: '27',        branch_name: 'Salud 3',
        origen_branch_id: '29', origen_branch_name: 'Salud 5',
    },
};

describe('salaQueEspera — de quién es el turno de contestar', () => {
    it('un traslado pendiente lo espera la sala que TIENE el producto', () => {
        expect(salaQueEspera(TRASLADO)).toBe('Salud 5');
    });

    // Es la parte sutil: una vez decidida, `approver_id` deja de ser «uno de los
    // destinatarios» y pasa a ser quien de verdad la resolvió —lo escribe
    // `aplicar-traslado-inventario` con el id de quien apretó—. Ahí el nombre y
    // la cara son el dato, y taparlos con el nombre de la sala sería perder
    // quién lo hizo.
    for (const status of ['APPROVED', 'REJECTED', 'CANCELLED']) {
        it(`ya ${status.toLowerCase()}, vuelve a mandar la persona`, () => {
            expect(salaQueEspera({ ...TRASLADO, status })).toBeNull();
        });
    }

    it('las otras familias no se tocan: siguen mostrando a su aprobador', () => {
        expect(salaQueEspera({ ...TRASLADO, type: 'INVENTORY_DISCARD_REQUEST' })).toBeNull();
        expect(salaQueEspera({ ...TRASLADO, type: 'ANNULMENT_REQUEST' })).toBeNull();
        expect(salaQueEspera({ ...TRASLADO, type: 'VACATION' })).toBeNull();
    });

    // Sin el nombre guardado no se inventa un rótulo: se devuelve null y la
    // tarjeta cae a la persona, que es peor pero es cierto. Un traslado viejo
    // podría no tenerlo.
    it('sin nombre de sala en el metadata, no fuerza nada', () => {
        expect(salaQueEspera({ ...TRASLADO, metadata: { branch_name: 'Salud 3' } })).toBeNull();
        expect(salaQueEspera({ ...TRASLADO, metadata: { origen_branch_name: '   ' } })).toBeNull();
        expect(salaQueEspera({ ...TRASLADO, metadata: null })).toBeNull();
        expect(salaQueEspera(null)).toBeNull();
    });
});
