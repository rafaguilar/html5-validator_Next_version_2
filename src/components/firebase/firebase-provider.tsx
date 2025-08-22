
'use client';

import { createContext, useContext } from 'react';
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';

// Your web app's Firebase configuration
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
let firebaseApp: FirebaseApp;
if (!getApps().length) {
  firebaseApp = initializeApp(firebaseConfig);
} else {
  firebaseApp = getApps()[0];
}

const FirebaseContext = createContext<FirebaseApp | null>(null);

export const useFirebase = () => {
  return useContext(FirebaseContext);
};

export const FirebaseProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <FirebaseContext.Provider value={firebaseApp}>
      {children}
    </FirebaseContext.Provider>
  );
};
