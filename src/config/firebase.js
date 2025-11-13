import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBfW-DJsytPbGbIutbYfd9kXO9y7jCqCEg",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "eataly-creative-ai-suite.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "eataly-creative-ai-suite",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "eataly-creative-ai-suite.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "392418318075",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:392418318075:web:3c1aa88df71dca64da425e",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-GSE68WH3P9"
};

// Initialize Firebase
let app;
let db;
let storage;

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  storage = getStorage(app);
  console.log('✅ Firebase initialized successfully');
} catch (error) {
  console.error('❌ Error initializing Firebase:', error);
  throw error;
}

export { db, storage };
export default app;

