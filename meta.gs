function extraerVentasDesdePDF_Totales(pdfBlob, nombreSucursal) {
  var tempFile = DriveApp.createFile(pdfBlob);
  var resource = { title: "TMP(" + nombreSucursal + ")", mimeType: MimeType.GOOGLE_DOCS };
  var docFile = Drive.Files.copy(resource, tempFile.getId(), { convert: true });
  var texto = DocumentApp.openById(docFile.id).getBody().getText();
  DriveApp.getFileById(docFile.id).setTrashed(true);
  tempFile.setTrashed(true);

  var ultPos = texto.lastIndexOf("TOTALES");
  if (ultPos === -1) return [];
  var bloque = texto.slice(ultPos);
  bloque = bloque.replace(/^TOTALES\s*/i, '');

  var acumulados = {};   // { codigo: { nombre: '...', monto: ... } }

  bloque.split(/\r?\n/).forEach(function (line) {
    line = line.trim();
    if (!line || line.match(/^Fecha de impresión/i) || line.match(/página/i)) return;

    // Ej: 0116 BRISSA.SALAZAR   $ 16.65
    var m = line.match(/^(\d+)\s+([^\$]*)\$\s*([\d.,]+)/);
    if (m) {
      var codigoRaw = m[1];
      var codigoNorm = String(parseInt(codigoRaw, 10)); // quita ceros a la izquierda
      var nombre = (m[2] || "").trim();
      var monto = parseFloat(m[3].replace(/,/g, "")) || 0;

      // si ya existe el código normalizado, acumular
      if (acumulados[codigoNorm]) {
        acumulados[codigoNorm].monto += monto;
      } else {
        acumulados[codigoNorm] = { nombre: nombre, monto: monto };
      }
    }
  });

  // convertir a array
  var ventas = [];
  for (var cod in acumulados) {
    ventas.push([cod, acumulados[cod].nombre, acumulados[cod].monto]);
  }
  return ventas;
}

function llenarMontosSucursalEnHojaMensualSoloTotales(mes, nombreSucursal, ventas, montosDomicilioPorSucursal) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(mes);
  if (!hoja) {
    Logger.log(`No se encontró la hoja "${mes}"`);
    return;
  }
  const lastRow = hoja.getLastRow();
  let inicio = -1;
  for (let r = 1; r <= lastRow; r++) {
    let valor = String(hoja.getRange(r, 1).getValue()).trim();
    if (valor.toLowerCase() === nombreSucursal.trim().toLowerCase()) {
      inicio = r;
      break;
    }
  }
  if (inicio === -1) {
    Logger.log(`No se encontró el bloque para la sucursal ${nombreSucursal}`);
    return;
  }
  let fila = inicio + 3;
  let filasEmpleados = [];
  let codigos = [];
  let filaCodigoIncorrecto = null;
  while (true) {
    let cod = hoja.getRange(fila, 1).getValue();
    let nombre = String(hoja.getRange(fila, 2).getValue()).trim().toLowerCase();
    if (!nombre || nombre === "total" || nombre === "proyección") break;
    if (nombre === "codigo incorrecto") { filaCodigoIncorrecto = fila; fila++; continue; }
    if (nombre === "domicilio") { fila++; continue; }
    codigos.push(String(cod).replace(/^0+/, '').trim());
    filasEmpleados.push(fila);
    fila++;
  }
  filasEmpleados.forEach(f => hoja.getRange(f, 4).setValue(""));
  if (filaCodigoIncorrecto) hoja.getRange(filaCodigoIncorrecto, 4).setValue("");
  Logger.log("CODIGOS HOJA: " + JSON.stringify(codigos));
  Logger.log("Ventas PDF: " + JSON.stringify(ventas));
  let totalCodigoIncorrecto = 0;
  let mapaCodigos = {};
  codigos.forEach((c, i) => { mapaCodigos[c] = filasEmpleados[i]; });
  ventas.forEach(([codigo, nombre, monto]) => {
    let codNorm = String(codigo).replace(/^0+/, '').trim();
    if (codNorm === "125") {
      montosDomicilioPorSucursal[nombreSucursal] = Number(monto);
      return;
    }
    if (codNorm === "100" || codNorm === "1000") {
      return;
    }
    if (mapaCodigos[codNorm]) {
      hoja.getRange(mapaCodigos[codNorm], 4).setValue(Number(monto));
    } else {
      totalCodigoIncorrecto += Number(monto);
    }
  });
  if (filaCodigoIncorrecto) hoja.getRange(filaCodigoIncorrecto, 4).setValue(totalCodigoIncorrecto);
  hoja.getRange(inicio + 4, 4, fila - (inicio + 4), 1).setNumberFormat("$#,##0.00");
  Logger.log(`Montos de TOTALES cargados en la sucursal "${nombreSucursal}" para el mes "${mes}".`);
  let filaTotal = fila;
  let lastRow2 = hoja.getLastRow();
  while (filaTotal <= lastRow2) {
    let celda = String(hoja.getRange(filaTotal, 1).getValue()).trim().toLowerCase();
    if (celda === "total") break;
    filaTotal++;
  }
  if (filaTotal <= lastRow2) {
    let porcMeta = hoja.getRange(filaTotal, 5).getValue();
    let porcMetaNum = Number(porcMeta);
    if (isNaN(porcMetaNum) || porcMetaNum <= 0.01) {
      let colBono = 6;
      let filaIni = inicio + 3;
      while (true) {
        let nombre = String(hoja.getRange(filaIni, 2).getValue()).trim().toLowerCase();
        if (!nombre || nombre === "total" || nombre === "proyección" || nombre === "codigo incorrecto") break;
        hoja.getRange(filaIni, colBono).setValue(0).setComment("");
        filaIni++;
      }
      let filaCodigoIncorrecto = null;
      let buscar = inicio + 3;
      while (true) {
        let nombre = String(hoja.getRange(buscar, 2).getValue()).trim().toLowerCase();
        if (nombre === "codigo incorrecto") {
          filaCodigoIncorrecto = buscar;
          hoja.getRange(buscar, colBono).setValue(0).setComment("");
          break;
        }
        if (!nombre || nombre === "total" || nombre === "proyección") break;
        buscar++;
      }
      hoja.getRange(filaTotal, colBono).setValue(0).setComment("");
      return;
    }
    ajustarBonoYComentarioPruebaEnBloque(hoja, filaTotal);
  }
}

function asignarMontosDomicilioEnBloque(mes, montosDomicilioPorSucursal) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(mes);
  if (!hoja) return;
  let lastRow = hoja.getLastRow();
  let inicio = -1;
  for (let r = 1; r <= lastRow; r++) {
    let valor = String(hoja.getRange(r, 1).getValue()).trim();
    if (valor.toLowerCase() === "domicilio") {
      inicio = r;
      break;
    }
  }
  if (inicio === -1) return;
  let fila = inicio + 4;
  while (true) {
    let nombre = String(hoja.getRange(fila, 2).getValue()).trim();
    if (!nombre || nombre.toLowerCase() === "total") break;
    let monto = montosDomicilioPorSucursal[nombre] || 0;
    hoja.getRange(fila, 3).setValue(monto).setNumberFormat("$#,##0.00");
    fila++;
  }
}

function agregarFilasTotalesYProyeccion(curRow, colMonto, rowInicio, rowFin, hojaMes) {
  let letraCol = String.fromCharCode(64 + colMonto);
  hojaMes.getRange(curRow, 1, 1, 2).merge().setValue("Total").setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  hojaMes.getRange(curRow, colMonto).setFormula(
    `=SUM(${letraCol}${rowInicio}:${letraCol}${rowFin})`
  ).setFontWeight('bold').setNumberFormat("$#,##0.00");
  hojaMes.getRange(curRow, 1, 1, 3).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  curRow++;
  hojaMes.getRange(curRow, 1, 1, 2).merge().setValue("Proyección").setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  let totalCell = `${letraCol}${curRow - 1}`;
  hojaMes.getRange(curRow, colMonto).setFormula(
    `=IFERROR(${totalCell}/DAY(TODAY())*DAY(EOMONTH(TODAY();0)); "")`
  ).setFontWeight('bold').setNumberFormat("$#,##0.00");
  hojaMes.getRange(curRow, 1, 1, 3).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  return curRow + 1;
}

