import { auth, onAuthStateChanged } from "/js/firebase.js";
onAuthStateChanged(auth, (user) => {
  location.href = user ? "/dashboard.html" : "/login.html";
});
