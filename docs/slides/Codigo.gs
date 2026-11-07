// Portal Elevation: arma en Google Slides el análisis que genera el portal.
// Corre con la cuenta de Elevation. El archivo queda en una carpeta temporal y se borra a los 7 días;
// cada persona se lleva su copia con el link "Hacer una copia".

var SUPABASE_URL = "https://xiijrsgaxsjizfcuvklo.supabase.co";
var SUPABASE_KEY = "sb_publishable_6misivLkI8felkprfbr7Sg_7lO5BhjL"; // Pública por diseño, la misma de la página.
var CARPETA = "Análisis del portal (temporales)";
var DIAS_GUARDADO = 7;
var FUENTE = "Figtree";
var INSET_X = 7.2, INSET_Y = 3.6; // Margen interno que Slides pone a toda caja de texto.

function doPost(e) {
  try {
    var pedido = JSON.parse(e.postData.contents);
    if (!claveValida(pedido.key)) return responder({ error: "clave_invalida" });
    return responder({ url: armar(pedido) });
  } catch (err) {
    console.error(err);
    return responder({ error: String(err && err.message || err).slice(0, 300) });
  }
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Una consulta liviana del portal: si la clave no es del equipo, la base la rechaza.
function claveValida(key) {
  if (!key) return false;
  var r = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/rpc/portal_historico", {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    headers: { apikey: SUPABASE_KEY },
    payload: JSON.stringify({ p_key: key, p_client: "_", p_since: "2026-01-01", p_until: "2026-01-01" }),
  });
  return r.getResponseCode() === 200;
}

function carpeta() {
  var it = DriveApp.getFoldersByName(CARPETA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA);
}

function limpiar(c) {
  var tope = Date.now() - DIAS_GUARDADO * 864e5, it = c.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (f.getDateCreated().getTime() < tope) f.setTrashed(true);
  }
}

function armar(pedido) {
  var creada = Slides.Presentations.create({
    title: String(pedido.titulo || "Análisis de resultados").slice(0, 200),
  });
  var id = creada.presentationId;
  var pres = SlidesApp.openById(id);
  var inicial = pres.getSlides();
  var pedidos = [];
  pedido.hojas.forEach(function (hoja, n) {
    var slide = pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    // Primero las imágenes, así formas y textos quedan por encima (por ejemplo, el número de cada pieza).
    hoja.items.filter(function (x) { return x.t === "img"; }).forEach(function (x) { insertarImagen(slide, x); });
    hoja.items.forEach(function (x, i) {
      var oid = "portal_h" + n + "e" + i; // Slides pide al menos 5 caracteres.
      if (x.t === "forma") forma(pedidos, slide.getObjectId(), oid, x);
      if (x.t === "linea") forma(pedidos, slide.getObjectId(), oid, { x: x.x, y: x.y, w: x.w, h: Math.max(x.h, 0.75), fill: x.color, tipo: "RECTANGLE" });
      if (x.t === "texto") texto(pedidos, slide.getObjectId(), oid, x);
      if (x.t === "tabla") tabla(pedidos, slide.getObjectId(), oid, x);
    });
  });
  inicial.forEach(function (s) { s.remove(); });
  pres.saveAndClose();
  for (var i = 0; i < pedidos.length; i += 400) {
    Slides.Presentations.batchUpdate({ requests: pedidos.slice(i, i + 400) }, id);
  }
  var c = carpeta(), archivo = DriveApp.getFileById(id);
  archivo.moveTo(c);
  // Solo cuentas de Elevation: tiene datos del cliente. La copia se comparte aparte.
  archivo.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  limpiar(c);
  return "https://docs.google.com/presentation/d/" + id + "/copy";
}

function insertarImagen(slide, x) {
  try {
    var blob;
    if (String(x.src).indexOf("data:") === 0) {
      var partes = x.src.split(",");
      blob = Utilities.newBlob(Utilities.base64Decode(partes[1]), partes[0].slice(5).split(";")[0], "imagen");
    } else {
      blob = UrlFetchApp.fetch(x.src).getBlob();
    }
    slide.insertImage(blob, x.x, x.y, x.w, x.h);
  } catch (err) {
    console.error("imagen", err); // Sin la imagen, la hoja sale igual.
  }
}

function color(hex) {
  var n = parseInt(String(hex).slice(1), 16);
  return { red: (n >> 16 & 255) / 255, green: (n >> 8 & 255) / 255, blue: (n & 255) / 255 };
}

function propiedades(pagina, x, y, w, h) {
  return {
    pageObjectId: pagina,
    size: { width: { magnitude: Math.max(w, 1), unit: "PT" }, height: { magnitude: Math.max(h, 0.75), unit: "PT" } },
    transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: "PT" },
  };
}

function forma(p, pagina, oid, x) {
  p.push({ createShape: { objectId: oid, shapeType: x.tipo || "RECTANGLE", elementProperties: propiedades(pagina, x.x, x.y, x.w, x.h) } });
  var props = { outline: x.line ? { outlineFill: { solidFill: { color: { rgbColor: color(x.line) } } }, weight: { magnitude: 0.75, unit: "PT" } } : { propertyState: "NOT_RENDERED" } };
  props.shapeBackgroundFill = x.fill ? { solidFill: { color: { rgbColor: color(x.fill) } } } : { propertyState: "NOT_RENDERED" };
  p.push({ updateShapeProperties: { objectId: oid, shapeProperties: props, fields: "outline,shapeBackgroundFill" } });
}