function crearHojaMensualDesdePersonal(mes) {
  function normalizarTexto(texto) {
    return String(texto)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }
  const listaMeses = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
  ];
  const hoy = new Date();
  const mesActual = hoy.getMonth();
  const anioActual = hoy.getFullYear();
  let mesNorm = normalizarTexto(mes);
  let anioMes = anioActual;
  let mesSolo = mesNorm;
  let arr = mesNorm.split(" ");
  if (arr.length >= 2) {
    let posibleAnio = parseInt(arr[1]);
    if (!isNaN(posibleAnio)) {
      anioMes = posibleAnio;
      mesSolo = arr[0];
    }
  }
  const idxMes = listaMeses.indexOf(mesSolo);
  const esMesPasado = (
    (anioMes < anioActual) ||
    (anioMes === anioActual && idxMes < mesActual)
  );
  const PERSONAL_ID = '1VfJac80VlTKrjv9P3aAFKIgtQoYdjvmU386302_dIiQ';
  const ssDestino = SpreadsheetApp.getActiveSpreadsheet();
  const ssPersonal = SpreadsheetApp.openById(PERSONAL_ID);
  const hojaPersonal = ssPersonal.getSheetByName(mes);
  if (!hojaPersonal) return;
  const hojaMetas = ssDestino.getSheetByName("Asignacion de Metas");
  if (!hojaMetas) return;
  let bloques = [];
  for (let r = 1; r <= hojaMetas.getLastRow(); r += 3) {
    let nombreSucursal = String(hojaMetas.getRange(r, 1).getValue()).trim();
    if (!nombreSucursal) break;
    if (normalizarTexto(nombreSucursal) === "bodega") continue;
    bloques.push({
      nombre: nombreSucursal,
      filaMeses: r + 1,
      filaMetas: r + 2
    });
  }
  let hojaMes = ssDestino.getSheetByName(mes);
  if (hojaMes) ssDestino.deleteSheet(hojaMes);
  hojaMes = ssDestino.insertSheet(mes);
  hojaMes.setHiddenGridlines(true);
  const sucursalesRaw = hojaPersonal.getRange(2, 1, 1, hojaPersonal.getLastColumn()).getValues()[0];
  const sucursales = sucursalesRaw.filter(s => normalizarTexto(s) && normalizarTexto(s) !== "bodega");
  const indicesSucursal = sucursalesRaw
    .map((v, i) => (v && normalizarTexto(v) !== "bodega") ? i : -1)
    .filter(i => i >= 0);
  let curRow = 1;
  let metaDomicilio = "-";
  const bloqueDomicilio = bloques.find(b => normalizarTexto(b.nombre) === "domicilio");
  if (bloqueDomicilio) {
    const mesesDomicilio = hojaMetas.getRange(bloqueDomicilio.filaMeses, 1, 1, hojaMetas.getLastColumn()).getValues()[0];
    const mesesDomicilioNorm = mesesDomicilio.map(normalizarTexto);
    const colMes = mesesDomicilioNorm.indexOf(mesSolo) + 1;
    if (colMes > 0) {
      metaDomicilio = hojaMetas.getRange(bloqueDomicilio.filaMetas, colMes).getValue();
    }
  }
  let filaNombreDomicilio = curRow;
  hojaMes.getRange(curRow, 1, 1, 6).merge()
    .setValue("Domicilio")
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  hojaMes.getRange(curRow, 1, 1, 6).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  curRow++;
  hojaMes.getRange(curRow, 1, 1, 2).merge()
    .setValue("Meta")
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  hojaMes.getRange(curRow, 3, 1, 4).merge()
    .setValue(metaDomicilio ? metaDomicilio : "-")
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setBackground("#F8F8F8")
    .setNumberFormat("$#,##0.00");
  hojaMes.getRange(curRow, 1, 1, 6).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID);
  curRow++;
  hojaMes.getRange(curRow, 1).setValue('Cod.');
  hojaMes.getRange(curRow, 2).setValue('Nombre');
  hojaMes.getRange(curRow, 3, 1, 2).merge().setValue('Monto');
  hojaMes.getRange(curRow, 5).setValue('% de venta');
  hojaMes.getRange(curRow, 6).setValue('Bono');
  hojaMes.getRange(curRow, 1, 1, 6)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  hojaMes.getRange(curRow, 2).setHorizontalAlignment('left');
  hojaMes.getRange(curRow, 1, 1, 6).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID);
  curRow++;
  let filaInicioSucursales = curRow;
  let filasSucursales = [];
  sucursales.forEach(nombreSuc => {
    hojaMes.getRange(curRow, 1).setValue("");
    hojaMes.getRange(curRow, 2).setValue(nombreSuc);
    hojaMes.getRange(curRow, 3, 1, 2).merge();
    hojaMes.getRange(curRow, 1, 1, 6)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    hojaMes.getRange(curRow, 2).setHorizontalAlignment('left');
    hojaMes.getRange(curRow, 1, 1, 6).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID);
    filasSucursales.push(curRow);
    hojaMes.getRange(curRow, 6).setValue("");
    curRow++;
  });
  let filaTotalDomicilio = curRow;
  filasSucursales.forEach(fila => {
    hojaMes.getRange(fila, 5).setFormula(
      `=IFERROR(C${fila}/C${filaTotalDomicilio};"%")`
    ).setNumberFormat("0.00%");
    hojaMes.getRange(fila, 3, 1, 1).setNumberFormat("$#,##0.00");
  });
  hojaMes.getRange(curRow, 1, 1, 2).merge().setValue("Total").setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  hojaMes.getRange(curRow, 3, 1, 2).merge().setFormula(
    `=SUM(C${filaInicioSucursales}:C${filaTotalDomicilio - 1})`
  ).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setNumberFormat("$#,##0.00");
  hojaMes.getRange(curRow, 5).setFormula(
    `=IFERROR(C${curRow}/C${filaInicioSucursales - 2};"%")`
  ).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setNumberFormat("0.00%");
  hojaMes.getRange(curRow, 6).setFormula(
    `IFERROR(IFS(E${curRow}>=1;C${curRow}*0.5%;AND(E${curRow}>=0.95;E${curRow}<1);C${curRow}*0.25%;TRUE;0);0)`
  ).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setNumberFormat("$#,##0.00");
  hojaMes.getRange(curRow, 1, 1, 6).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  let reglas = hojaMes.getConditionalFormatRules();
  reglas.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$E${curRow}>=1`)
      .setBackground("#B6D7A8")
      .setRanges([hojaMes.getRange(filaNombreDomicilio, 1, 1, 6)])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AND($E${curRow}>=0.95,$E${curRow}<1)`)
      .setBackground("#FFE599")
      .setRanges([hojaMes.getRange(filaNombreDomicilio, 1, 1, 6)])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=$E${curRow}<0.95`)
      .setBackground("#F4CCCC")
      .setRanges([hojaMes.getRange(filaNombreDomicilio, 1, 1, 6)])
      .build()
  );
  hojaMes.setConditionalFormatRules(reglas);
  curRow++;
  hojaMes.getRange(curRow, 1, 1, 2).merge().setValue("Proyección").setFontWeight('bold')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');
  if (esMesPasado) {
    hojaMes.getRange(curRow, 3, 1, 1).setValue("Finalizado").setHorizontalAlignment('center');
    hojaMes.getRange(curRow, 5, 1, 1).setValue("Finalizado").setHorizontalAlignment('center');
  } else {
    hojaMes.getRange(curRow, 3, 1, 2).merge().setFormula(
      `=IFERROR(C${filaTotalDomicilio}/DAY(TODAY()-1)*DAY(EOMONTH(TODAY(),0));"$0.00")`
    ).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setNumberFormat("$#,##0.00");
    hojaMes.getRange(curRow, 5).setFormula(
      `=IFERROR(C${curRow}/C${filaInicioSucursales - 2};"%")`
    ).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setNumberFormat("0.00%");
    let filaProyDom = curRow;
    reglas = hojaMes.getConditionalFormatRules();
    reglas.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=$E${filaProyDom}>=1`)
        .setBackground("#B6D7A8")
        .setRanges([hojaMes.getRange(filaProyDom, 1, 1, 6)])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=AND($E${filaProyDom}>=0.95,$E${filaProyDom}<1)`)
        .setBackground("#FFE599")
        .setRanges([hojaMes.getRange(filaProyDom, 1, 1, 6)])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=$E${filaProyDom}<0.95`)
        .setBackground("#F4CCCC")
        .setRanges([hojaMes.getRange(filaProyDom, 1, 1, 6)])
        .build()
    );
    hojaMes.setConditionalFormatRules(reglas);
  }
  hojaMes.getRange(curRow, 6).setValue("");
  hojaMes.getRange(curRow, 1, 1, 6).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  curRow++;
  hojaMes.getRange(curRow, 1, 1, 6).setBorder(null, null, true, null, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  curRow++;
  indicesSucursal.forEach((col, idx) => {
    const nombreSucursal = sucursalesRaw[col];
    if (normalizarTexto(nombreSucursal) === "bodega") return;
    const bloque = bloques.find(b => normalizarTexto(b.nombre) === normalizarTexto(nombreSucursal));
    let metaSucursal = '-';
    if (bloque) {
      const mesesSucursal = hojaMetas.getRange(bloque.filaMeses, 1, 1, hojaMetas.getLastColumn()).getValues()[0];
      const mesesSucursalNorm = mesesSucursal.map(normalizarTexto);
      const colMes = mesesSucursalNorm.indexOf(mesSolo) + 1;
      if (colMes > 0) {
        metaSucursal = hojaMetas.getRange(bloque.filaMetas, colMes).getValue();
      }
    }
    let filaNombreSucursal = curRow;
    hojaMes.getRange(curRow, 1, 1, 6).merge()
      .setValue(nombreSucursal)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    hojaMes.getRange(curRow, 1, 1, 6).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    curRow++;
    let metaRow = curRow;
    hojaMes.getRange(curRow, 1, 1, 2).merge().setValue("Meta")
      .setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle');
    hojaMes.getRange(curRow, 3, 1, 4).merge()
      .setValue(metaSucursal ? metaSucursal : "-")
      .setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBackground("#F8F8F8").setNumberFormat("$#,##0.00");
    hojaMes.getRange(curRow, 1, 1, 6).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID);
    curRow++;
    hojaMes.getRange(curRow, 1).setValue('Cod.');
    hojaMes.getRange(curRow, 2).setValue('Nombre');
    hojaMes.getRange(curRow, 3).setValue('Cargo');
    hojaMes.getRange(curRow, 4).setValue('Monto');
    hojaMes.getRange(curRow, 5).setValue('% de venta');
    hojaMes.getRange(curRow, 6).setValue('Bono');
    hojaMes.getRange(curRow, 1, 1, 6)
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    hojaMes.getRange(curRow, 1, 1, 6).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID);
    curRow++;
    let filaEmpleadosIni = curRow;
    let row = 4;
    let jefeRow = null;
    while (true) {
      const cod = hojaPersonal.getRange(row, col + 1).getValue();
      const nombre = hojaPersonal.getRange(row, col + 2).getValue();
      const cargo = hojaPersonal.getRange(row, col + 3).getValue();
      if ((!cod || String(cod).trim() === "-") && !nombre) break;
      if (cod && String(cod).trim() !== "-") {
        hojaMes.getRange(curRow, 1).setValue(cod);
        hojaMes.getRange(curRow, 2).setValue(nombre);
        hojaMes.getRange(curRow, 3).setValue(cargo);
        hojaMes.getRange(curRow, 1, 1, 6)
          .setHorizontalAlignment('center')
          .setVerticalAlignment('middle');
        hojaMes.getRange(curRow, 2).setHorizontalAlignment('left');
        hojaMes.getRange(curRow, 1, 1, 6).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID);
        hojaMes.getRange(curRow, 4).setNumberFormat("$#,##0.00");
        if (String(cargo).trim() === "J") jefeRow = curRow;
        curRow++;
      }
      row++;
    }
    let filaEmpleadosFin = curRow - 1;
    hojaMes.getRange(curRow, 1).setValue("");
    hojaMes.getRange(curRow, 2).setValue("codigo incorrecto");
    hojaMes.getRange(curRow, 3).setValue("");
    hojaMes.getRange(curRow, 4).setNumberFormat("$#,##0.00");
    hojaMes.getRange(curRow, 5).setFormula(
      `=IFERROR(D${curRow}/D${curRow + 1};"%")`
    ).setNumberFormat("0.00%");
    let formulaBonoCodigoIncorrecto = "";
    if (
      anioMes < 2025 ||
      (anioMes === 2025 && idxMes <= 2)
    ) {
      formulaBonoCodigoIncorrecto = `IFERROR(IFS($E${curRow + 1}>1;D${curRow}*0.5%;AND($E${curRow + 1}>=0.95;$E${curRow + 1}<1);D${curRow}*0.25%;TRUE;0);0)`;
    } else {
      formulaBonoCodigoIncorrecto = `IF(EXACT(TRIM(C${curRow});"J");IFERROR(F${curRow + 1}/4;0);IF(E${curRow + 1}>=0.95;IFERROR((D${curRow}/(D${curRow + 1}-D${jefeRow}))*(F${curRow + 1}*0.75);0);0))`;
    }
    hojaMes.getRange(curRow, 6).setFormula(formulaBonoCodigoIncorrecto).setNumberFormat("$#,##0.00");
    hojaMes.getRange(curRow, 1, 1, 6)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    hojaMes.getRange(curRow, 2).setHorizontalAlignment('left');
    hojaMes.getRange(curRow, 1, 1, 6).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID);
    let filaCodigoIncorrecto = curRow;
    curRow++;
    let filaTotal = curRow;
    hojaMes.getRange(curRow, 1, 1, 2).merge().setValue("Total").setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    hojaMes.getRange(curRow, 4).setFormula(
      `=SUM(D${filaEmpleadosIni}:D${filaEmpleadosFin})+D${filaCodigoIncorrecto}`
    ).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setNumberFormat("$#,##0.00");
    hojaMes.getRange(curRow, 5).setFormula(
      `=IFERROR(D${curRow}/C${filaEmpleadosIni - 2};"%")`
    ).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setNumberFormat("0.00%");
    hojaMes.getRange(curRow, 6).setFormula(
      `IFERROR(IFS(E${filaTotal}>=1;D${filaTotal}*0.5%;AND(E${filaTotal}>=0.95;E${filaTotal}<1);D${filaTotal}*0.25%;TRUE;0);0)`
    ).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setNumberFormat("$#,##0.00");
    hojaMes.getRange(curRow, 1, 1, 6).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    for (let f = filaEmpleadosIni; f <= filaEmpleadosFin; f++) {
      let formulaBono = "";
      if (
        anioMes < 2025 ||
        (anioMes === 2025 && idxMes <= 2)
      ) {
        formulaBono = `IF(ISNUMBER(SEARCH("prueba";LOWER(C${f}))); (IFERROR(IFS($E${filaTotal}>=1;D${f}*0.5%;AND($E${filaTotal}>=0.95;$E${filaTotal}<1);D${f}*0.25%;TRUE;0);0))*0.5; IFERROR(IFS($E${filaTotal}>=1;D${f}*0.5%;AND($E${filaTotal}>=0.95;$E${filaTotal}<1);D${f}*0.25%;TRUE;0);0) )`;
      } else {
        formulaBono = `IF(ISNUMBER(SEARCH("prueba"; LOWER(C${f}))); (IF(EXACT(TRIM(C${f});"J");IFERROR(F${filaTotal}/4;0);IF(E${filaTotal}>=0.95;IFERROR((D${f}/(D${filaTotal}-D${jefeRow}))*(F${filaTotal}*0.75);0);0)))*0.5; IF(EXACT(TRIM(C${f});"J");IFERROR(F${filaTotal}/4;0);IF(E${filaTotal}>=0.95;IFERROR((D${f}/(D${filaTotal}-D${jefeRow}))*(F${filaTotal}*0.75);0);0)) )`;
      }
      hojaMes.getRange(f, 6).setFormula(formulaBono).setNumberFormat("$#,##0.00");
    }
    hojaMes.getRange(curRow, 6).setNumberFormat("$#,##0.00");
    hojaMes.getRange(curRow, 1, 1, 6).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    reglas = hojaMes.getConditionalFormatRules();
    reglas.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(
          `=OR(C${metaRow}="";C${metaRow}="-";C${metaRow}=0;ISBLANK(C${metaRow}))`
        )
        .setBackground("#d9d9d9")
        .setRanges([hojaMes.getRange(filaNombreSucursal, 1, 1, 6)])
        .build()
    );
    reglas.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=$E${filaTotal}>=1`)
        .setBackground("#B6D7A8")
        .setRanges([hojaMes.getRange(filaNombreSucursal, 1, 1, 6)])
        .build()
    );
    reglas.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=AND($E${filaTotal}>=0.95, $E${filaTotal}<1)`)
        .setBackground("#FFE599")
        .setRanges([hojaMes.getRange(filaNombreSucursal, 1, 1, 6)])
        .build()
    );
    reglas.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=$E${filaTotal}<0.95`)
        .setBackground("#F4CCCC")
        .setRanges([hojaMes.getRange(filaNombreSucursal, 1, 1, 6)])
        .build()
    );
    hojaMes.setConditionalFormatRules(reglas);
    for (let f = filaEmpleadosIni; f <= filaEmpleadosFin; f++) {
      hojaMes.getRange(f, 5).setFormula(
        `=IFERROR(D${f}/D${filaTotal};"%")`
      ).setNumberFormat("0.00%");
      hojaMes.getRange(f, 4).setNumberFormat("$#,##0.00");
    }
    curRow++;
    hojaMes.getRange(curRow, 1, 1, 2).merge().setValue("Proyección").setFontWeight('bold')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    if (esMesPasado) {
      hojaMes.getRange(curRow, 4, 1, 1).setValue("Finalizado").setHorizontalAlignment('center');
      hojaMes.getRange(curRow, 5, 1, 1).setValue("Finalizado").setHorizontalAlignment('center');
    } else {
      hojaMes.getRange(curRow, 4).setFormula(
        `=IFERROR(D${filaTotal}/DAY(TODAY()-1)*DAY(EOMONTH(TODAY();0));"$0.00")`
      ).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setNumberFormat("$#,##0.00");
      hojaMes.getRange(curRow, 5).setFormula(
        `=IFERROR(D${curRow}/C${filaEmpleadosIni - 2};"%")`
      ).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setNumberFormat("0.00%");
      let filaProy = curRow;
      reglas = hojaMes.getConditionalFormatRules();
      reglas.push(
        SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied(`=$E${filaProy}>=1`)
          .setBackground("#B6D7A8")
          .setRanges([hojaMes.getRange(filaProy, 1, 1, 6)])
          .build(),
        SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied(`=AND($E${filaProy}>=0.95,$E${filaProy}<1)`)
          .setBackground("#FFE599")
          .setRanges([hojaMes.getRange(filaProy, 1, 1, 6)])
          .build(),
        SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied(`=$E${filaProy}<0.95`)
          .setBackground("#F4CCCC")
          .setRanges([hojaMes.getRange(filaProy, 1, 1, 6)])
          .build()
      );
      hojaMes.setConditionalFormatRules(reglas);
    }
    hojaMes.getRange(curRow, 6).setValue("");
    hojaMes.getRange(curRow, 1, 1, 6).setBorder(true, true, true, true, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    curRow++;
    hojaMes.getRange(curRow, 1, 1, 6).setBorder(null, null, true, null, null, null, 'black', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    curRow++;
  });
  hojaMes.setColumnWidth(1, 60);
  hojaMes.setColumnWidth(2, 220);
  hojaMes.setColumnWidth(3, 120);
  hojaMes.setColumnWidth(4, 120);
  hojaMes.setColumnWidth(5, 100);
  hojaMes.setColumnWidth(6, 100);
  for (let r = 1; r < curRow; r++) {
    hojaMes.setRowHeight(r, 40);
  }
  let last = hojaMes.getLastRow();
  for (let r = last; r >= 1; r--) {
    let cod = String(hojaMes.getRange(r, 1).getValue()).trim();
    let nombre = String(hojaMes.getRange(r, 2).getValue()).trim().toLowerCase();
    if (
      cod === "" || cod.toLowerCase() === "cod." ||
      nombre === "total" || nombre === "proyección" || nombre === "meta" ||
      nombre === "codigo incorrecto"
    ) continue;
    if (!cod || cod === "-") {
      hojaMes.deleteRow(r);
      continue;
    }
    if (cod === "125" || nombre === "domicilio" || nombre === "bodega") {
      hojaMes.deleteRow(r);
    }
  }
  if (hojaMes.getLastRow() > curRow - 1) {
    hojaMes.deleteRows(curRow, hojaMes.getLastRow() - curRow + 1);
  }
  if (hojaMes.getLastColumn() > 6) {
    hojaMes.deleteColumns(7, hojaMes.getLastColumn() - 6);
  }
  hojaMes.getRange(1, 3, hojaMes.getLastRow(), 1).setWrap(true);
  let ultFila = hojaMes.getLastRow();
  for (let r = 1; r <= ultFila; r++) {
    let cargo = String(hojaMes.getRange(r, 3).getValue()).toLowerCase();
    if (cargo.indexOf("liquidado") !== -1) {
      hojaMes.getRange(r, 1, 1, 6).setFontColor("#ff0000");
    }
  }
}

function procesarVentasTodasSucursales(mes, anioOptional) {
  var sucursales = [
    { nombre: "La Popular", credentials: { username: "documentop.supervisor", password: "documento9999" } },
    { nombre: "Salud 1", credentials: { username: "documento1.supervisor", password: "documento9999" } },
    { nombre: "Salud 2", credentials: { username: "documento2.supervisor", password: "documento9999" } },
    { nombre: "Salud 3", credentials: { username: "documento3.supervisor", password: "documento9999" } },
    { nombre: "Salud 4", credentials: { username: "documento4.supervisor", password: "documento9999" } },
    { nombre: "Salud 5", credentials: { username: "documento5.supervisor", password: "documento9999" } }
  ];
  var hoy = new Date();
  var meses = {
    "enero": 0, "febrero": 1, "marzo": 2, "abril": 3, "mayo": 4, "junio": 5,
    "julio": 6, "agosto": 7, "septiembre": 8, "octubre": 9, "noviembre": 10, "diciembre": 11
  };
  var mesNum = meses[mes.toLowerCase()];
  var anio = anioOptional || hoy.getFullYear();
  var esMesActual = (hoy.getMonth() === mesNum && hoy.getFullYear() === anio);
  var firstDay = new Date(anio, mesNum, 1);
  var lastDay;
  if (esMesActual) {
    lastDay = new Date(anio, mesNum, hoy.getDate() - 1);
  } else {
    lastDay = new Date(anio, mesNum + 1, 0);
  }
  function formatDate(date) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  var fini = formatDate(firstDay);
  var ffin = formatDate(lastDay);
  var baseUrl;
  var migrado = (
    (anio === 2024 && mesNum >= 7) ||
    (anio === 2025 && mesNum <= 3)
  );
  if (migrado) {
    baseUrl = "https://app.farmasaludsv.com.sv/ventas_vendedor_pdf.php";
  } else {
    baseUrl = "https://clientesdte3.oss.com.sv/farma_salud/ventas_vendedor_pdf.php";
  }
  var queryString = "?ffin=" + ffin + "&fini=" + fini;
  let montosDomicilioPorSucursal = {};
  sucursales.forEach(function (suc) {
    Logger.log("Procesando sucursal: " + suc.nombre);
    var sessionCookie = iniciarSesion(suc.credentials);
    if (!sessionCookie) {
      Logger.log("No se pudo iniciar sesión para " + suc.nombre);
      return;
    }
    var pdfName = "ventas_vendedor_" + suc.nombre + ".pdf";
    var pdfBlob = descargarPDF(sessionCookie, baseUrl + queryString, pdfName);
    if (!pdfBlob) {
      Logger.log("No se pudo descargar el PDF para " + suc.nombre);
      return;
    }
    var ventasArray = extraerVentasDesdePDF_Totales(pdfBlob, suc.nombre);
    if (!ventasArray.length) {
      Logger.log("No se detectaron ventas TOTALES para " + suc.nombre);
      return;
    }
    llenarMontosSucursalEnHojaMensualSoloTotales(mes, suc.nombre, ventasArray, montosDomicilioPorSucursal);
    Logger.log("Sucursal " + suc.nombre + " procesada.");
  });
  asignarMontosDomicilioEnBloque(mes, montosDomicilioPorSucursal);
  Logger.log("Proceso de ventas finalizado para el mes: " + mes + " " + anio);
}

function iniciarSesion(credenciales) {
  try {
    var urlLogin = "https://clientesdte3.oss.com.sv/farma_salud/login.php";
    var payload = {
      username: credenciales.username,
      password: credenciales.password,
      m: "1"
    };
    var optionsLogin = {
      method: "post",
      payload: payload,
      followRedirects: false
    };
    var responseLogin = UrlFetchApp.fetch(urlLogin, optionsLogin);
    var cookies = responseLogin.getAllHeaders()["Set-Cookie"];
    if (!cookies) {
      Logger.log("Error: No se recibieron cookies de sesión.");
      return null;
    }
    var sessionCookie = cookies.match(/PHPSESSID=[^;]+/)[0];
    Logger.log("Sesión iniciada, cookie de sesión: " + sessionCookie);
    return sessionCookie;
  } catch (e) {
    Logger.log("❌ Error en iniciarSesion: " + e.toString());
    return null;
  }
}

function descargarPDF(sessionCookie, url, pdfName) {
  try {
    var options = {
      method: "get",
      headers: {
        "Cookie": sessionCookie,
        "User-Agent": "Mozilla/5.0 (compatible; Google Apps Script)",
        "Referer": "https://clientesdte3.oss.com.sv/farma_salud/"
      },
      muteHttpExceptions: true,
      followRedirects: true
    };
    var response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200 &&
      response.getHeaders()["Content-Type"] &&
      response.getHeaders()["Content-Type"].indexOf("application/pdf") !== -1) {
      var blob = response.getBlob().setName(pdfName);
      Logger.log("PDF descargado exitosamente: " + pdfName);
      return blob;
    } else {
      Logger.log("Error al descargar el PDF (" + pdfName + "). Código: " + response.getResponseCode());
      Logger.log("Contenido (parcial): " + response.getContentText().substring(0, 500));
      return null;
    }
  } catch (err) {
    Logger.log("Error en descargarPDF: " + err);
    return null;
  }
}

function generarHojaBonosAnual() {
  const PERSONAL_ID = '1VfJac80VlTKrjv9P3aAFKIgtQoYdjvmU386302_dIiQ';
  const ssPersonal = SpreadsheetApp.openById(PERSONAL_ID);
  const hojaEmpleados = ssPersonal.getSheetByName("Empleados");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hojaBonos = ss.getSheetByName("Bonos Anual");
  if (hojaBonos) ss.deleteSheet(hojaBonos);
  hojaBonos = ss.insertSheet("Bonos Anual");
  hojaBonos.setHiddenGridlines(true);
  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  const headers = ["Codigo", "Trabajador", "Cargo"]
    .concat(meses.slice(0, 6), ["Bono 1"], meses.slice(6), ["Bono 2", "Bono Anual"]);
  hojaBonos.getRange(1, 1, 1, headers.length).setValues([headers]);
  hojaBonos.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground("#F2F2F2")
    .setVerticalAlignment("middle")
    .setHorizontalAlignment("center");
  hojaBonos.setColumnWidths(1, 1, 70);
  hojaBonos.setColumnWidths(2, 1, 300);
  hojaBonos.setColumnWidths(3, headers.length - 2, 120);
  hojaBonos.setColumnWidths(11, 2, 85);
  hojaBonos.setColumnWidth(13, 85);
  for (let r = 1; r <= 100; r++) hojaBonos.setRowHeight(r, 40);
  const empleados = hojaEmpleados.getDataRange().getValues().slice(1);
  const sucursales = {};
  const liquidados = [];
  const mapaCodigos = {};
  const cargosAdmin = ["adm", "supervisor", "talento humano"];
  const adminEmpleados = empleados.filter(row => {
    const cargo = (row[3] || "").toString().toLowerCase();
    const activo = row[4];
    const fechaLiquidacion = row[7];
    return (
      cargo && cargosAdmin.some(c => cargo.includes(c)) &&
      activo !== "No" &&
      (!fechaLiquidacion || fechaLiquidacion === "")
    );
  });
  let fila = 2;
  if (adminEmpleados.length > 0) {
    hojaBonos.getRange(fila, 1, 1, headers.length).merge().setValue("Administración")
      .setBackground("#ffe49e").setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle");
    hojaBonos.setRowHeight(fila, 40);
    let filaIni = fila + 1;
    adminEmpleados.forEach(emp => {
      hojaBonos.getRange(fila + 1, 1, 1, 3).setValues([[emp[0], emp[1], emp[3]]]);
      hojaBonos.setRowHeight(fila + 1, 40);
      mapaCodigos[emp[0]] = fila + 1;
      fila++;
    });
    let filaFin = fila;
    hojaBonos.getRange(filaIni, 1, filaFin - filaIni + 1, headers.length)
      .setBorder(true, true, true, true, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    fila++;
  }
  hojaBonos.getRange(fila, 1, 1, headers.length).merge().setValue("Domicilio")
    .setBackground("#ffe49e")
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  hojaBonos.setRowHeight(fila, 40);
  let filaDomicilio = fila + 1;
  hojaBonos.getRange(filaDomicilio, 1, 1, 3).setValues([["125", "Domicilio", "Agente de atencion"]]);
  hojaBonos.setRowHeight(filaDomicilio, 40);
  hojaBonos.getRange(filaDomicilio, 1, 1, headers.length)
    .setBorder(true, true, true, true, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  fila += 2;
  empleados.forEach(row => {
    const [codigo, nombre, sucursalBase, cargo, activo, , , fechaLiquidacion] = row;
    const cargoLower = (cargo || "").toString().toLowerCase();
    if (!codigo || codigo === "-") return;
    if (!nombre || !cargo) return;
    if (
      cargosAdmin.some(c => cargoLower.includes(c)) ||
      activo === "No" ||
      (fechaLiquidacion && fechaLiquidacion !== "")
    ) {
      if (activo === "No" || (fechaLiquidacion && fechaLiquidacion !== "")) {
        liquidados.push([codigo, nombre, cargo]);
      }
      return;
    }
    // Evita duplicar "Domicilio"
    if (nombre.trim().toLowerCase() === "domicilio") return;

    if (!sucursales[sucursalBase]) sucursales[sucursalBase] = [];
    sucursales[sucursalBase].push([codigo, nombre, cargo]);
  });
  Object.keys(sucursales).forEach(suc => {
    hojaBonos.getRange(fila, 1, 1, headers.length).merge().setValue(suc)
      .setBackground("#ffe49e").setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle");
    hojaBonos.setRowHeight(fila, 40);
    let filaIni = fila + 1;
    sucursales[suc].forEach(emp => {
      hojaBonos.getRange(fila + 1, 1, 1, 3).setValues([emp]);
      hojaBonos.setRowHeight(fila + 1, 40);
      mapaCodigos[emp[0]] = fila + 1;
      fila++;
    });
    let filaFin = fila;
    hojaBonos.getRange(filaIni, 1, filaFin - filaIni + 1, headers.length)
      .setBorder(true, true, true, true, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    fila++;
  });
  if (liquidados.length > 0) {
    hojaBonos.getRange(fila, 1, 1, headers.length).merge().setValue("Liquidados")
      .setBackground("#f8cfcf").setFontWeight("bold").setHorizontalAlignment("center").setVerticalAlignment("middle");
    hojaBonos.setRowHeight(fila, 40);
    let filaIni = fila + 1;
    liquidados.forEach(emp => {
      hojaBonos.getRange(fila + 1, 1, 1, 3).setValues([emp]);
      hojaBonos.setRowHeight(fila + 1, 40);
      mapaCodigos[emp[0]] = fila + 1;
      fila++;
    });
    let filaFin = fila;
    hojaBonos.getRange(filaIni, 1, filaFin - filaIni + 1, headers.length)
      .setBorder(true, true, true, true, null, null, "black", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    fila++;
  }
  hojaBonos.getRange(2, 1, hojaBonos.getLastRow(), headers.length).setVerticalAlignment("middle");
  hojaBonos.getRange(2, 3, hojaBonos.getLastRow(), headers.length - 2).setHorizontalAlignment("center");
  hojaBonos.getRange(2, 2, hojaBonos.getLastRow(), 1).setHorizontalAlignment("left");
  hojaBonos.getRange(2, 3, hojaBonos.getLastRow(), 1).setWrap(true);
  const colBono1 = 10; // J
  const colBono2 = 17; // Q
  const colBonoAnual = 18; // R
  const numRows = hojaBonos.getLastRow();
  for (let i = 2; i <= numRows; i++) {
    let cod = hojaBonos.getRange(i, 1).getValue();
    let nombre = hojaBonos.getRange(i, 2).getValue();
    if (!nombre || nombre === "-" || (!cod && nombre !== "Domicilio")) continue;
    hojaBonos.getRange(i, colBono1).setFormulaR1C1('=SUM(R[0]C[-6]:R[0]C[-1])');
    hojaBonos.getRange(i, colBono2).setFormulaR1C1('=SUM(R[0]C[-6]:R[0]C[-1])');
    hojaBonos.getRange(i, colBonoAnual).setFormulaR1C1('=R[0]C[-8]+R[0]C[-1]');
    const numRowsMoneda = hojaBonos.getLastRow();
    hojaBonos.getRange(2, 4, numRowsMoneda - 1, 15).setNumberFormat('$#,##0.00');
  }
}

function sincronizarBonosAnualConPersonal() {
  // Configuración
  const PERSONAL_ID = '1VfJac80VlTKrjv9P3aAFKIgtQoYdjvmU386302_dIiQ';
  const NOMBRE_HOJA_PERSONAL = "Empleados";
  const NOMBRE_HOJA_BONOS = "Bonos Anual";

  // 1. Leer empleados desde archivo Personal
  const ssPersonal = SpreadsheetApp.openById(PERSONAL_ID);
  const hojaEmpleados = ssPersonal.getSheetByName(NOMBRE_HOJA_PERSONAL);
  const empleadosPersonal = hojaEmpleados.getDataRange().getValues().slice(1) // Excluye encabezado

  // 2. Leer Bonos Anual y estructurar su información
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaBonos = ss.getSheetByName(NOMBRE_HOJA_BONOS);
  if (!hojaBonos) throw new Error("No existe la hoja Bonos Anual.");
  const datosBonos = hojaBonos.getDataRange().getValues();
  const headers = datosBonos[0];
  const numCols = headers.length;

  // Detecta bloques de sucursales y liquidados
  function detectarBloques(data) {
    const bloques = {}; // {Sucursal: {ini, fin}}
    let actual = null;
    for (let i = 1; i < data.length; i++) {
      const celda = (data[i][0] || '').toString().trim();
      // Si la fila está fusionada, es encabezado de bloque
      if (celda && data[i].slice(1).every(x => !x)) {
        actual = celda;
        bloques[actual] = { ini: i, fin: i };
      } else if (actual) {
        bloques[actual].fin = i;
      }
    }
    return bloques;
  }
  const bloques = detectarBloques(datosBonos);

  // Mapas para búsqueda rápida
  const empleadosBonos = {}; // codigo => info de hoja bonos
  for (let i = 1; i < datosBonos.length; i++) {
    const fila = datosBonos[i];
    const codigo = fila[0] ? fila[0].toString().trim() : "";
    if (codigo && !isNaN(Number(codigo))) {
      empleadosBonos[codigo] = {
        row: i + 1,
        nombre: fila[1],
        cargo: fila[2],
        bloque: Object.entries(bloques).find(([_, v]) => i >= v.ini && i <= v.fin)?.[0] || ""
      };
    }
  }

  // Listado de códigos activos en Personal y bloque Liquidados en Bonos
  const codigosPersonal = empleadosPersonal
    .filter(r => r[0] && !isNaN(Number(r[0])))
    .map(r => r[0].toString().trim());

  // Mapa por código para buscar rápido info actual
  const mapPersonal = {};
  empleadosPersonal.forEach(row => {
    const [codigo, nombre, sucursal, cargo, activo, , , fechaLiqui] = row;
    if (!codigo || isNaN(Number(codigo))) return;
    mapPersonal[codigo.toString().trim()] = {
      nombre, sucursal, cargo, activo, fechaLiqui
    };
  });

  // 3. Proceso de sincronización

  // 3A. Agregar/mover/actualizar empleados activos o transferidos
  Object.keys(mapPersonal).forEach(codigo => {
    const info = mapPersonal[codigo];
    const yaExiste = empleadosBonos[codigo];
    const estaLiquidado = info.activo === "No" || (info.fechaLiqui && info.fechaLiqui !== "");
    const bloqueActual = yaExiste ? empleadosBonos[codigo].bloque : null;

    // A) Si es empleado activo y NO está en Bonos Anual -> Insertar
    if (!yaExiste && !estaLiquidado) {
      // Insertar en la sucursal correspondiente
      let bloqueSuc = bloques[info.sucursal];
      if (!bloqueSuc) {
        // Si no existe bloque, lo crea al final
        let lastRow = hojaBonos.getLastRow() + 1;
        hojaBonos.insertRowsAfter(lastRow, 2);
        hojaBonos.getRange(lastRow + 1, 1, 1, numCols).merge().setValue(info.sucursal)
          .setBackground("#ffe49e").setFontWeight("bold").setHorizontalAlignment("center");
        hojaBonos.getRange(lastRow + 2, 1, 1, 3).setValues([[codigo, info.nombre, info.cargo]]);
      } else {
        // Insertar después del último empleado de ese bloque (antes del siguiente bloque)
        hojaBonos.insertRowsAfter(bloqueSuc.fin + 1, 1);
        hojaBonos.getRange(bloqueSuc.fin + 2, 1, 1, 3).setValues([[codigo, info.nombre, info.cargo]]);
      }
      // Fin agregar
      return;
    }

    // B) Si está y cambió de sucursal o fue liquidado -> Mover fila
    if (yaExiste) {
      // Si fue liquidado y no está en "Liquidados"
      if (estaLiquidado && bloqueActual !== "Liquidados") {
        // Cortar la fila y pegar en bloque "Liquidados"
        const filaOrigen = empleadosBonos[codigo].row;
        const valores = hojaBonos.getRange(filaOrigen, 1, 1, numCols).getValues();
        hojaBonos.deleteRow(filaOrigen);
        const bloqueLiquidados = bloques["Liquidados"];
        const destino = bloqueLiquidados ? bloqueLiquidados.fin + 1 : hojaBonos.getLastRow() + 1;
        hojaBonos.insertRowsAfter(destino, 1);
        hojaBonos.getRange(destino + 1, 1, 1, numCols).setValues(valores);
        hojaBonos.getRange(destino + 1, 1, 1, 3).setValues([[codigo, info.nombre, info.cargo]]);
        return;
      }
      // Si sigue activo pero cambió de sucursal
      if (!estaLiquidado && info.sucursal !== bloqueActual) {
        // Cortar la fila y pegar en el bloque de la nueva sucursal
        const filaOrigen = empleadosBonos[codigo].row;
        const valores = hojaBonos.getRange(filaOrigen, 1, 1, numCols).getValues();
        hojaBonos.deleteRow(filaOrigen);
        let bloqueSuc = bloques[info.sucursal];
        const destino = bloqueSuc ? bloqueSuc.fin + 1 : hojaBonos.getLastRow() + 1;
        hojaBonos.insertRowsAfter(destino, 1);
        hojaBonos.getRange(destino + 1, 1, 1, numCols).setValues(valores);
        hojaBonos.getRange(destino + 1, 1, 1, 3).setValues([[codigo, info.nombre, info.cargo]]);
        return;
      }
      // Si nombre o cargo cambió, actualizar
      if (info.nombre !== empleadosBonos[codigo].nombre || info.cargo !== empleadosBonos[codigo].cargo) {
        hojaBonos.getRange(empleadosBonos[codigo].row, 2, 1, 2)
          .setValues([[info.nombre, info.cargo]]);
      }
    }
  });

  // 3B. Para empleados que están en Bonos Anual pero ya NO en la hoja de Personal y NO están en "Liquidados", moverlos
  Object.keys(empleadosBonos).forEach(codigo => {
    if (!mapPersonal[codigo] && empleadosBonos[codigo].bloque !== "Liquidados") {
      // Cortar y pegar en "Liquidados"
      const filaOrigen = empleadosBonos[codigo].row;
      const valores = hojaBonos.getRange(filaOrigen, 1, 1, numCols).getValues();
      hojaBonos.deleteRow(filaOrigen);
      const bloqueLiquidados = bloques["Liquidados"];
      const destino = bloqueLiquidados ? bloqueLiquidados.fin + 1 : hojaBonos.getLastRow() + 1;
      hojaBonos.insertRowsAfter(destino, 1);
      hojaBonos.getRange(destino + 1, 1, 1, numCols).setValues(valores);
    }
  });

  SpreadsheetApp.flush();
  Logger.log("✔️ Sincronización de personal en Bonos Anual finalizada.");
}

function llenarBonosAnualPorMes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaBonos = ss.getSheetByName("Bonos Anual");
  if (!hojaBonos) return;

  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];

  // Determinar el mes a actualizar
  const hoy = new Date();
  let dia = hoy.getDate();
  let mesIdx = hoy.getMonth();
  let anio = hoy.getFullYear();
  if (dia === 1) {
    mesIdx = mesIdx - 1;
    if (mesIdx < 0) { mesIdx = 11; anio = anio - 1; }
  }
  const mesNombre = meses[mesIdx];
  const colMes = 4 + mesIdx + (mesIdx >= 6 ? 1 : 0);

  // Leer empleados actuales en Bonos Anual (codigos + fila)
  const datosBonos = hojaBonos.getDataRange().getValues();
  let empleadosMap = {};
  let bloques = [];
  for (let i = 1; i < datosBonos.length; i++) {
    const celda = String(datosBonos[i][0] || '').trim();
    if (celda && datosBonos[i].slice(1).every(x => !x)) {
      bloques.push({ nombre: celda, ini: i, fin: i });
    } else if (bloques.length > 0) {
      bloques[bloques.length - 1].fin = i;
    }
    if (celda && /^\d+$/.test(celda)) empleadosMap[celda] = i + 1;
  }

  // Leer bonos del mes en hoja mensual
  let hojaMes = ss.getSheetByName(mesNombre.toLowerCase());
  if (!hojaMes) return;
  let dataMes = hojaMes.getDataRange().getValues();
  let sucursalActual = "";
  let bonosPorEmpleado = {};
  let empleadosNuevos = [];

  for (let i = 0; i < dataMes.length; i++) {
    let fila = dataMes[i];
    if (fila[0] && [fila[1], fila[2], fila[3], fila[4]].every(x => !x)) {
      sucursalActual = String(fila[0]).trim();
      continue;
    }
    let cod = String(fila[0] || '').replace(/^0+/, '').trim();
    let nombre = String(fila[1] || '').trim();
    let cargo = String(fila[2] || '').trim();
    if (
      !cod || !/^\d+$/.test(cod) ||
      !nombre || nombre === "-" ||
      String(fila[0]).toLowerCase() === "cod." ||
      String(fila[1]).toLowerCase() === "nombre" ||
      ["total", "proyección", "codigo incorrecto"].includes(String(fila[1]).toLowerCase())
    ) continue;
    let bono = Number(fila[5]) || 0;

    // Detección bloque
    let bloqueTarget = sucursalActual;
    if (
      cargo.toLowerCase().includes("adm") ||
      cargo.toLowerCase().includes("supervisor") ||
      cargo.toLowerCase().includes("talento humano")
    ) {
      bloqueTarget = "Administración";
    }

    if (!bonosPorEmpleado[cod]) bonosPorEmpleado[cod] = [];
    bonosPorEmpleado[cod].push({ bloque: bloqueTarget, sucursal: sucursalActual, nombre, cargo, monto: bono });
  }

  // Agregar o actualizar empleados en la hoja de bonos
  for (const cod in bonosPorEmpleado) {
    let filaHoja = empleadosMap[cod];
    let targetBloque = bonosPorEmpleado[cod][0].bloque;
    if (!filaHoja) {
      // Buscar bloque en la hoja actual
      let bloqueIdx = bloques.findIndex(b => b.nombre === targetBloque);
      if (bloqueIdx === -1) {
        let lastRow = hojaBonos.getLastRow();
        hojaBonos.insertRowsAfter(lastRow, 2);
        hojaBonos.getRange(lastRow + 1, 1, 1, hojaBonos.getLastColumn()).merge().setValue(targetBloque)
          .setBackground("#ffe49e").setFontWeight("bold").setHorizontalAlignment("center");
        hojaBonos.getRange(lastRow + 2, 1, 1, 3)
          .setValues([[cod, bonosPorEmpleado[cod][0].nombre, bonosPorEmpleado[cod][0].cargo]]);
        empleadosMap[cod] = lastRow + 2;
      } else {
        let insertPos = bloques[bloqueIdx].fin + 1;
        hojaBonos.insertRowsAfter(insertPos, 1);
        hojaBonos.getRange(insertPos + 1, 1, 1, 3)
          .setValues([[cod, bonosPorEmpleado[cod][0].nombre, bonosPorEmpleado[cod][0].cargo]]);
        empleadosMap[cod] = insertPos + 1;
      }
      empleadosNuevos.push({ codigo: cod, nombre: bonosPorEmpleado[cod][0].nombre });
      filaHoja = empleadosMap[cod];
    }
    let total = bonosPorEmpleado[cod].reduce((sum, b) => sum + b.monto, 0);
    let cell = hojaBonos.getRange(filaHoja, colMes);
    if (total > 0) {
      cell.setValue(total)
        .setNumberFormat("$#,##0.00")
        .setVerticalAlignment("middle")
        .setHorizontalAlignment("center");

      // Solo sucursales con bono mayor a 0
      let sucursalesConBono = bonosPorEmpleado[cod].filter(b => b.monto > 0);
      if (sucursalesConBono.length > 1) {
        let comentario = sucursalesConBono
          .map(b => `${b.sucursal}: $${b.monto.toFixed(2)}`)
          .join('\n');
        comentario += `\nBono total: $${total.toFixed(2)}`;
        cell.setComment(comentario);
      } else {
        cell.setComment("");
      }
    } else {
      cell.setValue("").setComment("");
    }
  }

  // Limpiar celdas del mes para empleados sin bono este mes
  Object.keys(empleadosMap).forEach(cod => {
    if (!bonosPorEmpleado[cod]) {
      let filaHoja = empleadosMap[cod];
      hojaBonos.getRange(filaHoja, colMes).setValue("").setComment("");
    }
  });

  // Notificar empleados nuevos por Telegram si existen
  if (empleadosNuevos.length > 0) {
    let mensaje = `🚨 *Nuevos empleados detectados al llenar Bonos Anual (${mesNombre}):*\n\n` +
      empleadosNuevos.map(e => `• Código: *${e.codigo}* — Nombre: *${e.nombre}*`).join("\n");
    enviarErrorTelegram(mensaje);
  }

  // =============== BONO ADMINISTRACIÓN: $10 por CADA sucursal que cumple meta =================
  let adminIni = -1, adminFin = -1;
  for (let i = 0; i < datosBonos.length; i++) {
    if ((datosBonos[i][0] || '').toString().trim().toLowerCase() === "administración") {
      adminIni = i + 1;
      for (let j = adminIni; j < datosBonos.length; j++) {
        if ((datosBonos[j][0] || '').toString().trim() && datosBonos[j].slice(1).every(x => !x)) {
          adminFin = j - 1; break;
        }
        if (j === datosBonos.length - 1) adminFin = j;
      }
      break;
    }
  }
  if (adminIni !== -1 && adminFin !== -1) {
    let sucursalesCumplen = [];
    let sucursalActual = "";
    for (let i = 0; i < dataMes.length; i++) {
      let fila = dataMes[i];
      // Detectar bloque de sucursal
      if (fila[0] && [fila[1], fila[2], fila[3], fila[4]].every(x => !x)) {
        sucursalActual = String(fila[0]).trim();
        continue;
      }
      // Si es "Total", lee el porcentaje de meta
      if (sucursalActual && String(fila[0]).trim().toLowerCase() === "total") {
        let metaStr = (fila[4] || '').toString().replace(',', '.').replace('%', '');
        let meta = parseFloat(metaStr);
        if (!isNaN(meta) && meta >= 100) {
          sucursalesCumplen.push(sucursalActual);
        }
      }
    }
    let bonoAdmin = sucursalesCumplen.length * 10;
    for (let f = adminIni; f <= adminFin; f++) {
      let cargo = (datosBonos[f][2] || '').toString().toLowerCase();
      if (
        cargo.includes('adm') ||
        cargo.includes('supervisor') ||
        cargo.includes('talento humano')
      ) {
        let cell = hojaBonos.getRange(f + 1, colMes);
        let valorActual = Number(cell.getValue()) || 0;
        cell.setValue(valorActual + bonoAdmin)
          .setNumberFormat("$#,##0.00")
          .setVerticalAlignment("middle")
          .setHorizontalAlignment("center");
        let comentario = cell.getComment() || "";
        comentario += (comentario ? "\n" : "") +
          `Bono administración: $${bonoAdmin.toFixed(2)} por metas cumplidas en: ${sucursalesCumplen.join(', ')}`;
        cell.setComment(comentario);
      }
    }
    Logger.log(`${mesNombre}: Administración bonificada por ${sucursalesCumplen.length} sucursales`);
  } else {
    Logger.log("No se encontró bloque Administración");
  }

  // =============== BONO DOMICILIO: Toma el bono total del bloque Domicilio =================
  let domiIni = -1, domiFin = -1, filaDomicilio = null;
  for (let i = 0; i < datosBonos.length; i++) {
    if ((datosBonos[i][0] || '').toString().trim().toLowerCase() === "domicilio") {
      domiIni = i + 1;
      for (let j = domiIni; j < datosBonos.length; j++) {
        if ((datosBonos[j][0] || '').toString().trim() && datosBonos[j].slice(1).every(x => !x)) {
          domiFin = j - 1; break;
        }
        if (j === datosBonos.length - 1) domiFin = j;
      }
      break;
    }
  }
  if (domiIni !== -1 && domiFin !== -1) {
    for (let i = domiIni; i <= domiFin; i++) {
      if ((datosBonos[i][1] || '').toString().trim().toLowerCase() === "domicilio") {
        filaDomicilio = i + 1;
        break;
      }
    }
  }
  if (filaDomicilio) {
    let inDomicilio = false, bonoDomicilioTotal = 0;
    for (let i = 0; i < dataMes.length; i++) {
      let fila = dataMes[i];
      if ((fila[0] || '').toString().trim().toLowerCase() === 'domicilio' && [fila[1], fila[2], fila[3], fila[4]].every(x => !x)) {
        inDomicilio = true; continue;
      }
      if (inDomicilio && (fila[0] || '').toString().trim() && [fila[1], fila[2], fila[3], fila[4]].every(x => !x) && (fila[0] || '').toString().trim().toLowerCase() !== "total") break;
      if (inDomicilio && (fila[0] || '').toString().trim().toLowerCase() === "total") {
        bonoDomicilioTotal = Number(fila[5]) || 0;
        break;
      }
    }
    let cell = hojaBonos.getRange(filaDomicilio, colMes);
    if (bonoDomicilioTotal > 0) {
      cell.setValue(bonoDomicilioTotal)
        .setNumberFormat("$#,##0.00")
        .setVerticalAlignment("middle")
        .setHorizontalAlignment("center");
      cell.setComment("");
    } else {
      cell.setValue("").setComment("");
    }
  }
  Logger.log(`✅ Bonos anuales actualizados solo para ${mesNombre}`);
}

function onEdit(e) {
  var hoja = e.range.getSheet();
  var nombreHoja = hoja.getName();
  var meses = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
  ];
  if (meses.indexOf(nombreHoja.toLowerCase()) === -1) return;
  var col = e.range.getColumn();
  if (![3, 4, 6].includes(col)) return;
  var filaEditada = e.range.getRow();
  var lastRow = hoja.getLastRow();
  Logger.log('onEdit disparado en hoja: ' + nombreHoja + ' columna: ' + col + ' fila: ' + filaEditada);
  var filaEncabezado = null;
  for (var r = filaEditada; r > 0; r--) {
    var val = String(hoja.getRange(r, 2).getValue()).trim().toLowerCase();
    if (val === "nombre") {
      filaEncabezado = r;
      break;
    }
    if (String(hoja.getRange(r, 1).getValue()).trim().toLowerCase() === "total") {
      Logger.log("Edición fuera de bloque de empleados. No se actualiza nada.");
      return;
    }
  }
  if (!filaEncabezado) {
    Logger.log("No se encontró encabezado de bloque. No se actualiza nada.");
    return;
  }
  var filaTotal = null;
  for (var r = filaEditada; r <= lastRow; r++) {
    var celda = String(hoja.getRange(r, 1).getValue()).trim().toLowerCase();
    if (celda === "total") {
      filaTotal = r;
      break;
    }
    var val2 = String(hoja.getRange(r, 2).getValue()).trim().toLowerCase();
    if (val2 === "nombre" && r !== filaEditada) {
      Logger.log("Edición fuera de bloque de empleados (nuevo encabezado antes de Total). No se actualiza nada.");
      return;
    }
  }
  if (!filaTotal) {
    Logger.log("No se encontró bloque Total relacionado. No se actualiza nada.");
    return;
  }
  // Revisar bono especial para cargos con "J"
  const filaMeta = filaTotal;
  const porcentajeMeta = hoja.getRange(filaMeta, 5).getValue(); // columna E
  const porcentajeMetaNum = parseFloat(String(porcentajeMeta).toString().replace('%', '').replace(',', '.'));

  if (!isNaN(porcentajeMetaNum) && porcentajeMetaNum >= 90 && porcentajeMetaNum < 95) {
    Logger.log(`Meta de sucursal: ${porcentajeMetaNum}% — aplicando revisión de bono especial para cargos con 'J'`);

    for (let r = filaEncabezado + 1; r < filaTotal; r++) {
      const cargo = String(hoja.getRange(r, 4).getValue()).toLowerCase(); // Columna D
      if (cargo.includes('j')) {
        const venta = parseFloat(hoja.getRange(r, 5).getValue()) || 0; // Columna E: ventas
        const bono = venta * 0.5 / 100; // 0.5% del monto de venta
        hoja.getRange(r, 7).setValue(bono); // Columna G: bono
        hoja.getRange(r, 8).setValue("Bono especial por meta ≥90% y <95%"); // Columna H: comentario
        Logger.log(`✅ Bono especial asignado a fila ${r} por cargo con 'J': $${bono.toFixed(2)}`);
      }
    }
  }
  Logger.log('Detectado bloque de Total en fila: ' + filaTotal + ' para edición en fila: ' + filaEditada);
  actualizarBonoTotalYComentario(hoja, filaTotal);
}

function actualizarBonoTotalYComentario(hoja, filaTotal) {
  const colMonto = 4;
  const colPorc = 5;
  const colBono = 6;
  SpreadsheetApp.flush();
  Logger.log('Iniciando actualización de bloque Total fila: ' + filaTotal);
  let filaIni = filaTotal - 1;
  while (filaIni > 1 && String(hoja.getRange(filaIni, 2).getValue()).trim().toLowerCase() !== "nombre") {
    filaIni--;
  }
  filaIni++;
  let filaFin = filaTotal - 1;
  Logger.log('Rango de empleados: ' + filaIni + ' a ' + filaFin);
  let formulaOriginal = hoja.getRange(filaTotal, colBono).getFormula();
  if (!formulaOriginal) {
    hoja.getRange(filaTotal, colBono).setFormula(
      `IFERROR(IFS(E${filaTotal}>=1;D${filaTotal}*0.5%;AND(E${filaTotal}>=0.95;E${filaTotal}<1);D${filaTotal}*0.25%;TRUE;0);0)`
    );
    SpreadsheetApp.flush();
    formulaOriginal = hoja.getRange(filaTotal, colBono).getFormula();
  }
  SpreadsheetApp.flush();
  let bonoTotal = parseFloat(hoja.getRange(filaTotal, colBono).getDisplayValue().replace(/[^\d.-]/g, "").replace(",", "."));
  Logger.log('Valor mostrado en Bono Total antes de ajuste: ' + bonoTotal);
  let sumaPrueba = 0;
  let detalle = [];
  let empleadosPrueba = [];
  for (let r = filaIni; r <= filaFin; r++) {
    hoja.getRange(r, colBono).setComment("");
  }
  for (let r = filaIni; r <= filaFin; r++) {
    let cargo = String(hoja.getRange(r, 3).getValue()).toLowerCase();
    let nombre = hoja.getRange(r, 2).getValue();
    let bono = parseFloat(hoja.getRange(r, colBono).getDisplayValue().replace(/[^\d.-]/g, "").replace(",", "."));
    if (cargo.includes("prueba")) {
      if (bono > 0) {
        hoja.getRange(r, colBono).setComment("50% de bono periodo de prueba");
        empleadosPrueba.push({ nombre, bono });
        detalle.push(`- ${nombre}: $${(bono || 0).toFixed(2)}`);
        Logger.log(`--> Marcado como prueba. Acumulado sumaPrueba: ${sumaPrueba}`);
      }
      sumaPrueba += bono || 0;
    }
  }
  let bonoFinal = bonoTotal - sumaPrueba;
  Logger.log(`Bono final ajustado (sin pruebas): ${bonoFinal}`);
  hoja.getRange(filaTotal, colBono).setValue(bonoFinal);
  if (detalle.length > 0 && bonoFinal > 0) {
    let comentario = `Bono total: $${bonoTotal.toFixed(2)}\n`;
    comentario += detalle.join("\n") + `\nBono - Pruebas: $${bonoFinal.toFixed(2)}`;
    hoja.getRange(filaTotal, colBono).setComment(comentario);
    Logger.log('Comentario agregado en fila Total: ' + comentario);
  } else {
    hoja.getRange(filaTotal, colBono).setComment("");
    Logger.log('No se agrega comentario ya que no hay empleados prueba con bono > 0');
  }
  // ➕ Agregar bono de cargos con "j" si aplica por meta entre 90 y 95 y el bono original es 0
  let porcentajeMeta = parseFloat(
    String(hoja.getRange(filaTotal, colPorc).getDisplayValue()).replace(/[^\d.-]/g, "").replace(",", ".")
  );
  if (bonoTotal === 0 && !isNaN(porcentajeMeta) && porcentajeMeta >= 90 && porcentajeMeta < 95) {
    Logger.log("Meta entre 90% y 95% y bonoTotal == 0 — Buscando empleados con 'j' en el cargo");
    let bonoJ = 0;
    for (let r = filaIni; r <= filaFin; r++) {
      let cargo = String(hoja.getRange(r, 3).getValue()).toLowerCase();
      if (cargo.includes("j")) {
        let bono = parseFloat(hoja.getRange(r, colBono).getDisplayValue().replace(/[^\d.-]/g, "").replace(",", "."));
        if (!isNaN(bono) && bono > 0) {
          bonoJ += bono;
        }
      }
    }
    if (bonoJ > 0) {
      hoja.getRange(filaTotal, colBono).setValue(bonoJ);
      hoja.getRange(filaTotal, colBono).setComment("Bono ajustado por cargos con 'j' debido a meta ≥90% y <95%");
      Logger.log(`🟡 Bono ajustado a $${bonoJ}} por cumplimiento de Reporte Mensual`);
    } else {
      Logger.log("No se encontró ningún bono válido en cargos con 'j'");
    }
  }
}

function ajustarBonoYComentarioPruebaEnBloque(hoja, filaTotal) {
  const colBono = 6;  // F
  SpreadsheetApp.flush();
  let filaIni = filaTotal - 1;
  while (filaIni > 1 && String(hoja.getRange(filaIni, 2).getValue()).trim().toLowerCase() !== "nombre") {
    filaIni--;
  }
  filaIni++;
  let filaFin = filaTotal - 1;
  let bonoTotal = parseFloat(hoja.getRange(filaTotal, colBono).getDisplayValue().replace(/[^\d.-]/g, "").replace(",", "."));
  let sumaPrueba = 0;
  let detalle = [];
  let empleadosPrueba = [];
  for (let r = filaIni; r <= filaFin; r++) {
    hoja.getRange(r, colBono).setComment("");
  }
  for (let r = filaIni; r <= filaFin; r++) {
    let cargo = String(hoja.getRange(r, 3).getValue()).toLowerCase();
    let nombre = hoja.getRange(r, 2).getValue();
    let bono = parseFloat(hoja.getRange(r, colBono).getDisplayValue().replace(/[^\d.-]/g, "").replace(",", "."));
    if (cargo.includes("prueba")) {
      if (bono > 0) {
        hoja.getRange(r, colBono).setComment("50% de bono periodo de prueba");
        empleadosPrueba.push({ nombre, bono });
        detalle.push(`- ${nombre}: $${(bono || 0).toFixed(2)}`);
      }
      sumaPrueba += bono || 0;
    }
  }
  let bonoFinal = bonoTotal - sumaPrueba;
  hoja.getRange(filaTotal, colBono).setValue(bonoFinal);
  if (detalle.length > 0 && bonoFinal > 0) {
    let comentario = `Bono total: $${bonoTotal.toFixed(2)}\n`;
    comentario += detalle.join("\n") + `\nBono - Pruebas: $${bonoFinal.toFixed(2)}`;
    hoja.getRange(filaTotal, colBono).setComment(comentario);
  } else {
    hoja.getRange(filaTotal, colBono).setComment("");
  }
}

function resumenSucursal(sucursalFiltro) {
  limpiarResumenMensual();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaResumen = ss.getSheetByName("Resumen Mensual");
  const celdaMes = hojaResumen.getRange("E1").getValue().toString().toLowerCase();
  if (!celdaMes) {
    SpreadsheetApp.getUi().alert("Selecciona un mes en E1.");
    return;
  }
  const hojaMes = ss.getSheetByName(celdaMes);
  if (!hojaMes) {
    SpreadsheetApp.getUi().alert("No existe la hoja de ese mes.");
    return;
  }
  if (!sucursalFiltro) {
    SpreadsheetApp.getUi().alert("Indica una sucursal válida como parámetro.");
    return;
  }
  hojaResumen.getRange(4, 2, hojaResumen.getMaxRows() - 3, hojaResumen.getMaxColumns() - 1)
    .clearContent().setBorder(false, false, false, false, false, false);
  const data = hojaMes.getDataRange().getValues();
  let tablas = {};
  let encabezados = {};
  let proyecciones = {};
  let sucursalActual = "";

  function valorPorcentajeCelda(valor) {
    if (typeof valor === 'string' && valor.includes('%')) return valor.trim();
    if (!isNaN(valor) && valor !== "" && valor !== null) {
      let num = parseFloat(valor);
      // Si es mayor a 2, asume que viene como 95, 113, etc.
      if (num > 2) return num.toFixed(2) + "%";
      // Si es 2 o menos, asume que viene como 0.95, 1.13, etc.
      return (num * 100).toFixed(2) + "%";
    }
    return "-";
  }
  for (let i = 0; i < data.length; i++) {
    let fila = data[i];
    if (fila[0] && [fila[1], fila[2], fila[3], fila[4], fila[5]].slice(1).every(x => !x)) {
      sucursalActual = String(fila[0]).trim();
      if (sucursalActual !== sucursalFiltro) sucursalActual = "";
      else {
        tablas[sucursalActual] = [];
        encabezados[sucursalActual] = { porc: "-" };
        proyecciones[sucursalActual] = { porc: "-" };
      }
      continue;
    }
    if (sucursalActual !== sucursalFiltro) continue;
    let colA = fila[0] ? String(fila[0]).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() : "";
    if (colA === "total" && sucursalActual) {
      encabezados[sucursalActual].porc = valorPorcentajeCelda(fila[4]);
      continue;
    }
    if (colA === "proyeccion" && sucursalActual) {
      proyecciones[sucursalActual] = {
        porc: valorPorcentajeCelda(fila[4])
      };
      continue;
    }
    if (
      !fila[0] || fila[0] === "-" ||
      String(fila[1]).toLowerCase() === "nombre" ||
      ["codigo incorrecto"].includes(String(fila[1]).toLowerCase())
    ) continue;
    if (!sucursalActual || sucursalActual.toLowerCase() === "domicilio") continue;
    if (!fila[0] || !fila[1]) continue;
    let porcentajeReal = parseFloat(fila[4]);
    if (isNaN(porcentajeReal) || porcentajeReal < 0.01) continue;
    tablas[sucursalActual].push({
      nombre: fila[1],
      porcentaje: porcentajeReal,
      bono: parseFloat((fila[5] || "0").toString().replace("$", "")),
    });
  }
  if (!tablas[sucursalFiltro]) {
    SpreadsheetApp.getUi().alert("No se encontraron datos para la sucursal: " + sucursalFiltro);
    return;
  }
  let startRow = 4;
  let startCol = 2;
  let ancho = 3;
  const altoFila = 40;
  const anchoEmpleado = 160, anchoPorc = 90, anchoBono = 90;
  let empleados = tablas[sucursalFiltro];
  empleados.sort((a, b) => (b.porcentaje || 0) - (a.porcentaje || 0));
  let nEmpleados = empleados.length;
  let porcSucursalStr = encabezados[sucursalFiltro] && encabezados[sucursalFiltro].porc ? encabezados[sucursalFiltro].porc : "0.00%";
  let porcSucursal = parseFloat(porcSucursalStr.replace("%", "")) || 0;
  let color = "#F4CCCC";
  if (porcSucursal >= 100) color = "#B6D7A8";
  else if (porcSucursal >= 95) color = "#FFE599";
  hojaResumen.getRange(startRow, startCol, 1, ancho).merge()
    .setValue(`${sucursalFiltro}  ${porcSucursalStr}`)
    .setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBackground(color)
    .setBorder(true, true, true, true, null, null);
  let proy = proyecciones[sucursalFiltro];
  let porcProy = proy && proy.porc ? proy.porc : "-";
  hojaResumen.getRange(startRow + 1, startCol, 1, ancho).merge()
    .setValue(`Proyección: ${porcProy}`)
    .setFontStyle('italic').setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBackground("#F7F7F7").setBorder(true, true, true, true, null, null);
  hojaResumen.getRange(startRow + 2, startCol, 1, ancho)
    .setValues([["Empleado", "% Venta", "Bono"]])
    .setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setBorder(true, true, true, true, null, null);
  let rows = [];
  for (let i = 0; i < nEmpleados; i++) {
    rows.push([
      empleados[i].nombre,
      valorPorcentajeCelda(empleados[i].porcentaje),
      "$" + (empleados[i].bono || 0).toFixed(2)
    ]);
  }
  if (rows.length > 0) {
    hojaResumen.getRange(startRow + 3, startCol, rows.length, ancho)
      .setValues(rows)
      .setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBorder(true, true, true, true, null, null);
    for (let i = 0; i < rows.length; i++) {
      hojaResumen.setRowHeight(startRow + 3 + i, altoFila);
    }
  }
  hojaResumen.setRowHeight(startRow, altoFila);
  hojaResumen.setRowHeight(startRow + 1, altoFila);
  hojaResumen.setRowHeight(startRow + 2, altoFila);
  hojaResumen.setColumnWidth(startCol, anchoEmpleado);
  hojaResumen.setColumnWidth(startCol + 1, anchoPorc);
  hojaResumen.setColumnWidth(startCol + 2, anchoBono);
}

function resumenTodas() {
  limpiarResumenMensual();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaResumen = ss.getSheetByName("Resumen Mensual");
  const celdaMes = hojaResumen.getRange("E1").getValue().toString().toLowerCase();
  if (!celdaMes) {
    SpreadsheetApp.getUi().alert("Selecciona un mes en E1.");
    return;
  }
  const hojaMes = ss.getSheetByName(celdaMes);
  if (!hojaMes) {
    SpreadsheetApp.getUi().alert("No existe la hoja de ese mes.");
    return;
  }
  hojaResumen.getRange(4, 2, hojaResumen.getMaxRows() - 3, hojaResumen.getMaxColumns() - 1)
    .clearContent().setBorder(false, false, false, false, false, false);
  const data = hojaMes.getDataRange().getValues();
  let tablas = {};
  let encabezados = {};
  let proyecciones = {};
  let sucursalActual = "";

  function valorPorcentajeCelda(valor) {
    if (typeof valor === 'string' && valor.includes('%')) return valor.trim();
    if (!isNaN(valor) && valor !== "" && valor !== null) {
      let num = parseFloat(valor);
      // Si es mayor a 2, asume que viene como 95, 113, etc. (lo divides entre 100)
      if (num > 2) return (num).toFixed(2) + "%";
      // Si es 2 o menos, asume que viene como 0.95, 1.13, etc.
      return (num * 100).toFixed(2) + "%";
    }
    return "-";
  }
  for (let i = 0; i < data.length; i++) {
    let fila = data[i];
    if (fila[0] && [fila[1], fila[2], fila[3], fila[4], fila[5]].every(x => !x)) {
      sucursalActual = String(fila[0]).trim();
      tablas[sucursalActual] = [];
      encabezados[sucursalActual] = { porc: "-" };
      proyecciones[sucursalActual] = { porc: "-" };
      continue;
    }
    let colA = fila[0] ? String(fila[0]).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim() : "";
    if (colA === "total" && sucursalActual) {
      encabezados[sucursalActual].porc = valorPorcentajeCelda(fila[4]);
      continue;
    }
    if (colA === "proyeccion" && sucursalActual) {
      proyecciones[sucursalActual] = { porc: valorPorcentajeCelda(fila[4]) };
      continue;
    }
    if (!fila[0] || fila[0] === "-" || String(fila[1]).toLowerCase() === "nombre" || ["codigo incorrecto"].includes(String(fila[1]).toLowerCase())) continue;
    if (!sucursalActual || sucursalActual.toLowerCase() === "domicilio") continue;
    if (!fila[0] || !fila[1]) continue;
    let porcentajeReal = parseFloat(fila[4]);
    if (isNaN(porcentajeReal) || porcentajeReal < 0.01) continue;
    tablas[sucursalActual].push({
      nombre: fila[1],
      porcentaje: porcentajeReal,
      monto: parseFloat((fila[3] || "0").toString().replace(/[$,]/g, "")),
      bono: parseFloat((fila[5] || "0").toString().replace(/[$,]/g, ""))
    });
  }
  let totalGlobalVenta = 0;
  for (let i = 0; i < data.length; i++) {
    let fila = data[i];
    let colA = fila[0] ? String(fila[0]).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";
    if (colA === "total" && !isNaN(parseFloat((fila[3] || "0").toString().replace(/[$,]/g, "")))) {
      totalGlobalVenta += parseFloat((fila[3] || "0").toString().replace(/[$,]/g, ""));
    }
  }
  let empleadosGlobal = {};
  for (let suc in tablas) {
    tablas[suc].forEach(emp => {
      if (!empleadosGlobal[emp.nombre]) empleadosGlobal[emp.nombre] = 0;
      empleadosGlobal[emp.nombre] += emp.monto;
    });
  }
  let topEmpleados = Object.entries(empleadosGlobal)
    .map(([nombre, monto]) => ({
      nombre,
      monto,
      porcentaje: totalGlobalVenta > 0 ? (monto / totalGlobalVenta) * 100 : 0
    }))
    .sort((a, b) => b.porcentaje - a.porcentaje)
    .slice(0, 3);
  let startRow = 4;
  let startCol = 2;
  const ancho = 3;
  const altoFila = 40;
  const anchoEmpleado = 160, anchoPorc = 90, anchoBono = 90;
  Object.keys(encabezados).forEach((suc, idx) => {
    let empleados = tablas[suc] || [];
    empleados.sort((a, b) => (b.porcentaje || 0) - (a.porcentaje || 0));
    let porcSucursalStr = encabezados[suc]?.porc || "0.00%";
    let porcSucursal = parseFloat(porcSucursalStr.replace("%", "")) || 0;
    let color = porcSucursal >= 100 ? "#B6D7A8" : porcSucursal >= 95 ? "#FFE599" : "#F4CCCC";
    hojaResumen.getRange(startRow, startCol, 1, ancho).merge()
      .setValue(`${suc}  ${porcSucursalStr}`)
      .setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBackground(color).setBorder(true, true, true, true, null, null);
    let proy = proyecciones[suc];
    let porcProy = proy?.porc || "-";
    hojaResumen.getRange(startRow + 1, startCol, 1, ancho).merge()
      .setValue(`Proyección: ${porcProy}`)
      .setFontStyle('italic').setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBackground("#F7F7F7").setBorder(true, true, true, true, null, null);
    if (suc.toLowerCase() === "domicilio") {
      hojaResumen.getRange(startRow + 2, startCol, 1, ancho).clearContent();
      hojaResumen.getRange(startRow + 3, startCol, 1, ancho).merge()
        .setValue("TOP 3 Global")
        .setFontWeight('bold')
        .setFontSize(14)
        .setHorizontalAlignment('center')
        .setVerticalAlignment('middle')
        .setBackground('#EDEDED')
        .setBorder(true, true, true, true, null, null);
      for (let i = 0; i < 3; i++) {
        let emp = topEmpleados[i] || { nombre: "", porcentaje: 0 };
        hojaResumen.getRange(startRow + 4 + i, startCol, 1, ancho).merge()
          .setValue(emp.nombre ? `${emp.nombre} - ${emp.porcentaje.toFixed(2)}%` : "")
          .setFontWeight('bold')
          .setFontSize(12)
          .setHorizontalAlignment('center')
          .setVerticalAlignment('middle')
          .setBorder(true, true, true, true, null, null);
      }
      for (let f = 0; f < 4 + 3; f++) hojaResumen.setRowHeight(startRow + f, altoFila);
      hojaResumen.setColumnWidth(startCol, anchoEmpleado);
      hojaResumen.setColumnWidth(startCol + 1, anchoPorc);
      hojaResumen.setColumnWidth(startCol + 2, anchoBono);
      startCol += ancho + 1;
      return;
    }
    hojaResumen.getRange(startRow + 2, startCol, 1, ancho)
      .setValues([["Empleado", "% Venta", "Bono"]])
      .setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle')
      .setBorder(true, true, true, true, null, null);

    let rows = empleados.map(e => [e.nombre, (e.porcentaje * 100).toFixed(2) + "%", "$" + (e.bono || 0).toFixed(2)]);
    if (rows.length > 0) {
      hojaResumen.getRange(startRow + 3, startCol, rows.length, ancho)
        .setValues(rows)
        .setHorizontalAlignment('center').setVerticalAlignment('middle')
        .setBorder(true, true, true, true, null, null);
      rows.forEach((_, i) => hojaResumen.setRowHeight(startRow + 3 + i, altoFila));
      // Copia comentarios de bono
      let colBono = 5;
      let filaInicio = data.findIndex(f => String(f[0]).trim() === suc);
      let filaFin = data.length;
      for (let j = filaInicio + 1; j < data.length; j++) {
        if (data[j][0] && [data[j][1], data[j][2], data[j][3], data[j][4], data[j][5]].every(x => !x)) {
          filaFin = j;
          break;
        }
      }
      for (let i = 0; i < empleados.length; i++) {
        let emp = empleados[i];
        let idxData = -1;
        for (let k = filaInicio + 1; k < filaFin; k++) {
          if (String(data[k][1]).trim() === emp.nombre) {
            idxData = k;
            break;
          }
        }
        if (idxData === -1) continue;
        let celdaBono = hojaMes.getRange(idxData + 1, colBono + 1);
        let nota = celdaBono.getNote();
        if (nota) {
          hojaResumen.getRange(startRow + 3 + i, startCol + 2).setNote(nota);
        }
      }
    }
    hojaResumen.setRowHeight(startRow, altoFila);
    hojaResumen.setRowHeight(startRow + 1, altoFila);
    hojaResumen.setRowHeight(startRow + 2, altoFila);
    hojaResumen.setColumnWidth(startCol, anchoEmpleado);
    hojaResumen.setColumnWidth(startCol + 1, anchoPorc);
    hojaResumen.setColumnWidth(startCol + 2, anchoBono);
    startCol += ancho + 1;
  });
}

function limpiarResumenMensual() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaResumen = ss.getSheetByName("Resumen Mensual");
  if (!hojaResumen) {
    SpreadsheetApp.getUi().alert("No existe la hoja 'Resumen Mensual'.");
    return;
  }
  const maxFilas = hojaResumen.getMaxRows();
  const maxColumnas = hojaResumen.getMaxColumns();
  hojaResumen.getRange(4, 2, maxFilas - 3, maxColumnas - 1)
    .breakApart()
    .clearContent()
    .clearNote()
    .setBorder(false, false, false, false, false, false)
    .setBackground(null)
    .setFontColor(null)
    .setFontWeight("normal")
    .setFontStyle("normal");
}

function resumenLaPopular() {
  resumenSucursal("La Popular");
}

function resumenSalud1() {
  resumenSucursal("Salud 1");
}

function resumenSalud2() {
  resumenSucursal("Salud 2");
}

function resumenSalud3() {
  resumenSucursal("Salud 3");
}

function resumenSalud4() {
  resumenSucursal("Salud 4");
}

function resumenSalud5() {
  resumenSucursal("Salud 5");
}

function enviarResumenTelegram() {
  const TELEGRAM_TOKEN = "7759397686:AAHiJemJV2_ZAEfFV2RiQZ5ZsC3cTK_uBos";
  const TELEGRAM_CHAT_ID = "-1002699935226";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaBonos = ss.getSheetByName("Laboratorios bonificados");
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const mesesNom = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  let hoy = new Date();
  let dia = hoy.getDate();
  let mesActual = hoy.getMonth();
  let anioActual = hoy.getFullYear();
  let mesReporte = mesActual;
  let anioReporte = anioActual;
  let esUltimoDia = false;
  let mensajeFecha = "";
  if (dia === 1) {
    esUltimoDia = true;
    mesReporte = mesActual - 1;
    if (mesReporte < 0) {
      mesReporte = 11;
      anioReporte -= 1;
    }
    let ultDiaAnterior = new Date(anioReporte, mesReporte + 1, 0).getDate();
    mensajeFecha = `${ultDiaAnterior} de ${mesesNom[mesReporte]}`;
  } else {
    esUltimoDia = false;
    mensajeFecha = `${dia - 1} de ${mesesNom[mesActual]}`;
    mesReporte = mesActual;
    anioReporte = anioActual;
  }
  let nombreHoja = meses[mesReporte];
  const hojaMes = ss.getSheetByName(nombreHoja);
  if (!hojaMes || !hojaBonos) {
    SpreadsheetApp.getUi().alert("No existe la hoja del mes o Laboratorios bonificados.");
    return;
  }
  const data = hojaMes.getDataRange().getValues();
  let sucursales = [];
  for (let i = 0; i < data.length; i++) {
    let fila = data[i];
    if (fila[0] && [fila[1], fila[2], fila[3], fila[4], fila[5]].every(x => !x)) {
      let nombre = fila[0].trim();
      if (nombre && nombre.toLowerCase() !== "domicilio" && nombre.toLowerCase() !== "bodega") {
        sucursales.push({ nombre, filaInicio: i });
      }
    }
  }
  let resumenSucursales = [
    "`Sucursal     % Venta  | Proy:    %`"
  ];
  for (let s = 0; s < sucursales.length; s++) {
    let info = sucursales[s];
    let filaTotal = -1, filaProy = -1;
    for (let i = info.filaInicio + 1; i < data.length; i++) {
      let colA = String(data[i][0] || "").toLowerCase().trim();
      if (colA === "total") filaTotal = i;
      if (colA === "proyección" || colA === "proyeccion") { filaProy = i; break; }
      if (data[i][0] && i !== info.filaInicio && [data[i][1], data[i][2], data[i][3], data[i][4], data[i][5]].every(x => !x)) break;
    }
    let pctVenta = (filaTotal > -1) ? (data[filaTotal][4] || "-") : "-";
    let pctProy = (filaProy > -1) ? (data[filaProy][4] || "-") : "-";
    let pct = limpiarPorcentaje(pctVenta);
    let proy = limpiarPorcentaje(pctProy);
    let icono = "🔴";
    const valorParaColor = esUltimoDia ? pct : proy;
    if (valorParaColor >= 1) icono = "🟢";
    else if (valorParaColor >= 0.95) icono = "🟠";
    const nombreLabel = info.nombre.padEnd(11, " ");
    const ventaLabel = `${(pct * 100).toFixed(2)}%`.padStart(7, " ");
    const proyLabel = esUltimoDia ? "" : `| Proy: ${(proy * 100).toFixed(2)}%`.padStart(12, " ");
    resumenSucursales.push(`\`${icono} ${nombreLabel}${ventaLabel}${proyLabel}\``);
  }
  let mensaje = esUltimoDia
    ? `📊 *Reporte final de ventas de ${mesesNom[mesReporte]}*\n\n`
    : `📊 *Resumen diario Ventas al - ${mensajeFecha}*\n\n`;
  mensaje += resumenSucursales.join("\n") + "\n";
  let empleadosGlobal = {};
  let totalGlobalVenta = 0;
  for (let i = 0; i < data.length; i++) {
    let fila = data[i];
    let colA = String(fila[0] || "").toLowerCase().trim();
    let nombre = (fila[1] || "").toString().trim();
    let monto = parseFloat((fila[3] || "0").toString().replace(/[$,]/g, ""));
    if (
      colA && colA !== "total" && colA !== "proyección" && colA !== "codigo incorrecto" &&
      nombre && nombre.toLowerCase() !== "nombre" && monto > 0
    ) {
      if (!empleadosGlobal[nombre]) empleadosGlobal[nombre] = 0;
      empleadosGlobal[nombre] += monto;
      totalGlobalVenta += monto;
    }
  }
  let top3 = Object.entries(empleadosGlobal)
    .map(([nombre, monto]) => ({
      nombre,
      monto,
      porcentaje: totalGlobalVenta > 0 ? (monto / totalGlobalVenta) * 100 : 0
    }))
    .sort((a, b) => b.porcentaje - a.porcentaje)
    .slice(0, 3);
  mensaje += `\n*Top 3 Vendedores Globales:*\n`;
  const medallas = ["🥇", "🥈", "🥉"];
  for (let i = 0; i < 3; i++) {
    const emp = top3[i];
    if (emp && emp.nombre) {
      const badge = medallas[i];
      const nameLabel = emp.nombre.padEnd(20, " ");
      const pctLabel = `${emp.porcentaje.toFixed(2)}%`.padStart(7, " ");
      mensaje += `\`${badge} ${nameLabel}${pctLabel}\`\n`;
    }
  }
  const dataBonos = hojaBonos.getDataRange().getValues();
  const resumenBonos = [];
  resumenBonos.push("`Sucursal     Bono   % Avance   ➡️ Sgte.`");
  for (let fila = 1; fila < dataBonos.length; fila++) {
    const nombreSucursal = (dataBonos[fila][3] || "").toString().trim();
    if (!nombreSucursal) continue;
    const filaSucursal = data.findIndex(row =>
      (row[0] || "").toString().trim().toLowerCase() === nombreSucursal.toLowerCase()
    );
    if (filaSucursal === -1) continue;
    let colInicio = -1;
    for (let c = 0; c < data[0].length; c++) {
      if ((data[filaSucursal][c] || "").toString().trim().toLowerCase() === "laboratorios bonificados") {
        colInicio = c;
        break;
      }
    }
    if (colInicio === -1) continue;
    let totalBonificado = 0;
    for (let i = filaSucursal + 1; i < data.length; i++) {
      const celda = (data[i][colInicio] || "").toString().trim().toLowerCase();
      if (celda === "total") {
        let monto = parseFloat((data[i][colInicio + 1] || "").toString().replace(/[$,]/g, ""));
        if (!isNaN(monto)) totalBonificado = monto;
        break;
      }
    }
    const metas = [4, 5, 6, 7].map(c =>
      parseFloat((dataBonos[fila][c] || "0").toString().replace(/[$,]/g, "")) || 0
    );
    const umbrales = [10, 20, 30, 40]; // ajusta si el 4to nivel no paga 40

    let nivel = 0;
    for (let i = 0; i < metas.length; i++) {
      if (totalBonificado >= metas[i]) nivel = i + 1;
    }

    const siguienteMeta = nivel < metas.length ? metas[nivel] : metas[metas.length - 1];
    const siguienteBono = nivel < umbrales.length ? umbrales[nivel] : umbrales[umbrales.length - 1];
    const bonoGanado = nivel > 0 ? umbrales[nivel - 1] : 0;
    const avance = siguienteMeta > 0 ? totalBonificado / siguienteMeta : 0;
    let icono = bonoGanado > 0 ? "🟢" : "🔴";
    resumenBonos.push(
      `\`${icono} ${nombreSucursal.padEnd(11)} ` +
      `$${bonoGanado.toString().padEnd(3)} ` +
      `| ${(avance * 100).toFixed(2).padStart(6)}%    $${siguienteBono}\``
    );
  }
  if (resumenBonos.length > 1) {
    mensaje += `\n💊 *Bono por Laboratorio:*\n` + resumenBonos.join("\n");
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: mensaje,
    parse_mode: "Markdown"
  };
  UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  });
  borrarTrigger("enviarResumenTelegram");
}

