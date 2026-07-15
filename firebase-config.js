/* ============================================================
   CLOUD SYNC SETTINGS
   ------------------------------------------------------------
   To make data sync across all devices (Shubha, Darsh, Gauri),
   create a free Firebase project and paste its web config below.
   Setup steps are in README.md ("Cloud sync setup").

   Until you fill this in, the app still works but stores data
   only on the current device (no sharing between phones).
============================================================ */

// Paste your Firebase web config object here (or leave as null for local-only).
window.FIREBASE_CONFIG = null;
/* Example once you have it:
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123"
};
*/

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
