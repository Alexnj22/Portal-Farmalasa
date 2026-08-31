// Los datos fiscales de la empresa — los que identifican al contribuyente en un
// documento que se presenta.
//
// Están acá y no escritos dentro del PDF que los estrenó (el Corte Z) porque un
// NIT copiado en cada informe es un NIT que el día que cambie va a quedar bien
// en unos y mal en otros, sin que nada lo avise. Un solo lugar, y el que lo
// necesite lo importa.
//
// El nombre es el de la EMPRESA, no el del portal: «Farmalasa» es el software.
// Ver la memoria `reference_company_name`.
export const EMPRESA = {
    // ⚠️ `razonSocial` tiene el nombre COMERCIAL, no el del contribuyente.
    //
    // Salió a la luz el 2026-08-31, comparando contra el membrete real de la
    // empresa: el contribuyente de ese NIT es una **persona natural**, José
    // Rutilio Alemán Vásquez, y «Farmacias La Popular y La Salud» es el nombre
    // con el que opera. El NIT y el NRC de acá coinciden exactamente con los del
    // membrete, así que el dato fiscal siempre estuvo bien; lo que estaba mal
    // era el NOMBRE que lo acompaña.
    //
    // No se le cambió el valor a esta clave, y es a propósito: la leen catorce
    // sitios y en varios el nombre comercial es el correcto —lo que ve un
    // cliente en «Mis puntos», el documento de bienvenida, el ticket—. Cambiarla
    // de golpe reemplazaría el nombre en los catorce a la vez.
    //
    // 🔴 QUEDA ABIERTO y es una pregunta fiscal, no de diseño: el **Corte Z** y
    // la hoja de prueba de impresión imprimen `razonSocial` junto al NIT y al
    // NRC, o sea el nombre comercial en el lugar donde va el del contribuyente.
    // Hay que confirmarlo con quien lleva la contabilidad antes de tocarlo.
    razonSocial: 'Farmacias La Popular y La Salud',
    nit: '0401-210685-101-0',
    nrc: '213237-5',

    // ── Lo que dice el membrete real ────────────────────────────────────────
    // `patrono` es quien FIRMA una relación de trabajo. En una constancia de
    // sanción, en un contrato o en una liquidación, la contraparte del
    // trabajador es esta persona — no la marca.
    patrono: 'JOSÉ RUTILIO ALEMÁN VÁSQUEZ',
    nombreComercial: 'Farmacias La Popular y La Salud',
    giro: 'Venta de productos farmacéuticos y medicinales',
    direccion: 'Carretera a Chalatenango, Caserío Totolco, Chalatenango, Chalatenango',
    // El municipio, para el encabezado de un documento que se firma («En
    // Chalatenango, a los…»). Antes estaba escrito a mano dentro del PDF y era
    // una inferencia; ahora sale del mismo lugar que la dirección.
    municipio: 'Chalatenango',
    // El de la EMPRESA, confirmado por el usuario el 2026-08-31. El membrete
    // que sirvió de modelo era el de Farmacia La Salud y traía 7962-2719, que
    // es el de ESA sala: en un documento que emite la empresa va éste.
    //
    // Es el mismo número que `regularizar-dte` le escribe a una ficha de
    // cliente sin teléfono válido, y no es casualidad — es el número de la
    // empresa, y hasta hoy vivía sólo dentro de esa edge function.
    telefono: '2301-0013',
};