function limpiarPorcentaje(pct) {
  if (typeof pct === "string") {
    pct = pct.trim();
    if (pct.toLowerCase().includes("finalizado") || pct === "-") return 0;
    if (pct.includes("%")) {
      let v = parseFloat(pct.replace("%", "").replace(",", "."));
      return isNaN(v) ? 0 : v / 100;
    }
    let v = parseFloat(pct.replace(",", "."));
    if (isNaN(v)) return 0;
    return v > 5 ? v / 100 : v;
  }
  if (typeof pct === "number") return pct > 5 ? pct / 100 : pct;
  return 0;
}


function enviarErrorTelegram(mensaje) {
  const CHAT_ID = "6949423150";
  const TOKEN = "7759397686:AAHiJemJV2_ZAEfFV2RiQZ5ZsC3cTK_uBos";
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;

  const payload = {
    chat_id: CHAT_ID,
    text: mensaje,
    parse_mode: "Markdown"
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };

  try {
    UrlFetchApp.fetch(url, options);
  } catch (e) {
    Logger.log(`❌ Falló al enviar mensaje Telegram: ${e}`);
  }
}

const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function actualizartabla() {
  const hoy = new Date();
  let dia = hoy.getDate();
  let mes = hoy.getMonth();
  let anio = hoy.getFullYear();
  if (dia === 1) {
    mes = mes - 1;
    if (mes < 0) { mes = 11; anio = anio - 1; }
  }
  const nombreMes = meses[mes];

  const props = PropertiesService.getScriptProperties();
  const intentos = parseInt(props.getProperty("intentos_ventas") || "0", 10);

  try {
    crearHojaMensualDesdePersonal(nombreMes);
    procesarVentasTodasSucursales(nombreMes);

    props.setProperty("mes_proceso", nombreMes);
    props.setProperty("anio_proceso", anio);
    props.setProperty("dia_proceso", dia);
    props.deleteProperty("intentos_ventas");

    ScriptApp.newTrigger("actualizarTablaLaboratorios")
      .timeBased()
      .after(5000)
      .create();

    Logger.log("✔️ Ventas procesadas correctamente");
  } catch (error) {
    Logger.log(`❌ Error en actualizartabla: ${error.message}`);

    if (intentos < 3) {
      props.setProperty("intentos_ventas", intentos + 1);
      ScriptApp.newTrigger("actualizartabla")
        .timeBased()
        .after(10000)
        .create();
      Logger.log(`🔁 Reintentando actualizartabla (${intentos + 1}/3)`);
    } else {
      props.deleteProperty("intentos_ventas");
      const msg = `❌ *Error al procesar ventas mensuales*\n*Mes:* ${nombreMes.toUpperCase()}\n*Motivo:* ${error.message}`;
      enviarErrorTelegram(msg);
    }
  }
}

