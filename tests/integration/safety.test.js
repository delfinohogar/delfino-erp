// SAFETY CHECK (FASE -1, punto 9).
// Verifica que una escritura hecha desde el entorno de desarrollo va al emulador
// y no puede llegar a Firestore de produccion. Si alguien rompe el aislamiento,
// este test falla en la maquina de desarrollo Y en CI.
import { describe, it, expect, beforeAll } from "vitest";
import { initializeApp, deleteApp } from "firebase/app";
import { getFirestore, connectFirestoreEmulator, collection, addDoc, getDoc, doc } from "firebase/firestore";
import { firebaseConfig } from "../../js/firebase-config.js";

let app, db;

beforeAll(() => {
  app = initializeApp(firebaseConfig, `safety-${Date.now()}`);
  db = getFirestore(app);
  const [host, puerto] = (process.env.FIRESTORE_EMULATOR_HOST || "").split(":");
  connectFirestoreEmulator(db, host, Number(puerto));
});

describe("aislamiento del entorno de desarrollo", () => {
  it("FIRESTORE_EMULATOR_HOST esta definido y es local", () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST || "";
    expect(host).toMatch(/^(127\.0\.0\.1|localhost):\d+$/);
  });

  it("la instancia de Firestore apunta al emulador, no a firestore.googleapis.com", () => {
    const host = db._settings?.host ?? db.toJSON?.().settings?.host ?? "";
    expect(String(host)).not.toContain("googleapis.com");
    expect(String(host)).toMatch(/127\.0\.0\.1|localhost/);
  });

  it("una escritura de prueba va al emulador y se puede leer de vuelta", async () => {
    const marca = `safety-${Date.now()}`;
    const ref = await addDoc(collection(db, "_safety"), { marca, entorno: "desarrollo" });
    const leido = await getDoc(doc(db, "_safety", ref.id));
    expect(leido.exists()).toBe(true);
    expect(leido.data().marca).toBe(marca);
  });

  it("js/firebase-config.js sigue apuntando al proyecto real (el aislamiento no depende de cambiarlo)", () => {
    expect(firebaseConfig.projectId).toBe("delfino-hogar-erp");
  });
});
