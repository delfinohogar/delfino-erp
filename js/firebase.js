import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  runTransaction,
  writeBatch,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  connectStorageEmulator,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
// southamerica-east1: misma región que Firestore, para no pagar/esperar latencia cross-region.
export const functions = getFunctions(app, "southamerica-east1");
export const storage = getStorage(app);

// --- Aislamiento del entorno de desarrollo (FASE -1) ---------------------------------------
// Regla fija y sin excepciones: si esto se sirve desde localhost/127.0.0.1, va SIEMPRE a los
// emuladores. No hay flag para saltearlo. Si el emulador no está corriendo, el ERP falla al
// conectar — que es lo que queremos: nunca cae de vuelta a producción por descuido.
// Para operar producción desde esta PC, usar el sitio de Netlify, nunca localhost.
// OJO: las páginas cargan desde dist/, así que esto solo tiene efecto DESPUÉS de npm run build.
const EMULADORES = { firestore: 8080, auth: 9099, functions: 5001, storage: 9199 };
const enLocalhost =
  typeof location !== "undefined" && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

if (enLocalhost) {
  connectFirestoreEmulator(db, "127.0.0.1", EMULADORES.firestore);
  connectAuthEmulator(auth, `http://127.0.0.1:${EMULADORES.auth}`, { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", EMULADORES.functions);
  connectStorageEmulator(storage, "127.0.0.1", EMULADORES.storage);
  console.warn(
    `[Delfino] Entorno LOCAL: Firestore/Auth/Functions/Storage apuntan a los emuladores en 127.0.0.1. ` +
      `NO se está usando el proyecto de producción (${firebaseConfig.projectId}).`
  );
}

export {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  runTransaction,
  writeBatch,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  httpsCallable,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
};