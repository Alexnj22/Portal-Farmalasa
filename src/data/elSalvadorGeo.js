// División territorial de El Salvador — los TRES niveles.
//
// Desde la Ley Especial para la Reestructuración Municipal (junio 2023, vigente
// desde el 1-may-2024) el país tiene 14 departamentos, **44 municipios** y
// **262 distritos**. Los 262 distritos son los municipios de antes: conservaron
// su nombre, y lo que cambió es que ahora cuelgan de uno de los 44.
//
// Por eso este archivo tiene dos mapas y no uno: `EL_SALVADOR_GEO` ya existía y
// llega hasta el segundo nivel (lo usan `EmployeeFormModal` y `FormSucursal`),
// y el tercero faltaba. La ficha fiscal de un cliente sí lo necesita — el ERP
// pide departamento, municipio Y distrito.
//
// ── Por qué el distrito se guarda por NOMBRE ──────────────────────────────
// El ERP identifica los distritos con ids que **no son globales**: van por
// (departamento, municipio). El `8` es MEJICANOS en San Salvador y DULCE NOMBRE
// DE MARÍA en Chalatenango. Guardar ese id acá sería guardar un número que solo
// significa algo dentro de un combo del ERP. El nombre, en cambio, es estable, y
// el id se resuelve contra la lista del municipio al momento de escribir (Fase 2).
//
// Ojo para esa Fase 2: el ERP escribe varios de estos nombres **abreviados y en
// mayúscula** ("NVA CONCEPCIÓN", "SAN ANT RANCHOS", "SAN I LABRADOR",
// "SAN J CANCASQUE"). El emparejamiento contra esta lista tiene que ser
// normalizado (sin tildes, sin mayúsculas, tolerante a la abreviatura), nunca
// por igualdad de cadena.

export const EL_SALVADOR_GEO = {
    "Ahuachapán": ["Ahuachapán Norte", "Ahuachapán Centro", "Ahuachapán Sur"],
    "Santa Ana": ["Santa Ana Norte", "Santa Ana Centro", "Santa Ana Este", "Santa Ana Oeste"],
    "Sonsonate": ["Sonsonate Norte", "Sonsonate Centro", "Sonsonate Este", "Sonsonate Oeste"],
    "Chalatenango": ["Chalatenango Norte", "Chalatenango Centro", "Chalatenango Sur"],
    "La Libertad": ["La Libertad Norte", "La Libertad Centro", "La Libertad Oeste", "La Libertad Este", "La Libertad Sur", "La Libertad Costa"],
    "San Salvador": ["San Salvador Norte", "San Salvador Oeste", "San Salvador Este", "San Salvador Centro", "San Salvador Sur"],
    "Cuscatlán": ["Cuscatlán Norte", "Cuscatlán Sur"],
    "La Paz": ["La Paz Oeste", "La Paz Centro", "La Paz Este"],
    "Cabañas": ["Cabañas Este", "Cabañas Oeste"],
    "San Vicente": ["San Vicente Norte", "San Vicente Sur"],
    "Usulután": ["Usulután Norte", "Usulután Este", "Usulután Oeste"],
    "San Miguel": ["San Miguel Norte", "San Miguel Centro", "San Miguel Oeste"],
    "Morazán": ["Morazán Norte", "Morazán Sur"],
    "La Unión": ["La Unión Norte", "La Unión Sur"]
};