function actualizarTablaLaboratorios() {
  const props = PropertiesService.getScriptProperties();
  const nombreMes = props.getProperty("mes_proceso");
  const anio = parseInt(props.getProperty("anio_proceso"), 10);
  const dia = parseInt(props.getProperty("dia_proceso"), 10);
  const intentos = parseInt(props.getProperty("intentos_lab") || "0", 10);

  const laboratoriosBuscados = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("Laboratorios bonificados")
    .getRange("B2:B6").getValues().flat();

  const hojaBonificados = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Laboratorios bonificados");
  const tablaBonosRaw = hojaBonificados.getRange("D2:H7").getValues(); // ahora incluye H

  const tablaBonos = {};
  ["La Popular", "Salud 1", "Salud 2", "Salud 3", "Salud 4", "Salud 5"].forEach((suc, idx) => {
    // D = sucursal, E:H = metas
    tablaBonos[suc] = (tablaBonosRaw[idx] && tablaBonosRaw[idx].length >= 5)
      ? tablaBonosRaw[idx].slice(1)   // toma E,F,G,H
      : [0, 0, 0, 0];
  });

  const sucursales = [
    { nombre: "La Popular", credentials: { username: "documentop.supervisor", password: "documento9999" }, id: 5 },
    { nombre: "Salud 1", credentials: { username: "documento1.supervisor", password: "documento9999" }, id: 1 },
    { nombre: "Salud 2", credentials: { username: "documento2.supervisor", password: "documento9999" }, id: 2 },
    { nombre: "Salud 3", credentials: { username: "documento3.supervisor", password: "documento9999" }, id: 3 },
    { nombre: "Salud 4", credentials: { username: "documento4.supervisor", password: "documento9999" }, id: 4 },
    { nombre: "Salud 5", credentials: { username: "documento5.supervisor", password: "documento9999" }, id: 7 }
  ];

  const errores = [];
  for (const suc of sucursales) {
    let intento = 0;
    let exito = false;
    while (intento < 3 && !exito) {
      try {
        Logger.log(`📦 Procesando ${suc.nombre}, intento ${intento + 1}`);
        const sessionCookie = iniciarSesion(suc.credentials);
        if (!sessionCookie) throw new Error(`Sesión fallida para ${suc.nombre}`);
        const mesIndex = meses.indexOf(nombreMes);
        const mesStr = (mesIndex + 1).toString().padStart(2, '0');
        const ultimoDia = new Date(anio, mesIndex + 1, 0).getDate();
        const url = `https://clientesdte3.oss.com.sv/farma_salud/reporte_ventas_laboratorio_pdf.php?fini=${anio}-${mesStr}-01&ffin=${anio}-${mesStr}-${ultimoDia.toString().padStart(2, '0')}&id_sucursal=${suc.id}`;
        const pdfBlob = descargarPDF(sessionCookie, url, `ventas_lab_${suc.nombre}.pdf`);
        if (!pdfBlob) throw new Error(`PDF no descargado para ${suc.nombre}`);
        const ventasLab = extraerVentasLaboratorios(pdfBlob, laboratoriosBuscados);
        colocarVentasLaboratorios(nombreMes, suc.nombre, ventasLab, tablaBonos);
        Logger.log(`✅ ${suc.nombre} procesado exitosamente.`);
        exito = true;
      } catch (error) {
        Logger.log(`❌ Error en ${suc.nombre}, intento ${intento + 1}: ${error.message}`);
        // ⚠️ Manejo especial del error de límite diario urlfetch
        if (error.message && error.message.includes("Service invoked too many times for one day: urlfetch")) {
          Logger.log("🚨 Límite de urlfetch alcanzado. Reintentando en 1 hora.");
          props.setProperty("intentos_lab", intentos + 1);
          borrarTrigger("actualizarTablaLaboratorios");
          ScriptApp.newTrigger("actualizarTablaLaboratorios")
            .timeBased()
            .after(60 * 60 * 1000) // 1 hora en ms
            .create();
          enviarErrorTelegram(`🚨 Límite de *urlfetch* alcanzado.\nSe reintentará la actualización de laboratorios en 1 hora.`);
          return; // Sale completamente de la función, no sigue con otras sucursales
        }
        intento++;
        if (intento < 3) Utilities.sleep(4000);
      }
    }
    if (!exito) {
      errores.push(`${suc.nombre}: No se pudo procesar tras 3 intentos`);
    }
  }

  if (errores.length > 0 && intentos < 3) {
    Logger.log(`🔁 Reintentando laboratorios. Fallaron: ${errores.join(", ")}`);
    props.setProperty("intentos_lab", intentos + 1);
    ScriptApp.newTrigger("actualizarTablaLaboratorios")
      .timeBased()
      .after(5000)
      .create();
    return;
  }

  if (errores.length > 0) {
    Logger.log("❌ Se alcanzaron los 3 intentos. Proceso finalizado con errores.");
    const msg = `❌ *Error al procesar laboratorios*\n*Mes:* ${nombreMes.toUpperCase()}\n*Errores:*\n${errores.join("\n")}`;
    enviarErrorTelegram(msg);
    props.deleteProperty("intentos_lab");
    borrarTrigger("actualizarTablaLaboratorios");
    return;
  }

  llenarBonosAnualPorMes();

  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombreMes);
  if (hoja) {
    const fechaHora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
    hoja.getRange("I1").setValue(fechaHora);
  }

  Logger.log("✔️ Todos los laboratorios procesados correctamente.");
  props.deleteProperty("intentos_lab");
  borrarTrigger("actualizarTablaLaboratorios");

  const NOMBRES = ["enviarResumenTelegram", "enviarResumenPorSucursal"];
  const existentes = ScriptApp.getProjectTriggers();
  existentes.forEach(t => {
    if (NOMBRES.includes(t.getHandlerFunction())) {
      ScriptApp.deleteTrigger(t);
    }
  });
  // 1. Programar enviarResumenTelegram TODOS los días a las 8 am (siempre, sin cambios)
  const ahora = new Date();
  const hoy8am = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 8, 0, 0, 0);

  // Elimina duplicados de enviarResumenTelegram
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "enviarResumenTelegram") {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger("enviarResumenTelegram")
    .timeBased().at(hoy8am).create();
  Logger.log("✅ Trigger 'enviarResumenTelegram' programado para hoy 8am");

  // 2. Lógica SOLO para enviarResumenPorSucursal
  const diaSemana = ahora.getDay(); // 0=Dom, 1=Lun, ... , 5=Vie
  const diaMes = ahora.getDate();
  const esLunesOViernes = (diaSemana === 1 || diaSemana === 2 || diaSemana === 3 || diaSemana === 4 || diaSemana === 5 || diaSemana === 6);
  const esPrimeroMes = (diaMes === 1);

  // Elimina duplicados de enviarResumenPorSucursal
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "enviarResumenPorSucursal") {
      ScriptApp.deleteTrigger(t);
    }
  });

  if (esLunesOViernes || esPrimeroMes) {
    ScriptApp.newTrigger("enviarResumenPorSucursal")
      .timeBased()
      .at(hoy8am)   // se mantiene 8:00 am
      .create();
    Logger.log("✅ Trigger 'enviarResumenPorSucursal' programado para hoy 8am (lunes/viernes o 1 de mes).");
  } else {
    Logger.log("⏩ Hoy NO es lunes, NI viernes, NI 1 de mes. NO se programa 'enviarResumenPorSucursal'.");
  }
}

