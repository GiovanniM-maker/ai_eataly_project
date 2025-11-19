import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, setLogLevel } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Log Firebase config immediately after definition (before initialization)
console.log("🔥 Firebase Config in uso:", firebaseConfig);
console.log("🔥 Environment variables loaded:", {
  hasApiKey: !!import.meta.env.VITE_FIREBASE_API_KEY,
  hasProjectId: !!import.meta.env.VITE_FIREBASE_PROJECT_ID,
  allEnvVars: Object.keys(import.meta.env).filter(k => k.startsWith('VITE_'))
});

// Check if all required variables are present
const requiredVars = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID'];
const missingVars = requiredVars.filter(v => !import.meta.env[v]);
if (missingVars.length > 0) {
  console.error("❌ Missing Firebase environment variables:", missingVars);
  console.error("💡 Make sure you have a .env file in the project root with all VITE_FIREBASE_* variables");
}

// Initialize Firebase only if we have the minimum required config
let app;
try {
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    throw new Error("Missing required Firebase configuration. Check your .env file.");
  }
  app = initializeApp(firebaseConfig);
  console.log("✅ Firebase initialized successfully");
} catch (error) {
  console.error("❌ Firebase initialization error:", error);
  // Create a dummy app to prevent crashes
  try {
    app = initializeApp({
      apiKey: "dummy",
      authDomain: "dummy",
      projectId: "dummy",
      storageBucket: "dummy",
      messagingSenderId: "dummy",
      appId: "dummy"
    }, "dummy-app");
  } catch (e) {
    console.error("❌ Failed to create dummy Firebase app:", e);
  }
}

export { app };

// Log active Firebase apps after initialization
console.log("🔥 Firebase Apps attive:", getApps());

// Initialize Firestore only if app is valid
let db;
try {
  if (app && app.name !== 'dummy-app') {
    db = getFirestore(app);
    // Enable extreme debug logging
    setLogLevel("debug");
    console.log("✅ Firestore initialized successfully");
  } else {
    console.warn("⚠️ Firestore not initialized - using dummy Firebase app");
  }
} catch (error) {
  console.error("❌ Firestore initialization error:", error);
}

export { db };

// Initialize Firebase Storage only if app is valid
let storage;
try {
  if (app && app.name !== 'dummy-app') {
    storage = getStorage(app);
    console.log("✅ Firebase Storage initialized successfully");
  } else {
    console.warn("⚠️ Firebase Storage not initialized - using dummy Firebase app");
  }
} catch (error) {
  console.error("❌ Firebase Storage initialization error:", error);
}

export { storage };

