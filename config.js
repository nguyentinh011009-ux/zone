// config.js
const firebaseConfig = {
  apiKey: "AIzaSyBrrzgFyy4lNSg-LRKUmS2zlXrvFhRlk7E",
  authDomain: "fuprjaiq.firebaseapp.com",
  projectId: "fuprjaiq",
  storageBucket: "fuprjaiq.firebasestorage.app",
  messagingSenderId: "697852673076",
  appId: "1:697852673076:web:be65900b79a79e5e231e61",
  measurementId: "G-3TV6Z0LNCJ"
};

// Khởi tạo Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
// Bạn chưa dùng đến Authentication trong app.js nên tạm thời chưa cần khởi tạo auth ở đây