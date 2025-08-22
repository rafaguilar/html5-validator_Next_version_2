// src/lib/firebase.ts
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  projectId: "html-validator-38nwr",
  appId: "1:155850881830:web:dc859c7244ce6d9829dfe7",
  storageBucket: "html-validator-38nwr.firebasestorage.app",
  apiKey: "AIzaSyByDVvSbQOZ1Xix_sqq9jNkvQbbd5Gc9PI",
  authDomain: "html-validator-38nwr.firebaseapp.com",
  measurementId: "",
  messagingSenderId: "155850881830"
};

// Initialize Firebase
let app;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

const db = getFirestore(app);

export { db };
