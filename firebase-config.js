/* ============================================================
   CLOUD SYNC SETTINGS
   ------------------------------------------------------------
   To make data sync across all devices (Shubha, Darsh, Gauri),
   create a free Firebase project and paste its web config below.
   Setup steps are in README.md ("Cloud sync setup").

   Until you fill this in, the app still works but stores data
   only on the current device (no sharing between phones).
============================================================ */

// Firebase web config (enables cloud sync across devices).
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCbFbif1oHHv2AifeL_jOWVFVwO1kuLwiw",
  authDomain: "habit-tracker-1f97b.firebaseapp.com",
  projectId: "habit-tracker-1f97b",
  storageBucket: "habit-tracker-1f97b.firebasestorage.app",
  messagingSenderId: "2005871959",
  appId: "1:2005871959:web:1e65cf03669c474514e212",
  measurementId: "G-15V3J5NYNQ"
};

// A shared id for your family's data. Everyone must use the SAME value.
window.FAMILY_ID = "chaudhary-family";

/* ------------------------------------------------------------
   LOGIN (optional, for real privacy)
   Turn this on AFTER you enable Email/Password sign-in in Firebase
   and create one account per family member (see README).
------------------------------------------------------------ */
window.REQUIRE_LOGIN = false; // set to true once accounts are created

// Emails that get full admin access (see/manage everyone).
window.ADMIN_EMAILS = [
  // "shubha@example.com"
];

// Map each child's login email to the profile name they should be locked to.
window.USER_PROFILES = {
  // "darsh@example.com": "Darsh",
  // "gauri@example.com": "Gauri"
};
