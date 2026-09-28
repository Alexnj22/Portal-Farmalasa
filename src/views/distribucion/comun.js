// Rótulos y reglas de pantalla compartidos por las pestañas de Distribución.
//
// La pantalla habla del PORTAL (CLAUDE.md): «Enviado a Hacienda» sí, porque
// Hacienda es a quien el cliente le reclama; pero nunca «API», «token», «JWS» ni
// el nombre de ningún sistema de origen.

export const TIPO_DOCUMENTO = {
    '01': { corto: 'Factura', largo: 'Factura' },
    '03': { corto: 'CCF', largo: 'Crédito Fiscal' },
    '04': { corto: 'Remisión', largo: 'Nota de Remisión' },
    '05': { corto: 'N. crédito', largo: 'Nota de Crédito' },
    '06': { corto: 'N. débito', largo: 'Nota de Débito' },
};

// El estado que importa es si Hacienda lo SELLÓ. Todo lo demás es «todavía no
// cuenta» con distinto motivo, y el rótulo dice cuál.
export const ESTADO_DOCUMENTO = {
    sin_firmar:   { variant: 'warning', label: 'Falta la firma',  ayuda: 'Guardado. Se firma y se envía cuando esté el certificado.' },
    firmado:      { variant: 'warning', label: 'Por enviar',      ayuda: 'Firmado y todavía sin sello de Hacienda.' },
    contingencia: { variant: 'warning', label: 'Sin conexión',    ayuda: 'Se emitió sin poder enviarlo; va en el próximo aviso de contingencia.' },
    sellado:      { variant: 'success', label: 'Sellado',         ayuda: 'Hacienda lo recibió y lo selló.' },
    rechazado:    { variant: 'danger',  label: 'Rechazado',       ayuda: 'Hacienda no lo aceptó. Se corrige y se emite uno nuevo.' },
    invalidado:   { variant: 'neutral', label: 'Invalidado',      ayuda: 'Anulado ante Hacienda.' },
    descartado:   { variant: 'neutral', label: 'Descartado',      ayuda: 'Nunca llegó a Hacienda y se retiró para corregir el pedido.' },
};

export const ESTADO_PEDIDO = {
    // «Preventa»: guardada sin facturar (así la llama quien vende en ruta).
    confirmado: { variant: 'info',    label: 'Preventa' },
    facturado:  { variant: 'success', label: 'Facturado' },
    entregado:  { variant: 'success', label: 'Entregado' },
    anulado:    { variant: 'neutral', label: 'Anulado' },
};

export const TIPO_CLIENTE = [
    { value: 'tienda',       label: 'Tienda' },
    { value: 'supermercado', label: 'Supermercado' },
    { value: 'farmacia',     label: 'Farmacia' },
    { value: 'otro',         label: 'Otro' },
];
export const rotuloTipoCliente = (t) => TIPO_CLIENTE.find(x => x.value === t)?.label ?? t;

/** A tiendas y supermercados sólo va venta libre (Ley de Medicamentos art. 57 b). */
export const soloVentaLibre = (tipoCliente) => tipoCliente === 'tienda' || tipoCliente === 'supermercado';

export const FORMA_PAGO = [
    { value: '01', label: 'Efectivo' },
    { value: '05', label: 'Transferencia o depósito' },
    { value: '04', label: 'Cheque' },
    { value: '02', label: 'Tarjeta de débito' },
    { value: '03', label: 'Tarjeta de crédito' },
];

export const DOC_IDENTIDAD = [
    { value: '36', label: 'NIT' },
    { value: '13', label: 'DUI' },
    { value: '03', label: 'Pasaporte' },
    { value: '02', label: 'Carné de residente' },
    { value: '37', label: 'Otro' },
];

/**
 * Un monto escrito por una persona → número, o null si no es un monto.
 * Acepta coma o punto decimal («1,20» y «1.20»): el campo de dinero del
 * navegador no tiene separador decimal fijo, por eso nunca es `type="number"`.
 */
export function leerMonto(texto) {
    const t = String(texto ?? '').trim().replace(/\s/g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
    return Number(t);
}

/**
 * El catálogo de actividades económicas de Hacienda (CAT-019), cargado con
 * `import()` la primera vez que un formulario lo pide: ~50 kB que no tienen por
 * qué viajar con la vista. Si falla, la próxima llamada reintenta.
 */
let actividadesPromesa = null;
export function cargarActividades() {
    if (!actividadesPromesa) {
        actividadesPromesa = import('@nucleo/data/actividadesMH')
            .then(m => m.ACTIVIDADES_MH.map(([value, label]) => ({ value, label: `${value} · ${label}`, desc: label })))
            .catch(e => { actividadesPromesa = null; throw e; });
    }
    return actividadesPromesa;
}
