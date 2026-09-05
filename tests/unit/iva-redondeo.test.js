// TASK-002 — aritmética del IVA discriminado. Sin red: es puro cálculo.
//
// Qué se fija acá y por qué importa:
//   1. El criterio aprobado es SUMA DE REDONDEADOS (redondear el IVA de cada línea y después
//      sumar), no redondeo al final. Con 1000,01 al 21 % + 5000,02 al 10,5 % los dos criterios
//      difieren en un centavo: 648,68 contra 648,67. Ese centavo va a una cuenta fiscal.
//      Decisión Nivel 3 de Gastón del 2026-09-04 (migration/DECISIONS.md), tomada de
//      js/contabilidad.js:98-102 + js/ventas.js:412-413.
//   2. La afirmación del implementador —"la suma de netos por línea SIEMPRE coincide con
//      total − iva_total"— se verifica acá por búsqueda exhaustiva y se acota: es cierta
//      salvo empates exactos de medio centavo, que con 21 % y 10,5 % son IMPOSIBLES (se
//      demuestra), y que con otras alícuotas sí existen (se exhibe un contraejemplo).
import { describe, it, expect } from "vitest";
import { discriminarIva } from "../../js/contabilidad.js";
import {
  ivaCentavos, netoCentavos, subtotalCentavos,
  ivaTotalSumaDeRedondeados, ivaTotalRedondeoAlFinal, aPesos,
} from "../_aritmetica_iva.mjs";

// Segunda implementación, con enteros nativos en vez de BigInt: si las dos coinciden en
// 200.000 casos, el error de transcripción de una de ellas queda descartado.
const round2 = (num, den) => Math.floor((2 * num + den) / (2 * den)); // half away from zero, num,den>0
const ivaCent = (c, a10) => (a10 === 0 ? 0 : round2(c * a10, 1000 + a10));
const netoCent = (c, a10) => (a10 === 0 ? c : round2(c * 1000, 1000 + a10));

const LINEAS_MIXTAS = [
  { cantidad: 1, precio_unitario: 1000.01, alicuota: 21 },
  { cantidad: 1, precio_unitario: 5000.02, alicuota: 10.5 },
];

describe("IVA_DISCRIMINADO — el orden de las operaciones decide un centavo", () => {
  it("1000,01 al 21 % da 173,56 y 5000,02 al 10,5 % da 475,12", () => {
    expect(aPesos(ivaCentavos(100001, 21))).toBe(173.56);
    expect(aPesos(ivaCentavos(500002, 10.5))).toBe(475.12);
  });

  it("suma de redondeados = 648,68; redondeo al final = 648,67. NO son intercambiables", () => {
    const aprobado = ivaTotalSumaDeRedondeados(LINEAS_MIXTAS);
    const rechazado = ivaTotalRedondeoAlFinal(LINEAS_MIXTAS);
    expect(aPesos(aprobado)).toBe(648.68);
    expect(aPesos(rechazado)).toBe(648.67);
    expect(aprobado - rechazado).toBe(1n); // un centavo, en 2.1.2 IVA Débito Fiscal
  });

  it("el criterio coincide con discriminarIva() de js/contabilidad.js, que es la fuente", () => {
    // La PoC replica el ERP actual; si el ERP cambiara, este test lo avisa.
    const uno = discriminarIva(1000.01, 21);
    const dos = discriminarIva(5000.02, 10.5);
    expect(uno.iva).toBe(173.56);
    expect(dos.iva).toBe(475.12);
    expect(Math.round((uno.iva + dos.iva) * 100) / 100).toBe(648.68);
    // Y el neto de la venta es el RESIDUO, no la suma de netos por línea (js/ventas.js:412-413).
    expect(Math.round((6000.03 - 648.68) * 100) / 100).toBe(5351.35);
  });

  it("las dos implementaciones exactas de este repo coinciden (control de transcripción)", () => {
    for (const a of [0, 5, 10.5, 21, 27]) {
      for (const c of [1, 7, 99, 12345, 100001, 500002, 999999]) {
        expect(ivaCent(c, a * 10)).toBe(Number(ivaCentavos(c, a)));
        expect(netoCent(c, a * 10)).toBe(Number(netoCentavos(c, a)));
      }
    }
  });

  it("subtotal con cantidad y descuento: 3 × 1000,01 con 10 % = 2700,03", () => {
    expect(aPesos(subtotalCentavos({ cantidad: 3, precio_unitario: 1000.01, descuento_pct: 10 }))).toBe(2700.03);
    expect(aPesos(ivaCentavos(270003, 21))).toBe(468.6);
  });
});

