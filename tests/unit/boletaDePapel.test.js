import { describe, expect, it } from 'vitest';
import { documentoDeBoletas } from '@nucleo/utils/boletaDePapel';

describe('boletaDePapel', () => {
    it('convierte las horas extra en dinero y arma una página por boleta', () => {
        const fila = { employee: { name: 'Ana Pérez', base_salary: 600 }, extra_hours_diurnal: 3, net_pay: 100, days_worked: 15 };
        const html = documentoDeBoletas([fila, fila], { start_date: '2026-10-01', end_date: '2026-10-15' }, []);
        expect(html).toContain('$15.00');                       // 3 h × 2.50 × 2
        expect(html.match(/BOLETA DE PAGO/g)).toHaveLength(2);
        expect(html.match(/class="pb"/g)).toHaveLength(1);      // salto entre las dos, no al final
    });
    it('escapa el texto libre', () => {
        const html = documentoDeBoletas([{ employee: {}, viaticos_detail: '<script>x</script>' }], {}, []);
        expect(html).not.toContain('<script>x');
    });
});