function borrarTrigger(nombreFuncion) {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === nombreFuncion) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

const TELEGRAM_TOKEN_Sucursal = "7786853905:AAEK9iP7tOLl_RnTb8CO2IO_81y5DFTarqU";

// Detecta si el cargo corresponde a Jefe (token 'J' entre comas/espacios)
function esJefe(cargo) {
  return String(cargo || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[,\s]+/)
    .includes("J");
}

function enviarResumenPorSucursal() {
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const now = new Date();

  // Fecha del resumen (ayer, o último día del mes si hoy es 1)
  let ant = new Date(now);
  let diaResumen, mesResumen, anioResumen;
  if (now.getDate() === 1) {
    ant = new Date(now.getFullYear(), now.getMonth(), 0);
    diaResumen = ant.getDate();
    mesResumen = ant.getMonth();
    anioResumen = ant.getFullYear();
  } else {
    ant.setDate(now.getDate() - 1);
    diaResumen = ant.getDate();
    mesResumen = ant.getMonth();
    anioResumen = ant.getFullYear();
  }

  const MES_NOMBRES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const MES_NOMBRES_MAYUS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const mesNombre = MES_NOMBRES[mesResumen];
  const mesNombreBonito = MES_NOMBRES_MAYUS[mesResumen];

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaMes = ss.getSheetByName(mesNombre);
  const hojaBonos = ss.getSheetByName("Laboratorios bonificados");
  if (!hojaMes || !hojaBonos) {
    Logger.log("No se encontró la hoja del mes o la hoja de bonos.");
    return;
  }
  const data = hojaMes.getDataRange().getValues();
  const dataBonos = hojaBonos.getDataRange().getValues();

  // NEW: leer la hoja de metas
  const hojaAsign = ss.getSheetByName("Asignacion de Metas");
  const dataAsign = hojaAsign ? hojaAsign.getDataRange().getValues() : [];

  // Helpers
  const formatPct = v => `${(v * 100).toFixed(2)}%`;
  const moneyNum = (x) => parseFloat(String(x || "0").replace(/[$,\s]/g, "")) || 0;
  const moneyStr = (n) => {
    const v = Number(n || 0);
    return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // NEW: obtiene la meta de una sucursal para el mes (busca el bloque y toma la fila de valores del bloque)
  // Reemplazar este helper en tu función enviarResumenPorSucursal
  function getMetaSucursalMes(nombreSucursal, mesIdx, dataAsign) {
    if (!dataAsign || !dataAsign.length) return null;

    const norm = s => String(s || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().trim();

    const MESES_NORM = new Set([
      "enero", "febrero", "marzo", "abril", "mayo", "junio",
      "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
    ]);

    const rTitulo = dataAsign.findIndex(r => norm(r[0]) === norm(nombreSucursal));
    if (rTitulo < 0) return null;

    // En tu hoja los meses están en A..L => 0..11
    const colMes = mesIdx; // 0=Enero(A), 1=Febrero(B)...

    for (let r = rTitulo + 1; r < dataAsign.length; r++) {
      const a = dataAsign[r][0];
      const aStr = String(a || "").trim();
      const aNorm = norm(aStr);

      // ✅ Cortar solo cuando sea OTRO título de sucursal (texto, no mes, no número)
      const pareceTitulo =
        aStr &&
        !/\d/.test(aStr) &&
        !MESES_NORM.has(aNorm) &&
        dataAsign[r].slice(1, 12).every(v => v == null || v === "");

      if (pareceTitulo) break;

      const val = dataAsign[r][colMes];
      if (val == null || val === "") continue;

      if (typeof val === "number" && !isNaN(val)) return val;

      const s = String(val).trim();
      if (!/\d/.test(s)) continue;

      return parseFloat(s.replace(/[$,\s]/g, "")) || 0;
    }

    return null;
  }
  const sucursalesConfig = [
    { nombre: "La Popular", chatId: "-1003304818287" },
    { nombre: "Salud 1", chatId: "-1003550674686" },
    { nombre: "Salud 2", chatId: "-1003442451040" },
    { nombre: "Salud 3", chatId: "-1003652700311" },
    { nombre: "Salud 4", chatId: "-1003662273802" },
    { nombre: "Salud 5", chatId: "-1003590364816" }
  ];

  const medallas = ["🥇", "🥈"];

  sucursalesConfig.forEach(sucConfig => {
    // Encuentra el bloque de la sucursal en la hoja del mes
    const bloque = data.findIndex((row) =>
      row[0] && [1, 2, 3, 4, 5].every(col => !row[col]) &&
      String(row[0]).trim().toLowerCase() === sucConfig.nombre.toLowerCase()
    );
    if (bloque === -1) return;

    let filaTotal = -1, filaProy = -1;
    for (let i = bloque + 1; i < data.length; i++) {
      const celda = String(data[i][0] || "").trim().toLowerCase();
      if (celda === "total") filaTotal = i;
      if (celda === "proyección" || celda === "proyeccion") { filaProy = i; break; }
      if (data[i][0] && [1, 2, 3, 4, 5].every(col => !data[i][col])) break;
    }

    let pct = normalizePct(filaTotal >= 0 ? data[filaTotal][4] : "-");
    let proj = normalizePct(filaProy >= 0 ? data[filaProy][4] : "-");
    const iconAct = pct >= 1 ? "🟢" : pct >= 0.95 ? "🟠" : "🔴";
    const iconProj = proj >= 1 ? "🟢" : proj >= 0.95 ? "🟠" : "🔴";
    const isFinal = diaResumen === new Date(anioResumen, mesResumen + 1, 0).getDate();

    const metaMes = getMetaSucursalMes(sucConfig.nombre, mesResumen, dataAsign);
    const metaTxt = (metaMes != null) ? `$${moneyStr(metaMes)}` : "—";

    let msg = isFinal
      ? `📊 *Reporte final de ${mesNombreBonito}*\n\n`
      : `📊 *Resumen a la fecha* — ${diaResumen} de ${mesNombreBonito}\n\n`;

    msg += `*Meta:* ${metaTxt}\n\n`;

    msg += `*${sucConfig.nombre}*   ${iconAct} ${formatPct(pct)} ➡️ ${iconProj}${formatPct(proj)}\n\n*Top vendedores:*\n`;

    // Top vendedores (excluye 'codigo incorrecto' y a jefes con cargo J)
    let empleados = [];
    let filaIni = bloque + 3;
    for (let i = filaIni; i < data.length; i++) {
      const row = data[i];
      const celda0 = String(row[0] || "").toLowerCase().trim();
      if (["total", "proyección", "proyeccion"].includes(celda0) ||
        (i > filaIni && row[0] && [1, 2, 3, 4, 5].every(col => !row[col]))) break;

      const nombre = String(row[1] || "").trim();
      const cargo = row[2];

      if (!row[0] || !nombre || nombre.toLowerCase() === "codigo incorrecto") continue;
      if (esJefe(cargo)) continue;                 // ← filtro jefe (J)

      const pct = normalizePct(row[4]);
      if (pct > 0) empleados.push({ name: nombre, pct });
    }

    empleados.sort((a, b) => b.pct - a.pct);
    const promedio = empleados.length > 0 ? empleados.reduce((a, b) => a + b.pct, 0) / empleados.length : 0;
    empleados.forEach((v, i) => {
      if (i < 2) msg += `${medallas[i]} ${i + 1}. ${v.name}\n`;
      else msg += `${(v.pct >= promedio ? "🔸" : "🔺")} ${i + 1}. ${v.name}\n`;
    });

    // Bono por laboratorio (sin cambiar tu lógica de cálculo)
    const filaBonos = dataBonos.find(f => String(f[3] || "").toLowerCase() === sucConfig.nombre.toLowerCase());
    if (filaBonos) {
      const metas = [4, 5, 6, 7].map(c => moneyNum(filaBonos[c])); // E:H
      const umbrales = [10, 20, 30, 40];

      let colLab = data[bloque].findIndex(c => String(c || "").toLowerCase().trim() === "laboratorios bonificados");
      let totalBonificado = 0;
      for (let i = bloque + 1; i < data.length; i++) {
        const celda = (data[i][colLab] || "").toString().trim().toLowerCase();
        if (celda === "total") {
          totalBonificado = moneyNum(data[i][colLab + 1]);
          break;
        }
        if (data[i][0] && [1, 2, 3, 4, 5].every(col => !data[i][col])) break;
      }

      let nivel = metas.reduce((acc, meta, idx) => totalBonificado >= meta ? idx + 1 : acc, 0);
      const siguienteMeta = nivel < metas.length ? metas[nivel] : metas[metas.length - 1];
      const siguienteBono = nivel < umbrales.length ? umbrales[nivel] : umbrales[umbrales.length - 1];
      const bonoGanado = nivel > 0 ? umbrales[nivel - 1] : 0;
      const avance = siguienteMeta > 0 ? totalBonificado / siguienteMeta : 0;
      const icono = bonoGanado > 0 ? "🟢" : "🔴";

      // NEW: bloque con las 3 partes
      msg += `\n💊 *Bono por Laboratorio:*\n\n`;
      if (isFinal) {
        msg += `*Obtenido — alcanzado — bono a obtener*\n ${icono} $${moneyStr(bonoGanado)} | ${(avance * 100).toFixed(2)}% para el siguiente bono de $${moneyStr(siguienteBono)}`;
      } else {
        msg += `*Obtenido — alcanzado — bono a obtener*\n ${icono} $${moneyStr(bonoGanado)} | ${(avance * 100).toFixed(2)}% ➡️ $${moneyStr(siguienteBono)}`;
      }
    }

    // Envío a Telegram
    UrlFetchApp.fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN_Sucursal}/sendMessage`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({
        chat_id: sucConfig.chatId,
        text: msg,
        parse_mode: "Markdown"
      })
    });
  });

  PropertiesService.getScriptProperties().setProperty("lastResumenDate", Utilities.formatDate(new Date(), tz, "yyyy-MM-dd"));
  borrarTrigger("enviarResumenPorSucursal");
}

function normalizePct(v) {
  if (typeof v === "string") {
    v = v.trim().toLowerCase();
    if (v.includes("finalizado")) return 1;
    if (v === "-" || v === "") return 0;

    if (v.includes("%")) {
      v = parseFloat(v.replace("%", "").replace(",", "."));
      return isNaN(v) ? 0 : v / 100;
    }

    // 👉 Si es un número sin % ni palabra, no dividir
    v = parseFloat(v.replace(",", "."));
    return isNaN(v) ? 0 : v;
  }

  if (typeof v === "number") {
    return v;
  }

  return 0;
}



//Laboratorios
function procesarVentasPorLaboratorio(mes, idSucursal, nombreSucursal) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaLaboratorios = ss.getSheetByName("Laboratorios bonificados");
  const hojaMes = ss.getSheetByName(mes);
  if (!hojaLaboratorios || !hojaMes) return;
  const laboratoriosBonificados = hojaLaboratorios.getRange("B2:B").getValues().flat().filter(l => l);
  const fechaInicio = Utilities.formatDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "GMT-6", "yyyy-MM-dd");
  const fechaFin = Utilities.formatDate(new Date(), "GMT-6", "yyyy-MM-dd");
  const url = `https://clientesdte3.oss.com.sv/farma_salud/reporte_ventas_laboratorio_pdf.php?fini=${fechaInicio}&ffin=${fechaFin}&id_sucursal=${idSucursal}`;
  const sessionCookie = iniciarSesion({ username: "documentop.supervisor", password: "documento9999" });
  const pdfBlob = descargarPDF(sessionCookie, url, `ventas_laboratorio_${nombreSucursal}.pdf`);
  if (!pdfBlob) return;
  const ventasLaboratorio = extraerVentasPorLaboratorioDesdePDF(pdfBlob, laboratoriosBonificados);
  insertarVentasLaboratorioEnHojaMensual(mes, nombreSucursal, ventasLaboratorio);
}

function extraerVentasLaboratorios(pdfBlob, laboratoriosBuscados) {
  var tempFile = DriveApp.createFile(pdfBlob);
  var resource = { title: "TMP-LAB", mimeType: MimeType.GOOGLE_DOCS };
  var docFile = Drive.Files.copy(resource, tempFile.getId(), { convert: true });
  var texto = DocumentApp.openById(docFile.id).getBody().getText();
  DriveApp.getFileById(docFile.id).setTrashed(true);
  tempFile.setTrashed(true);
  var ventasLab = {};
  laboratoriosBuscados.forEach(lab => ventasLab[lab] = 0);
  texto.split(/\r?\n/).forEach(function (line) {
    line = line.trim();
    laboratoriosBuscados.forEach(function (lab) {
      var regex = new RegExp(`${lab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\$\\s*([\\d,\\.]+)`, "i");
      var match = line.match(regex);
      if (match) ventasLab[lab] = parseFloat(match[1].replace(/,/g, ""));
    });
  });
  return ventasLab;
}

function colocarVentasLaboratorios(mes, sucursal, ventasLab, tablaBonos) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(mes);
  if (!hoja) {
    Logger.log(`Hoja ${mes} no encontrada.`);
    return;
  }
  const labs = Object.keys(ventasLab);
  let filaSucursal = -1;
  const filas = hoja.getRange("A:A").getValues();
  for (let i = 0; i < filas.length; i++) {
    if (filas[i][0] && filas[i][0].toString().toLowerCase().trim() === sucursal.toLowerCase()) {
      filaSucursal = i + 1;
      break;
    }
  }
  if (filaSucursal === -1) {
    Logger.log(`Sucursal ${sucursal} no encontrada.`);
    return;
  }
  let colLabs = 8;
  hoja.getRange(filaSucursal, colLabs, 1, 2).merge()
    .setValue("Laboratorios Bonificados")
    .setFontWeight('bold').setHorizontalAlignment('center');
  let fila = filaSucursal + 1;
  let totalVentasLab = 0;
  labs.forEach(lab => {
    hoja.getRange(fila, colLabs).setValue(lab).setHorizontalAlignment('left');
    hoja.getRange(fila, colLabs + 1).setValue(ventasLab[lab]).setNumberFormat("$#,##0.00");
    totalVentasLab += ventasLab[lab];
    fila++;
  });
  hoja.getRange(fila, colLabs).setValue("Total").setFontWeight('bold');
  hoja.getRange(fila, colLabs + 1).setValue(totalVentasLab).setFontWeight('bold').setNumberFormat("$#,##0.00");
  const hojaBonificados = ss.getSheetByName("Laboratorios bonificados");
  const tablaBonosRaw = hojaBonificados.getRange("D2:H7").getValues(); // incluye H
  let filaBonos = tablaBonosRaw.find(row => String(row[0]).toLowerCase().trim() === sucursal.toLowerCase());

  let bonoAlcanzado = 0;
  if (filaBonos) {
    const metas = filaBonos.slice(1).map(v => parseFloat(String(v || "0").replace(/[$,]/g, '')) || 0); // E:H
    const umbrales = [10, 20, 30, 40]; // ajusta esto si tu cuarto nivel paga otro monto

    for (let i = metas.length - 1; i >= 0; i--) {
      if (totalVentasLab >= metas[i]) {
        bonoAlcanzado = umbrales[i] || 0;
        break;
      }
    }
  } else {
    Logger.log(`No se encontró fila de bonos para la sucursal: ${sucursal}`);
  }
  hoja.getRange(fila + 1, colLabs).setValue("Bono alcanzado").setFontWeight('bold');
  hoja.getRange(fila + 1, colLabs + 1).setValue(bonoAlcanzado).setFontWeight('bold').setNumberFormat("$#,##0.00");
}

function calcularMetasMensuales() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaBonos = ss.getSheetByName("Ventas Anual");
  const hojaMetas = ss.getSheetByName("Asignacion de Metas");
  const hoy = new Date();
  const mesActual = hoy.getMonth();
  const anio = hoy.getFullYear();
  const diasMes = diasDelMes(mesActual, anio);
  const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const nombreMesActual = MESES[mesActual];
  const dataBonos = hojaBonos.getDataRange().getValues();
  const dataMetas = hojaMetas.getDataRange().getValues();
  const columnaMeta = mesActual + 1;
  Logger.log(`📅 Mes actual considerado: ${nombreMesActual} (${mesActual})`);
  Logger.log(`📌 Días del mes actual: ${diasMes}`);
  Logger.log(`➡️ Columna destino de meta en hoja Metas: ${columnaMeta}`);
  for (let i = 1; i < dataBonos.length; i++) {
    const nombreSucursal = dataBonos[i][0];
    if (!nombreSucursal) continue;
    const ventas = dataBonos[i];
    const mes1 = (mesActual + 9) % 12;
    const mes2 = (mesActual + 10) % 12;
    const mes3 = (mesActual + 11) % 12;
    const colMes1 = mes1 + 1;
    const colMes2 = mes2 + 1;
    const colMes3 = mes3 + 1;
    const ventas3Meses = [ventas[colMes1], ventas[colMes2], ventas[colMes3]].map(safeToFloat);
    if (ventas3Meses.some(v => v === 0)) {
      Logger.log(`⚠️ No se puede calcular meta para ${nombreSucursal} porque uno o más meses tienen venta en $0`);
      continue;
    }
    const totalVentas = ventas3Meses.reduce((a, b) => a + b, 0);
    const diasTotales = diasDelMes(mes1, anio) + diasDelMes(mes2, anio) + diasDelMes(mes3, anio);
    const ventaPorDia = totalVentas / diasTotales;
    Logger.log(`📊 ${nombreSucursal}: Últimos 3 meses [${MESES[mes1]}, ${MESES[mes2]}, ${MESES[mes3]}]`);
    Logger.log(`   - Ventas: ${ventas3Meses.map(v => `$${v.toFixed(2)}`).join(", ")}`);
    Logger.log(`   - Total: $${totalVentas.toFixed(2)} en ${diasTotales} días`);
    Logger.log(`   - Promedio diario: $${ventaPorDia.toFixed(2)}`);
    const ventaMesPasado = safeToFloat(ventas[colMes3]);
    let porcentajeVenta = 0;
    const hojaMesPasado = ss.getSheetByName(MESES[mes3]);
    if (hojaMesPasado) {
      const valoresMes = hojaMesPasado.getDataRange().getValues();
      let filaSucursal = -1;
      for (let j = 0; j < valoresMes.length; j++) {
        if (String(valoresMes[j][0]).trim().toLowerCase() === nombreSucursal.toLowerCase()) {
          filaSucursal = j;
          break;
        }
      }
      if (filaSucursal !== -1) {
        for (let k = filaSucursal + 1; k < valoresMes.length; k++) {
          if (String(valoresMes[k][0]).trim().toLowerCase() === "total") {
            porcentajeVenta = safeToFloat(valoresMes[k][4]); // Columna E
            break;
          }
        }
      }
    }
    const porcentajeMostrar = porcentajeVenta * 100;
    Logger.log(`   - % de venta mes pasado: ${porcentajeMostrar.toFixed(2)}%`);
    Logger.log(`   - Venta mes pasado (${MESES[mes3]}): $${ventaMesPasado}`);
    let factor = 0;
    if (porcentajeMostrar > 0) {
      if (porcentajeMostrar >= 95) {
        factor = 1.02;
      } else if (porcentajeMostrar >= 90) {
        factor = 1.05;
      } else {
        factor = 1.10;
      }
    } else {
      Logger.log(`   - No se puede calcular factor por falta de datos`);
      continue;
    }
    const meta = ventaPorDia * diasMes * factor;
    if (meta > 0) {
      const filaMeta = buscarFilaSucursal(dataMetas, nombreSucursal);
      Logger.log(`   - REVISIÓN: Meta calculada con promedio diario=${ventaPorDia}, diasMes=${diasMes}, factor=${factor}, meta=${meta}`);
      if (filaMeta !== -1) {
        hojaMetas.getRange(filaMeta + 2, columnaMeta).setValue(meta);
        Logger.log(`✅ Meta estimada para ${nombreSucursal} en ${nombreMesActual}: $${meta.toFixed(2)} (fila ${filaMeta + 1}, col ${columnaMeta})`);
      } else {
        Logger.log(`❌ No se encontró fila en hoja de metas para ${nombreSucursal}`);
      }
    } else {
      Logger.log(`⚠️ Meta resultó en cero o no válida para ${nombreSucursal}`);
    }
  }
}

// Funciones auxiliares
function diasDelMes(mes, anio) {
  return new Date(anio, mes + 1, 0).getDate(); // mes es 0-indexado
}

function safeToFloat(v) {
  return parseFloat(String(v).replace(/[^\d.-]/g, '')) || 0;
}

function obtenerMeta(data, sucursal, col) {
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === sucursal.toLowerCase()) {
      return safeToFloat(data[i + 1]?.[col]);
    }
  }
  return 0;
}

