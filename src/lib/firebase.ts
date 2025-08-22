
import { initializeApp, getApps, getApp } from 'firebase/app';
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

// This function ensures Firebase is initialized, either on the server or the client.
const getFirebaseApp = () => {
    if (!getApps().length) {
        return initializeApp(firebaseConfig);
    }
    return getApp();
};

const app = getFirebaseApp();
const db = getFirestore(app);

export { db, app };
