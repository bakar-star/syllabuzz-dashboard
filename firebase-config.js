// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDB3DcIrautXRd7pXeCOgSO6ae2Yj4LYEw",
  authDomain: "syllabuzz-a6b26.firebaseapp.com",
  projectId: "syllabuzz-a6b26",
  storageBucket: "syllabuzz-a6b26.firebasestorage.app",
  messagingSenderId: "460322115137",
  appId: "1:460322115137:web:7c06f332faf9b4b25f40c0",
  measurementId: "G-1YZ8MX58HW"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);