function buscarFilaSucursal(data, nombreSucursal) {
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === nombreSucursal.toLowerCase()) {
      return i + 1; // porque la fila real de metas está justo abajo
    }
  }
  return -1;
}

function actualizarVentaAnual() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaVentas = ss.getSheetByName("Ventas Anual") || ss.insertSheet("Ventas Anual");
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const sucursales = ["Domicilio", "La popular", "Salud 1", "Salud 2", "Salud 3", "Salud 4", "Salud 5"];

  // Encabezados y formato
  hojaVentas.clearContents();
  hojaVentas.getRange(1, 1).setValue("Sucursal");
  hojaVentas.getRange(2, 1, sucursales.length, 1).setValues(sucursales.map(s => [s]));
  hojaVentas.getRange(1, 2, 1, meses.length).setValues([meses.map(m => m.charAt(0).toUpperCase() + m.slice(1))]);
  hojaVentas.setColumnWidths(1, 13, 100);
  hojaVentas.getRange("A1:M1").setFontWeight("bold").setBackground("#efefef");
  hojaVentas.getRange(1, 1, sucursales.length + 1, meses.length + 1).setHorizontalAlignment("center");

  for (let m = 0; m < meses.length; m++) {
    const nombreMes = meses[m];
    const hojaMes = ss.getSheetByName(nombreMes);
    if (!hojaMes) {
      Logger.log(`❌ Hoja de mes "${nombreMes}" no encontrada`);
      continue;
    }

    for (let s = 0; s < sucursales.length; s++) {
      const sucursal = sucursales[s];
      const valores = hojaMes.getDataRange().getValues();
      let filaSucursal = valores.findIndex(row => (row[0] + "").trim().toLowerCase() === sucursal.toLowerCase());

      if (filaSucursal === -1) {
        Logger.log(`⚠️ No se encontró bloque de ${sucursal} en hoja ${nombreMes}`);
        continue;
      }

      const filaTotal = valores.findIndex((row, idx) => idx > filaSucursal && (row[0] + "").trim().toLowerCase() === "total");
      if (filaTotal === -1) {
        Logger.log(`⚠️ No se encontró fila TOTAL para ${sucursal} en ${nombreMes}`);
        continue;
      }

      const colVenta = sucursal.toLowerCase() === "domicilio" ? 2 : 3; // C=2, D=3
      const colPorcentaje = 4; // E=4

      let venta = parseFloat((valores[filaTotal][colVenta] + "").replace(/[^0-9.,]/g, "").replace(",", ""));
      if (isNaN(venta)) venta = 0;

      let porcentajeRaw = valores[filaTotal][colPorcentaje];
      let porcentaje;

      if (typeof porcentajeRaw === 'number') {
        porcentaje = porcentajeRaw * 100;
      } else {
        porcentaje = parseFloat((porcentajeRaw + "").replace("%", "").replace(",", "."));
        if (porcentaje > 0 && porcentaje <= 1.5) porcentaje *= 100; // evita confundir 1.06 como 1.06%
      }

      if (isNaN(porcentaje)) porcentaje = 0;

      const celda = hojaVentas.getRange(s + 2, m + 2);
      celda.setValue(venta.toFixed(2));

      if (porcentaje < 95) {
        celda.setBackground("#f8d7da"); // rojo
      } else if (porcentaje < 100) {
        celda.setBackground("#fff3cd"); // naranja
      } else {
        celda.setBackground("#d4edda"); // verde
      }

      Logger.log(`✅ ${sucursal} en ${nombreMes} = $${venta.toFixed(2)} (${porcentaje.toFixed(2)}%)`);
    }
  }
}

