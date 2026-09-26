// Departamento, municipio y distrito con los CÓDIGOS de Hacienda (CAT-012,
// CAT-013 y CAT-008), que es lo que exige la dirección de un DTE.
//
// ── Por qué un archivo aparte de `elSalvadorGeo.js` ─────────────────────────
// Aquél guarda NOMBRES (es lo que escribe `customers`); un DTE pide CÓDIGOS, y
// los de municipio y distrito NO son únicos en el país: CAT-013 repite «14»
// para Ahuachapán Centro y Santa Ana Norte, y CAT-008 vuelve a «01» en cada
// departamento. Un código sin su departamento no dice nada.
//
// ── De dónde sale ──────────────────────────────────────────────────────────
// Generado el 2026-09-26 cruzando el «Catálogo actualizado del Sistema de
// Facturación v1.2» (factura.gob.sv) con los nombres de `elSalvadorGeo.js`.
// El Excel de Hacienda abrevia 51 distritos («STA ROSA GUACHI», «SAN J
// CANCASQUE»); se emparejaron por prefijo y a mano, y se revisaron uno por uno.
// Controles al generarlo: 262 de 262 distritos, ningún código repetido dentro
// de un departamento, los 44 municipios con código. Una vez emparejado NO se
// vuelve a derivar: si Hacienda publica otro catálogo, se regenera y se revisa.
//
// Distrito como [código, nombre] para que el archivo no pese el doble.