function estiloTexto(x) {
  return {
    style: { fontFamily: FUENTE, fontSize: { magnitude: x.size, unit: "PT" }, bold: !!x.bold, foregroundColor: { opaqueColor: { rgbColor: color(x.color) } } },
    fields: "fontFamily,fontSize,bold,foregroundColor",
  };
}
var ALINEA = { left: "START", start: "START", center: "CENTER", right: "END", end: "END" };

function texto(p, pagina, oid, x) {
  // La caja es un poco más ancha: la fuente puede medir distinto y no queremos saltos de línea de más.
  var extra = x.w * 0.12 + 6, izq = x.x - INSET_X, ancho = x.w + INSET_X * 2 + extra;
  if (x.align === "right" || x.align === "end") izq -= extra;
  if (x.align === "center") izq -= extra / 2;
  p.push({ createShape: { objectId: oid, shapeType: "TEXT_BOX", elementProperties: propiedades(pagina, izq, x.y - INSET_Y, ancho, x.h + INSET_Y * 2) } });
  p.push({ insertText: { objectId: oid, text: x.txt } });
  var e = estiloTexto(x);
  p.push({ updateTextStyle: { objectId: oid, textRange: { type: "ALL" }, style: e.style, fields: e.fields } });
  p.push({ updateParagraphStyle: { objectId: oid, textRange: { type: "ALL" }, style: { alignment: ALINEA[x.align] || "START", spaceAbove: { magnitude: 0, unit: "PT" }, spaceBelow: { magnitude: 0, unit: "PT" } }, fields: "alignment,spaceAbove,spaceBelow" } });
}

function tabla(p, pagina, oid, x) {
  var filas = x.filas.length, cols = x.anchos.length;
  p.push({ createTable: { objectId: oid, rows: filas, columns: cols, elementProperties: propiedades(pagina, x.x, x.y, x.w, x.h) } });
  x.anchos.forEach(function (a, c) {
    p.push({ updateTableColumnProperties: { objectId: oid, columnIndices: [c], tableColumnProperties: { columnWidth: { magnitude: Math.max(a, 8), unit: "PT" } }, fields: "columnWidth" } });
  });
  x.filas.forEach(function (fila, f) {
    p.push({ updateTableRowProperties: { objectId: oid, rowIndices: [f], tableRowProperties: { minRowHeight: { magnitude: fila.alto, unit: "PT" } }, fields: "minRowHeight" } });
    fila.celdas.forEach(function (cel, c) {
      var ubic = { rowIndex: f, columnIndex: c };
      p.push({ updateTableCellProperties: {
        objectId: oid, tableRange: { location: ubic, rowSpan: 1, columnSpan: 1 },
        tableCellProperties: { tableCellBackgroundFill: fila.fondo ? { solidFill: { color: { rgbColor: color(fila.fondo) } } } : { propertyState: "NOT_RENDERED" }, contentAlignment: "MIDDLE" },
        fields: "tableCellBackgroundFill,contentAlignment",
      } });
      if (!cel.txt) return;
      p.push({ insertText: { objectId: oid, cellLocation: ubic, text: cel.txt } });
      var e = estiloTexto(cel);
      p.push({ updateTextStyle: { objectId: oid, cellLocation: ubic, textRange: { type: "ALL" }, style: e.style, fields: e.fields } });
      p.push({ updateParagraphStyle: { objectId: oid, cellLocation: ubic, textRange: { type: "ALL" }, style: { alignment: ALINEA[cel.align] || "START" }, fields: "alignment" } });
    });
  });
  // Solo líneas horizontales suaves, como en el PDF.
  p.push({ updateTableBorderProperties: { objectId: oid, tableRange: { location: { rowIndex: 0, columnIndex: 0 }, rowSpan: filas, columnSpan: cols }, borderPosition: "INNER_VERTICAL", tableBorderProperties: { dashStyle: "SOLID", weight: { magnitude: 0.01, unit: "PT" }, tableBorderFill: { solidFill: { color: { rgbColor: color("#FFFFFF") } } } }, fields: "dashStyle,weight,tableBorderFill" } });
  ["INNER_HORIZONTAL", "BOTTOM"].forEach(function (pos) {
    p.push({ updateTableBorderProperties: { objectId: oid, tableRange: { location: { rowIndex: 0, columnIndex: 0 }, rowSpan: filas, columnSpan: cols }, borderPosition: pos, tableBorderProperties: { dashStyle: "SOLID", weight: { magnitude: 0.75, unit: "PT" }, tableBorderFill: { solidFill: { color: { rgbColor: color("#E8E5EF") } } } }, fields: "dashStyle,weight,tableBorderFill" } });
  });
  ["TOP", "LEFT", "RIGHT"].forEach(function (pos) {
    p.push({ updateTableBorderProperties: { objectId: oid, tableRange: { location: { rowIndex: 0, columnIndex: 0 }, rowSpan: filas, columnSpan: cols }, borderPosition: pos, tableBorderProperties: { dashStyle: "SOLID", weight: { magnitude: 0.01, unit: "PT" }, tableBorderFill: { solidFill: { color: { rgbColor: color("#FFFFFF") } } } }, fields: "dashStyle,weight,tableBorderFill" } });
  });
}

// Para autorizar la primera vez: ejecutá esta función desde el editor.
function autorizar() {
  carpeta();
  console.log("Listo, permisos dados.");
}