function bonomensual() {
  calcularMetasMensuales();
  actualizarVentaAnual();
}

function llenarBonosAnualPrimerSemestre() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hojaBonos = ss.getSheetByName("Bonos Anual");
  if (!hojaBonos) return;

  const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio"];

  for (let mesIdx = 0; mesIdx < 6; mesIdx++) {
    const mesNombre = meses[mesIdx];
    const colMes = 4 + mesIdx; // D a I
    const datosBonos = hojaBonos.getDataRange().getValues();

    // --- Buscar filas de Administración y Domicilio ---
    let adminIni = -1, adminFin = -1, domiIni = -1, domiFin = -1, filaDomicilio = null;
    for (let i = 0; i < datosBonos.length; i++) {
      const bloque = (datosBonos[i][0] || '').toString().trim().toLowerCase();
      if (bloque === "administración") {
        adminIni = i + 1;
        for (let j = adminIni; j < datosBonos.length; j++) {
          if ((datosBonos[j][0] || '').toString().trim() && datosBonos[j].slice(1).every(x => !x)) { adminFin = j - 1; break; }
          if (j === datosBonos.length - 1) adminFin = j;
        }
      }
      if (bloque === "domicilio") {
        domiIni = i + 1;
        for (let j = domiIni; j < datosBonos.length; j++) {
          if ((datosBonos[j][0] || '').toString().trim() && datosBonos[j].slice(1).every(x => !x)) { domiFin = j - 1; break; }
          if (j === datosBonos.length - 1) domiFin = j;
        }
      }
    }
    if (domiIni !== -1 && domiFin !== -1) {
      for (let i = domiIni; i <= domiFin; i++) {
        if ((datosBonos[i][1] || '').toString().trim().toLowerCase() === "domicilio") {
          filaDomicilio = i + 1;
          break;
        }
      }
    }

    // --- Leer hoja mensual del mes actual ---
    let hojaMes = ss.getSheetByName(mesNombre.toLowerCase());
    if (!hojaMes) continue;
    let dataMes = hojaMes.getDataRange().getValues();

    // ======== BONO ADMINISTRACIÓN: $10 por cada sucursal con meta >=100% ========
    if (adminIni !== -1 && adminFin !== -1) {
      let sucursalesCumplen = [];
      let sucursalActual = "";
      for (let i = 0; i < dataMes.length; i++) {
        let fila = dataMes[i];
        // Detectar bloque de sucursal
        if (fila[0] && [fila[1], fila[2], fila[3], fila[4]].every(x => !x)) {
          sucursalActual = String(fila[0]).trim();
          continue;
        }
        // Si es "Total", lee el porcentaje de meta
        if (sucursalActual && String(fila[0]).trim().toLowerCase() === "total") {
          let metaStr = (fila[4] || '').toString().replace(',', '.').replace('%', '');
          let meta = parseFloat(metaStr);
          Logger.log(`→ ${mesNombre} - ${sucursalActual} - Meta: ${meta}%`);
          if (!isNaN(meta) && meta >= 1) {
            sucursalesCumplen.push(sucursalActual);
            Logger.log(`✅ ${mesNombre}: ${sucursalActual} CUMPLE meta (${meta}%)`);
          } else {
            Logger.log(`❌ ${mesNombre}: ${sucursalActual} NO cumple meta (${meta}%)`);
          }
        }
      }
      let bonoAdmin = sucursalesCumplen.length * 10;
      Logger.log(`==> En ${mesNombre}, sucursales que cumplen: [${sucursalesCumplen.join(', ')}], total a asignar a administración: $${bonoAdmin}`);
      for (let f = adminIni; f <= adminFin; f++) {
        let cargo = (datosBonos[f][2] || '').toString().toLowerCase();
        if (cargo.includes('adm') || cargo.includes('supervisor') || cargo.includes('talento humano')) {
          let cell = hojaBonos.getRange(f + 1, colMes);
          if (bonoAdmin > 0) {
            cell.setValue(bonoAdmin)
              .setNumberFormat("$#,##0.00")
              .setVerticalAlignment("middle")
              .setHorizontalAlignment("center");
            cell.setComment(`Bono administración: $${bonoAdmin.toFixed(2)} por metas cumplidas en: ${sucursalesCumplen.join(', ')}`);
            Logger.log(`Asignado a ${datosBonos[f][1]} (${cargo}): $${bonoAdmin}`);
          } else {
            cell.setValue("").setComment("");
            Logger.log(`No se asigna bono a ${datosBonos[f][1]} (${cargo})`);
          }
        }
      }
    }
    // --- DOMICILIO: Toma el bono del total del bloque domicilio ---
    if (filaDomicilio) {
      let inDomicilio = false, bonoDomicilioTotal = 0;
      for (let i = 0; i < dataMes.length; i++) {
        let fila = dataMes[i];
        if ((fila[0] || '').toString().trim().toLowerCase() === 'domicilio' && [fila[1], fila[2], fila[3], fila[4]].every(x => !x)) {
          inDomicilio = true; continue;
        }
        if (inDomicilio && (fila[0] || '').toString().trim() && [fila[1], fila[2], fila[3], fila[4]].every(x => !x) && (fila[0] || '').toString().trim().toLowerCase() !== "total") break;
        if (inDomicilio && (fila[0] || '').toString().trim().toLowerCase() === "total") {
          bonoDomicilioTotal = Number(fila[5]) || 0;
          break;
        }
      }
      let cell = hojaBonos.getRange(filaDomicilio, colMes);
      if (bonoDomicilioTotal > 0) {
        cell.setValue(bonoDomicilioTotal)
          .setNumberFormat("$#,##0.00")
          .setVerticalAlignment("middle")
          .setHorizontalAlignment("center");
        cell.setComment("");
      } else {
        cell.setValue("").setComment("");
      }
    }
    Logger.log(`✅ Bonos anuales actualizados para ${mesNombre}`);
  }
}