export const GEO_MH = [
    { codigo: "01", nombre: "Ahuachapán", municipios: [
        { codigo: "13", nombre: "Ahuachapán Norte", distritos: [["03", "Atiquizaya"], ["05", "El Refugio"], ["09", "San Lorenzo"], ["12", "Turín"]] },
        { codigo: "14", nombre: "Ahuachapán Centro", distritos: [["01", "Ahuachapán"], ["02", "Apaneca"], ["04", "Concepción de Ataco"], ["11", "Tacuba"]] },
        { codigo: "15", nombre: "Ahuachapán Sur", distritos: [["06", "Guaymango"], ["07", "Jujutla"], ["08", "San Francisco Menéndez"], ["10", "San Pedro Puxtla"]] },
    ] },
    { codigo: "02", nombre: "Santa Ana", municipios: [
        { codigo: "14", nombre: "Santa Ana Norte", distritos: [["06", "Masahuat"], ["07", "Metapán"], ["11", "Santa Rosa Guachipilín"], ["13", "Texistepeque"]] },
        { codigo: "15", nombre: "Santa Ana Centro", distritos: [["10", "Santa Ana"]] },
        { codigo: "16", nombre: "Santa Ana Este", distritos: [["02", "Coatepeque"], ["04", "El Congo"]] },
        { codigo: "17", nombre: "Santa Ana Oeste", distritos: [["01", "Candelaria de la Frontera"], ["03", "Chalchuapa"], ["05", "El Porvenir"], ["08", "San Antonio Pajonal"], ["09", "San Sebastián Salitrillo"], ["12", "Santiago de la Frontera"]] },
    ] },
    { codigo: "03", nombre: "Sonsonate", municipios: [
        { codigo: "17", nombre: "Sonsonate Norte", distritos: [["07", "Juayúa"], ["08", "Nahuizalco"], ["10", "Salcoatitán"], ["13", "Santa Catarina Masahuat"]] },
        { codigo: "18", nombre: "Sonsonate Centro", distritos: [["09", "Nahulingo"], ["11", "San Antonio del Monte"], ["14", "Santo Domingo de Guzmán"], ["15", "Sonsonate"], ["16", "Sonzacate"]] },
        { codigo: "19", nombre: "Sonsonate Este", distritos: [["02", "Armenia"], ["03", "Caluco"], ["04", "Cuisnahuat"], ["06", "Izalco"], ["12", "San Julián"], ["05", "Santa Isabel Ishuatán"]] },
        { codigo: "20", nombre: "Sonsonate Oeste", distritos: [["01", "Acajutla"]] },
    ] },
    { codigo: "04", nombre: "Chalatenango", municipios: [
        { codigo: "34", nombre: "Chalatenango Norte", distritos: [["04", "Citalá"], ["12", "La Palma"], ["25", "San Ignacio"]] },
        { codigo: "35", nombre: "Chalatenango Centro", distritos: [["01", "Agua Caliente"], ["08", "Dulce Nombre de María"], ["10", "El Paraíso"], ["13", "La Reina"], ["16", "Nueva Concepción"], ["22", "San Fernando"], ["24", "San Francisco Morazán"], ["31", "San Rafael"], ["32", "Santa Rita"], ["33", "Tejutla"]] },
        { codigo: "36", nombre: "Chalatenango Sur", distritos: [["02", "Arcatao"], ["03", "Azacualpa"], ["07", "Chalatenango"], ["05", "Comalapa"], ["06", "Concepción Quezaltepeque"], ["09", "El Carrizal"], ["11", "La Laguna"], ["28", "Las Flores"], ["14", "Las Vueltas"], ["15", "Nombre de Jesús"], ["17", "Nueva Trinidad"], ["18", "Ojos de Agua"], ["19", "Potonico"], ["20", "San Antonio de la Cruz"], ["21", "San Antonio Los Ranchos"], ["23", "San Francisco Lempa"], ["26", "San Isidro Labrador"], ["27", "San José Cancasque"], ["29", "San Luis del Carmen"], ["30", "San Miguel de Mercedes"]] },
    ] },
    { codigo: "05", nombre: "La Libertad", municipios: [
        { codigo: "23", nombre: "La Libertad Norte", distritos: [["12", "Quezaltepeque"], ["16", "San Matías"], ["17", "San Pablo Tacachico"]] },
        { codigo: "24", nombre: "La Libertad Centro", distritos: [["02", "Ciudad Arce"], ["15", "San Juan Opico"]] },
        { codigo: "25", nombre: "La Libertad Oeste", distritos: [["03", "Colón"], ["07", "Jayaque"], ["13", "Sacacoyo"], ["19", "Talnique"], ["21", "Tepecoyo"]] },
        { codigo: "26", nombre: "La Libertad Este", distritos: [["01", "Antiguo Cuscatlán"], ["06", "Huizúcar"], ["10", "Nuevo Cuscatlán"], ["14", "San José Villanueva"], ["22", "Zaragoza"]] },
        { codigo: "28", nombre: "La Libertad Sur", distritos: [["04", "Comasagua"], ["11", "Santa Tecla"]] },
        { codigo: "27", nombre: "La Libertad Costa", distritos: [["05", "Chiltiupán"], ["08", "Jicalapa"], ["09", "La Libertad"], ["18", "Tamanique"], ["20", "Teotepeque"]] },
    ] },
    { codigo: "06", nombre: "San Salvador", municipios: [
        { codigo: "20", nombre: "San Salvador Norte", distritos: [["01", "Aguilares"], ["05", "El Paisnal"], ["06", "Guazapa"]] },
        { codigo: "21", nombre: "San Salvador Oeste", distritos: [["02", "Apopa"], ["09", "Nejapa"]] },
        { codigo: "22", nombre: "San Salvador Este", distritos: [["07", "Ilopango"], ["13", "San Martín"], ["17", "Soyapango"], ["18", "Tonacatepeque"]] },
        { codigo: "23", nombre: "San Salvador Centro", distritos: [["03", "Ayutuxtepeque"], ["04", "Cuscatancingo"], ["19", "Delgado"], ["08", "Mejicanos"], ["14", "San Salvador"]] },
        { codigo: "24", nombre: "San Salvador Sur", distritos: [["10", "Panchimalco"], ["11", "Rosario de Mora"], ["12", "San Marcos"], ["15", "Santiago Texacuangos"], ["16", "Santo Tomás"]] },
    ] },
    { codigo: "07", nombre: "Cuscatlán", municipios: [
        { codigo: "17", nombre: "Cuscatlán Norte", distritos: [["06", "Oratorio de Concepción"], ["07", "San Bartolomé Perulapía"], ["09", "San José Guayabal"], ["10", "San Pedro Perulapán"], ["15", "Suchitoto"]] },
        { codigo: "18", nombre: "Cuscatlán Sur", distritos: [["01", "Candelaria"], ["02", "Cojutepeque"], ["03", "El Carmen"], ["04", "El Rosario"], ["05", "Monte San Juan"], ["08", "San Cristóbal"], ["11", "San Rafael Cedros"], ["12", "San Ramón"], ["13", "Santa Cruz Analquito"], ["14", "Santa Cruz Michapa"], ["16", "Tenancingo"]] },
    ] },
    { codigo: "08", nombre: "La Paz", municipios: [
        { codigo: "23", nombre: "La Paz Oeste", distritos: [["01", "Cuyultitán"], ["05", "Olocuilta"], ["09", "San Francisco Chinameca"], ["11", "San Juan Talpa"], ["13", "San Luis Talpa"], ["15", "San Pedro Masahuat"], ["20", "Tapalhuaca"]] },
        { codigo: "24", nombre: "La Paz Centro", distritos: [["02", "El Rosario"], ["03", "Jerusalén"], ["04", "Mercedes La Ceiba"], ["06", "Paraíso de Osorio"], ["07", "San Antonio Masahuat"], ["08", "San Emigdio"], ["12", "San Juan Tepezontes"], ["22", "San Luis La Herradura"], ["14", "San Miguel Tepezontes"], ["16", "San Pedro Nonualco"], ["18", "Santa María Ostuma"], ["19", "Santiago Nonualco"]] },
        { codigo: "25", nombre: "La Paz Este", distritos: [["10", "San Juan Nonualco"], ["17", "San Rafael Obrajuelo"], ["21", "Zacatecoluca"]] },
    ] },
    { codigo: "09", nombre: "Cabañas", municipios: [
        { codigo: "10", nombre: "Cabañas Este", distritos: [["09", "Dolores"], ["02", "Guacotecti"], ["05", "San Isidro"], ["06", "Sensuntepeque"], ["08", "Victoria"]] },
        { codigo: "11", nombre: "Cabañas Oeste", distritos: [["01", "Cinquera"], ["03", "Ilobasco"], ["04", "Jutiapa"], ["07", "Tejutepeque"]] },
    ] },
    { codigo: "10", nombre: "San Vicente", municipios: [
        { codigo: "14", nombre: "San Vicente Norte", distritos: [["01", "Apastepeque"], ["06", "San Esteban Catarina"], ["07", "San Ildefonso"], ["08", "San Lorenzo"], ["09", "San Sebastián"], ["04", "Santa Clara"], ["05", "Santo Domingo"]] },
        { codigo: "15", nombre: "San Vicente Sur", distritos: [["02", "Guadalupe"], ["03", "San Cayetano Istepeque"], ["10", "San Vicente"], ["11", "Tecoluca"], ["12", "Tepetitán"], ["13", "Verapaz"]] },
    ] },
    { codigo: "11", nombre: "Usulután", municipios: [
        { codigo: "24", nombre: "Usulután Norte", distritos: [["01", "Alegría"], ["02", "Berlín"], ["05", "El Triunfo"], ["07", "Estanzuelas"], ["09", "Jucuapa"], ["11", "Mercedes Umaña"], ["12", "Nueva Granada"], ["16", "San Buenaventura"], ["21", "Santiago de María"]] },
        { codigo: "25", nombre: "Usulután Este", distritos: [["03", "California"], ["04", "Concepción Batres"], ["06", "Ereguayquín"], ["10", "Jucuarán"], ["13", "Ozatlán"], ["17", "San Dionisio"], ["18", "Santa Elena"], ["20", "Santa María"], ["22", "Tecapán"], ["23", "Usulután"]] },
        { codigo: "26", nombre: "Usulután Oeste", distritos: [["08", "Jiquilisco"], ["14", "Puerto El Triunfo"], ["15", "San Agustín"], ["19", "San Francisco Javier"]] },
    ] },
    { codigo: "12", nombre: "San Miguel", municipios: [
        { codigo: "21", nombre: "San Miguel Norte", distritos: [["01", "Carolina"], ["04", "Chapeltique"], ["02", "Ciudad Barrios"], ["11", "Nuevo Edén de San Juan"], ["13", "San Antonio"], ["14", "San Gerardo"], ["16", "San Luis de la Reina"], ["19", "Sesori"]] },
        { codigo: "22", nombre: "San Miguel Centro", distritos: [["06", "Chirilagua"], ["03", "Comacarán"], ["09", "Moncagua"], ["12", "Quelepa"], ["17", "San Miguel"], ["20", "Uluazapa"]] },
        { codigo: "23", nombre: "San Miguel Oeste", distritos: [["05", "Chinameca"], ["07", "El Tránsito"], ["08", "Lolotique"], ["10", "Nueva Guadalupe"], ["15", "San Jorge"], ["18", "San Rafael Oriente"]] },
    ] },
    { codigo: "13", nombre: "Morazán", municipios: [
        { codigo: "27", nombre: "Morazán Norte", distritos: [["01", "Arambala"], ["02", "Cacaopera"], ["03", "Corinto"], ["07", "El Rosario"], ["10", "Joateca"], ["11", "Jocoaitique"], ["14", "Meanguera"], ["16", "Perquín"], ["18", "San Fernando"], ["20", "San Isidro"], ["24", "Torola"]] },
        { codigo: "28", nombre: "Morazán Sur", distritos: [["04", "Chilanga"], ["05", "Delicias de Concepción"], ["06", "El Divisadero"], ["08", "Gualococti"], ["09", "Guatajiagua"], ["12", "Jocoro"], ["13", "Lolotiquillo"], ["15", "Osicala"], ["17", "San Carlos"], ["19", "San Francisco Gotera"], ["21", "San Simón"], ["22", "Sensembra"], ["23", "Sociedad"], ["25", "Yamabal"], ["26", "Yoloaiquín"]] },
    ] },
    { codigo: "14", nombre: "La Unión", municipios: [
        { codigo: "19", nombre: "La Unión Norte", distritos: [["01", "Anamorós"], ["02", "Bolívar"], ["03", "Concepción de Oriente"], ["06", "El Sauce"], ["09", "Lislique"], ["11", "Nueva Esparta"], ["12", "Pasaquina"], ["13", "Polorós"], ["15", "San José"], ["16", "Santa Rosa de Lima"]] },
        { codigo: "20", nombre: "La Unión Sur", distritos: [["04", "Conchagua"], ["05", "El Carmen"], ["07", "Intipucá"], ["08", "La Unión"], ["10", "Meanguera del Golfo"], ["14", "San Alejo"], ["17", "Yayantique"], ["18", "Yucuaiquín"]] },
    ] },
];

const porCodigo = new Map(GEO_MH.map(d => [d.codigo, d]));

export const departamentosMH = () => GEO_MH.map(d => ({ value: d.codigo, label: d.nombre }));

export const municipiosMH = (dep) =>
    (porCodigo.get(dep)?.municipios ?? []).map(m => ({ value: m.codigo, label: m.nombre }));

export const distritosMH = (dep, mun) =>
    (porCodigo.get(dep)?.municipios.find(m => m.codigo === mun)?.distritos ?? [])
        .map(([value, label]) => ({ value, label }));

/** «Nueva Concepción, Chalatenango Centro, Chalatenango» — o null si falta un nivel. */
export function ubicacionMH(dep, mun, dis) {
    const d = porCodigo.get(dep);
    const m = d?.municipios.find(x => x.codigo === mun);
    const x = m?.distritos.find(([c]) => c === dis);
    return d && m && x ? `${x[1]}, ${m.nombre}, ${d.nombre}` : null;
}
