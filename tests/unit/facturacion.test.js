import { describe, it, expect } from "vitest";
import { subtotalItem, calcularTotales, formatearNumeroComprobante } from "../../js/facturacion.js";

describe("facturacion — calculos puros", () => {
  it("subtotalItem aplica descuento y redondea a centavos", () => {
    expect(subtotalItem({ cantidad: 3, precioUnitario: 1000, descuentoPct: 10 })).toBe(2700);
  });
  it("formatearNumeroComprobante rellena a 8 digitos", () => {
    expect(formatearNumeroComprobante("0001", 42)).toBe("0001-00000042");
  });
  // precioUnitario YA INCLUYE IVA (igual que el resto del sistema) — calcularTotales no lo suma, lo
  // DISCRIMINA hacia atrás. subtotal es el NETO (sin IVA), no "el bruto después del descuento"; total
  // es el bruto que paga el cliente, con IVA adentro. Confundir estos dos es fácil (ya pasó una vez
  // en este archivo) — por eso acá abajo se verifica el objeto completo y la identidad
  // subtotal + iva === total, no un número suelto.
  it("calcularTotales discrimina el IVA del precio con descuento global (alícuota 21% por defecto)", () => {
    const t = calcularTotales([{ cantidad: 2, precioUnitario: 500 }], 10);
    expect(t).toEqual({ subtotal: 743.8, descuento: 100, iva: 156.2, total: 900 });
    expect(t.subtotal + t.iva).toBe(t.total);
  });

  it("calcularTotales usa la alícuota del producto, no el 21% por defecto", () => {
    const t = calcularTotales([{ cantidad: 2, precioUnitario: 500, iva: 10.5 }], 10);
    expect(t).toEqual({ subtotal: 814.48, descuento: 100, iva: 85.52, total: 900 });
  });

  it("calcularTotales sin descuento global, caso redondo", () => {
    const t = calcularTotales([{ cantidad: 1, precioUnitario: 121, iva: 21 }]);
    expect(t).toEqual({ subtotal: 100, descuento: 0, iva: 21, total: 121 });
  });
});