describe("IVA_DISCRIMINADO — verificación de la afirmación del implementador (punto 3)", () => {
  // AFIRMACIÓN: Σ round(neto_i) == total − Σ round(iva_i) para subtotales de 2 decimales,
  // y por eso la discrepancia "neto por línea vs. neto residual" no puede existir.
  //
  // DEMOSTRACIÓN: para un subtotal de c centavos enteros y un IVA exacto x,
  //   round(c − x) = c − round(x)  ⟺  x no es un empate exacto de medio centavo.
  // Basta entonces con probar que el empate es imposible. Con x = c·a/(100+a):
  //   a = 21   → x = 21c/121 = k+1/2 ⟹ 42c = 121(2k+1) ⟹ 121 | c ⟹ x entero. Absurdo.
  //   a = 10,5 → x = 21c/221 = k+1/2 ⟹ 42c = 221(2k+1) ⟹ 221 | c ⟹ x entero. Absurdo.
  // O sea: con las alícuotas del ERP la identidad vale SIEMPRE, línea por línea, y por lo
  // tanto también para cualquier suma de líneas.
  it("por línea: round(neto) == subtotal − round(iva) para 21 % y 10,5 %, exhaustivo hasta $2000", () => {
    for (const a10 of [210, 105]) {
      for (let c = 0; c <= 200000; c++) {
        if (netoCent(c, a10) !== c - ivaCent(c, a10)) {
          throw new Error(`Contraejemplo con alicuota ${a10 / 10} y subtotal ${c} centavos`);
        }
      }
    }
    expect(true).toBe(true);
  });

  it("también vale para 27 %, 5 % y 2,5 %, exhaustivo hasta $2000", () => {
    for (const a10 of [270, 50, 25]) {
      for (let c = 0; c <= 200000; c++) {
        if (netoCent(c, a10) !== c - ivaCent(c, a10)) {
          throw new Error(`Contraejemplo con alicuota ${a10 / 10} y subtotal ${c} centavos`);
        }
      }
    }
    expect(true).toBe(true);
  });

  it("multilínea: la suma de netos por línea coincide con el residuo total − iva_total", () => {
    // 5000 ventas de dos líneas con alícuotas mixtas, subtotales pseudoaleatorios pero fijos.
    let semilla = 987654321;
    const siguiente = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648);
    for (let n = 0; n < 5000; n++) {
      const c1 = siguiente() % 5000000;
      const c2 = siguiente() % 5000000;
      const total = c1 + c2;
      const iva = ivaCent(c1, 210) + ivaCent(c2, 105);
      const netoPorLinea = netoCent(c1, 210) + netoCent(c2, 105);
      expect(netoPorLinea).toBe(total - iva);
    }
  });

  it("PERO la afirmación no es universal: con alícuota 100 % (que el CHECK permite) hay contraejemplo", () => {
    // c = 1 centavo, a = 100 % ⇒ iva exacto = 0,5 centavos, neto exacto = 0,5 centavos.
    // Los dos redondean hacia arriba: iva 1, neto 1, y 1 + 1 ≠ 1.
    expect(ivaCent(1, 1000)).toBe(1);
    expect(netoCent(1, 1000)).toBe(1);
    expect(netoCent(1, 1000)).not.toBe(1 - ivaCent(1, 1000));
    // Consecuencia práctica: la implementación NO puede apoyarse en esa coincidencia. Como el
    // neto se calcula como residuo, el asiento cierra igual y 2.1.2 queda exacto también acá.
    // El riesgo queda concentrado, entero, en el ORDEN de redondeo del IVA (punto 2).
  });
});