// Municipio → sus distritos. Va indexado por municipio y no anidado bajo el
// departamento porque **los 44 nombres de municipio son únicos en todo el país**
// (todos son "<Departamento> <punto cardinal>"), así que un solo nivel alcanza y
// no hay que acarrear el departamento para hacer la búsqueda.
//
// Esa misma regla es la que deja deducir el departamento desde el municipio
// (`departamentoDeMunicipio` abajo) — útil porque en `customers` hay fichas con
// municipio y sin departamento.
export const EL_SALVADOR_DISTRITOS = {
    // ── Ahuachapán (12) ──
    "Ahuachapán Norte": ["Atiquizaya", "El Refugio", "San Lorenzo", "Turín"],
    "Ahuachapán Centro": ["Ahuachapán", "Apaneca", "Concepción de Ataco", "Tacuba"],
    "Ahuachapán Sur": ["Guaymango", "Jujutla", "San Francisco Menéndez", "San Pedro Puxtla"],

    // ── Santa Ana (13) ──
    "Santa Ana Norte": ["Masahuat", "Metapán", "Santa Rosa Guachipilín", "Texistepeque"],
    "Santa Ana Centro": ["Santa Ana"],
    "Santa Ana Este": ["Coatepeque", "El Congo"],
    "Santa Ana Oeste": ["Candelaria de la Frontera", "Chalchuapa", "El Porvenir", "San Antonio Pajonal", "San Sebastián Salitrillo", "Santiago de la Frontera"],

    // ── Sonsonate (16) ──
    "Sonsonate Norte": ["Juayúa", "Nahuizalco", "Salcoatitán", "Santa Catarina Masahuat"],
    "Sonsonate Centro": ["Nahulingo", "San Antonio del Monte", "Santo Domingo de Guzmán", "Sonsonate", "Sonzacate"],
    "Sonsonate Este": ["Armenia", "Caluco", "Cuisnahuat", "Izalco", "San Julián", "Santa Isabel Ishuatán"],
    "Sonsonate Oeste": ["Acajutla"],

    // ── Chalatenango (33) ──
    "Chalatenango Norte": ["Citalá", "La Palma", "San Ignacio"],
    "Chalatenango Centro": ["Agua Caliente", "Dulce Nombre de María", "El Paraíso", "La Reina", "Nueva Concepción", "San Fernando", "San Francisco Morazán", "San Rafael", "Santa Rita", "Tejutla"],
    "Chalatenango Sur": ["Arcatao", "Azacualpa", "Chalatenango", "Comalapa", "Concepción Quezaltepeque", "El Carrizal", "La Laguna", "Las Flores", "Las Vueltas", "Nombre de Jesús", "Nueva Trinidad", "Ojos de Agua", "Potonico", "San Antonio de la Cruz", "San Antonio Los Ranchos", "San Francisco Lempa", "San Isidro Labrador", "San José Cancasque", "San Luis del Carmen", "San Miguel de Mercedes"],

    // ── La Libertad (22) ──
    "La Libertad Norte": ["Quezaltepeque", "San Matías", "San Pablo Tacachico"],
    "La Libertad Centro": ["Ciudad Arce", "San Juan Opico"],
    "La Libertad Oeste": ["Colón", "Jayaque", "Sacacoyo", "Talnique", "Tepecoyo"],
    "La Libertad Este": ["Antiguo Cuscatlán", "Huizúcar", "Nuevo Cuscatlán", "San José Villanueva", "Zaragoza"],
    "La Libertad Costa": ["Chiltiupán", "Jicalapa", "La Libertad", "Tamanique", "Teotepeque"],
    "La Libertad Sur": ["Comasagua", "Santa Tecla"],

    // ── San Salvador (19) ──
    "San Salvador Norte": ["Aguilares", "El Paisnal", "Guazapa"],
    "San Salvador Oeste": ["Apopa", "Nejapa"],
    "San Salvador Este": ["Ilopango", "San Martín", "Soyapango", "Tonacatepeque"],
    "San Salvador Centro": ["Ayutuxtepeque", "Cuscatancingo", "Delgado", "Mejicanos", "San Salvador"],
    "San Salvador Sur": ["Panchimalco", "Rosario de Mora", "San Marcos", "Santiago Texacuangos", "Santo Tomás"],

    // ── Cuscatlán (16) ──
    "Cuscatlán Norte": ["Oratorio de Concepción", "San Bartolomé Perulapía", "San José Guayabal", "San Pedro Perulapán", "Suchitoto"],
    "Cuscatlán Sur": ["Candelaria", "Cojutepeque", "El Carmen", "El Rosario", "Monte San Juan", "San Cristóbal", "San Rafael Cedros", "San Ramón", "Santa Cruz Analquito", "Santa Cruz Michapa", "Tenancingo"],

    // ── La Paz (22) ──
    "La Paz Oeste": ["Cuyultitán", "Olocuilta", "San Francisco Chinameca", "San Juan Talpa", "San Luis Talpa", "San Pedro Masahuat", "Tapalhuaca"],
    "La Paz Centro": ["El Rosario", "Jerusalén", "Mercedes La Ceiba", "Paraíso de Osorio", "San Antonio Masahuat", "San Emigdio", "San Juan Tepezontes", "San Luis La Herradura", "San Miguel Tepezontes", "San Pedro Nonualco", "Santa María Ostuma", "Santiago Nonualco"],
    "La Paz Este": ["San Juan Nonualco", "San Rafael Obrajuelo", "Zacatecoluca"],

    // ── Cabañas (9) ──
    "Cabañas Este": ["Dolores", "Guacotecti", "San Isidro", "Sensuntepeque", "Victoria"],
    "Cabañas Oeste": ["Cinquera", "Ilobasco", "Jutiapa", "Tejutepeque"],

    // ── San Vicente (13) ──
    "San Vicente Norte": ["Apastepeque", "San Esteban Catarina", "San Ildefonso", "San Lorenzo", "San Sebastián", "Santa Clara", "Santo Domingo"],
    "San Vicente Sur": ["Guadalupe", "San Cayetano Istepeque", "San Vicente", "Tecoluca", "Tepetitán", "Verapaz"],

    // ── Usulután (23) ──
    "Usulután Norte": ["Alegría", "Berlín", "El Triunfo", "Estanzuelas", "Jucuapa", "Mercedes Umaña", "Nueva Granada", "San Buenaventura", "Santiago de María"],
    "Usulután Este": ["California", "Concepción Batres", "Ereguayquín", "Jucuarán", "Ozatlán", "San Dionisio", "Santa Elena", "Santa María", "Tecapán", "Usulután"],
    "Usulután Oeste": ["Jiquilisco", "Puerto El Triunfo", "San Agustín", "San Francisco Javier"],

    // ── San Miguel (20) ──
    "San Miguel Norte": ["Carolina", "Chapeltique", "Ciudad Barrios", "Nuevo Edén de San Juan", "San Antonio", "San Gerardo", "San Luis de la Reina", "Sesori"],
    "San Miguel Centro": ["Chirilagua", "Comacarán", "Moncagua", "Quelepa", "San Miguel", "Uluazapa"],
    "San Miguel Oeste": ["Chinameca", "El Tránsito", "Lolotique", "Nueva Guadalupe", "San Jorge", "San Rafael Oriente"],

    // ── Morazán (26) ──
    "Morazán Norte": ["Arambala", "Cacaopera", "Corinto", "El Rosario", "Joateca", "Jocoaitique", "Meanguera", "Perquín", "San Fernando", "San Isidro", "Torola"],
    "Morazán Sur": ["Chilanga", "Delicias de Concepción", "El Divisadero", "Gualococti", "Guatajiagua", "Jocoro", "Lolotiquillo", "Osicala", "San Carlos", "San Francisco Gotera", "San Simón", "Sensembra", "Sociedad", "Yamabal", "Yoloaiquín"],

    // ── La Unión (18) ──
    "La Unión Norte": ["Anamorós", "Bolívar", "Concepción de Oriente", "El Sauce", "Lislique", "Nueva Esparta", "Pasaquina", "Polorós", "San José", "Santa Rosa de Lima"],
    "La Unión Sur": ["Conchagua", "El Carmen", "Intipucá", "La Unión", "Meanguera del Golfo", "San Alejo", "Yayantique", "Yucuaiquín"],
};

