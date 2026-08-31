// Lee un PDF o foto de una factura de compra y devuelve los campos estructurados para precargar
// el formulario de "Nueva compra" (el usuario siempre revisa/confirma antes de guardar nada).
// Requiere el mismo secret que el chat: ANTHROPIC_API_KEY.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const Anthropic = require("@anthropic-ai/sdk");

const anthropicApiKey = defineSecret("ANTHROPIC_API_KEY");

// Firestore/Functions callable admite hasta ~10MB de payload; en base64 eso son ~7.5MB de archivo real.
const TAMANO_MAXIMO_BASE64 = 9_000_000;

const ESQUEMA_FACTURA = {
  name: "extraer_factura",
  description: "Devuelve los datos estructurados extraídos de la factura de compra.",
  input_schema: {
    type: "object",
    properties: {
      proveedorRazonSocial: { type: "string" },
      proveedorCuit: { type: "string", description: "Formato XX-XXXXXXXX-X si está visible, si no string vacío." },
      tipoComprobante: { type: "string", description: "Ej. 'Factura A', 'Factura B', 'Factura C', 'Remito', 'Nota de crédito'." },
      numeroFactura: { type: "string" },
      fecha: { type: "string", description: "Fecha de la factura en formato YYYY-MM-DD." },
      fechaVencimiento: { type: "string", description: "YYYY-MM-DD, o string vacío si no figura." },
      descuentoGlobal: { type: "number", description: "Descuento total del comprobante en pesos, 0 si no hay." },
      percepciones: { type: "number", description: "Total de percepciones/impuestos adicionales en pesos, 0 si no hay." },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            descripcion: { type: "string" },
            cantidad: { type: "number" },
            costoUnitario: { type: "number", description: "Precio unitario sin IVA." },
            descuentoPct: { type: "number", description: "Descuento de línea en %, 0 si no hay." },
            ivaPct: { type: "number", description: "Alícuota de IVA de la línea, ej. 21." },
          },
          required: ["descripcion", "cantidad", "costoUnitario"],
        },
      },
    },
    required: ["proveedorRazonSocial", "numeroFactura", "fecha", "items"],
  },
};

exports.extraerFactura = onCall({ region: "southamerica-east1", secrets: [anthropicApiKey], timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Hay que estar logueado.");
  }

  const perfilSnap = await admin.firestore().collection("usuarios").doc(request.auth.uid).get();
  const rol = perfilSnap.exists ? perfilSnap.data().rol : null;
  if (!["administrador", "administrativo"].includes(rol)) {
    throw new HttpsError("permission-denied", "No tenés permiso para cargar compras.");
  }

  const fileBase64 = (request.data?.fileBase64 || "").toString();
  const mimeType = (request.data?.mimeType || "").toString();
  if (!fileBase64 || !mimeType) {
    throw new HttpsError("invalid-argument", "Falta el archivo.");
  }
  if (fileBase64.length > TAMANO_MAXIMO_BASE64) {
    throw new HttpsError("invalid-argument", "El archivo es demasiado grande.");
  }

  const esPdf = mimeType === "application/pdf";
  if (!esPdf && !mimeType.startsWith("image/")) {
    throw new HttpsError("invalid-argument", "Solo se acepta PDF o imagen (JPG/PNG).");
  }

  const anthropic = new Anthropic({ apiKey: anthropicApiKey.value().trim() });

  const bloqueArchivo = esPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileBase64 } }
    : { type: "image", source: { type: "base64", media_type: mimeType, data: fileBase64 } };

  let respuesta;
  try {
    respuesta = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system:
        "Extraés datos de facturas de compra argentinas para un ERP de retail. Completá el esquema lo más fielmente " +
        "posible a lo que ves en el documento. Si un dato no está visible, dejalo vacío o en 0 — nunca inventes.",
      tools: [ESQUEMA_FACTURA],
      tool_choice: { type: "tool", name: "extraer_factura" },
      messages: [
        {
          role: "user",
          content: [bloqueArchivo, { type: "text", text: "Extraé los datos de esta factura de compra." }],
        },
      ],
    });
  } catch (err) {
    throw new HttpsError("internal", "No se pudo leer el archivo con la IA: " + (err?.message || "error desconocido"));
  }

  const bloqueUso = respuesta.content.find((b) => b.type === "tool_use");
  if (!bloqueUso) {
    throw new HttpsError("internal", "La IA no pudo extraer datos de este archivo.");
  }

  return bloqueUso.input;
});
