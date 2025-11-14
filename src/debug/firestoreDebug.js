import {
  collection,
  addDoc,
  getDoc,
  doc,
  getFirestore,
} from "firebase/firestore";
import { app, db } from "../config/firebase";

// SUPER DEBUG TEST FOR FIRESTORE WRITE
export async function runFirestoreDeepDebug() {
  console.group("%c🔥 FIRESTORE DEEP DEBUG", "color: #00eaff; font-size: 16px");

  try {
    // 1. SHOW CONFIG
    console.log("📌 Firebase App:", app?.name);
    console.log("📌 Firebase Project:", import.meta.env.VITE_FIREBASE_PROJECT_ID);

    // 2. SHOW FIRESTORE INSTANCE DETAILS
    console.log("📌 Firestore DB Instance:", db);

    // 3. TEST COLLECTION PATH
    const testCollection = "test";
    console.log("📁 Writing to collection:", testCollection);

    // 4. WRITE PAYLOAD
    const payload = {
      timestamp: Date.now(),
      testValue: "hello-world",
      envProjectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      debug: true,
    };
    console.log("🧪 Write Payload:", payload);

    // 5. WRITE DOCUMENT
    console.log("✏️ Attempting addDoc...");
    const ref = await addDoc(collection(db, testCollection), payload);
    console.log("✅ addDoc SUCCESS — Document ID:", ref.id);

    // 6. VERIFY READ
    console.log("📖 Trying to read newly created doc...");
    const snapshot = await getDoc(doc(db, testCollection, ref.id));

    if (snapshot.exists()) {
      console.log("📖 Read OK:", snapshot.data());
    } else {
      console.warn("⚠️ Read FAILED — doc does not exist!");
    }

    console.groupEnd();
    return { ok: true, id: ref.id, data: snapshot.data() };

  } catch (error) {
    console.group("❌ FIRESTORE WRITE ERROR DETAILS");
    console.error("🔥 ERROR OBJECT:", error);
    console.error("🔥 ERROR message:", error.message);
    console.error("🔥 ERROR code:", error.code);
    console.error("🔥 ERROR name:", error.name);
    console.error("🔥 ERROR stack:", error.stack);
    console.groupEnd();

    console.group("🧠 POTENTIAL REASONS");
    console.warn("1️⃣ Wrong Firestore database (Datastore Mode)");
    console.warn("2️⃣ Missing Firestore API enabled in Google Cloud");
    console.warn("3️⃣ Firestore rules block writes");
    console.warn("4️⃣ Wrong projectId or Firebase config");
    console.warn("5️⃣ Missing app initialization");
    console.groupEnd();

    console.groupEnd();

    return { ok: false, error };
  }
}