export const DEPARTAMENTOS = Object.keys(EL_SALVADOR_GEO);

// Municipio → departamento. Se arma una sola vez del mapa de arriba en vez de
// escribirse a mano: una tabla paralela es una tabla que se desincroniza.
const DEPTO_POR_MUNICIPIO = Object.fromEntries(
    Object.entries(EL_SALVADOR_GEO).flatMap(([depto, munis]) => munis.map(m => [m, depto])),
);

export const municipiosDe = (departamento) => EL_SALVADOR_GEO[departamento] || [];

export const distritosDe = (municipio) => EL_SALVADOR_DISTRITOS[municipio] || [];

/** El departamento al que pertenece un municipio, o null si no es de los 44. */
export const departamentoDeMunicipio = (municipio) => DEPTO_POR_MUNICIPIO[municipio] || null;

/**
 * Normaliza la terna (departamento, municipio, distrito) a un estado coherente.
 *
 * Es lo que hace que la cascada no pueda quedar en un estado imposible —
 * "Chalatenango Sur" dentro de "San Salvador", o un distrito que sobrevive al
 * cambio de municipio. Vive acá y no en el formulario porque el RPC de guardado
 * valida lo mismo del lado del servidor: una sola definición de "coherente".
 *
 * Además **deduce el departamento cuando falta** pero el municipio está — que es
 * el caso real de 92 fichas del catálogo, importadas del ERP sin departamento.
 */
export function normalizarGeo({ departamento, municipio, distrito } = {}) {
    let dep = departamento || null;
    let mun = municipio || null;
    let dis = distrito || null;

    if (mun && !EL_SALVADOR_DISTRITOS[mun]) mun = null;             // municipio que no existe
    if (mun) dep = departamentoDeMunicipio(mun);                     // el municipio manda sobre el departamento
    else if (dep && !EL_SALVADOR_GEO[dep]) dep = null;               // departamento que no existe
    if (!mun) dis = null;                                            // sin municipio no hay distrito
    else if (dis && !EL_SALVADOR_DISTRITOS[mun].includes(dis)) dis = null;

    return { departamento: dep, municipio: mun, distrito: dis };
}
