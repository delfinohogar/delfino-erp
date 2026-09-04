import { describe, it, expect } from "vitest";
import { generarAsiento, PLAN_DE_CUENTAS, CUENTA } from "../../js/contabilidad.js";

const usuario = { uid: "test-uid" };

describe("contabilidad — invariante CONTABILIDAD (Debe = Haber)", () => {
  it("rechaza un asiento desbalanceado ANTES de escribir nada", async () => {
    await expect(
      generarAsiento(
        {
          fecha: "2026-01-15",
          descripcion: "asiento roto a proposito",
          origen: { tipo: "test", id: "x", numero: 1 },
          movimientos: [
            { cuenta: CUENTA.CAJA, debe: 100, haber: 0 },
            { cuenta: CUENTA.VENTAS, debe: 0, haber: 90 },
          ],
        },
        usuario
      )
    ).rejects.toThrow(/no balanceado/i);
  });

  it("el plan de cuentas tiene codigos unicos", () => {
    const codigos = PLAN_DE_CUENTAS.map((c) => c.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it("toda cuenta con padre referencia un codigo existente", () => {
    const codigos = new Set(PLAN_DE_CUENTAS.map((c) => c.codigo));
    const huerfanas = PLAN_DE_CUENTAS.filter((c) => c.padre && !codigos.has(c.padre));
    expect(huerfanas).toEqual([]);
  });

  it("las cuentas usadas por ventas.js son imputables y existen", () => {
    const imputables = new Set(PLAN_DE_CUENTAS.filter((c) => c.imputable).map((c) => c.codigo));
    for (const codigo of Object.values(CUENTA)) expect(imputables.has(codigo)).toBe(true);
  });
});
