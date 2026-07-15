# Habit Tracker

A simple, private habit tracker you can use on your phone or computer. Track habits
month by month, keep a prioritized daily to-do list, manage a calendar of events
(meetings, birthdays, parties) with today's reminders, and see weekly and monthly
reward-point reports with suggestions. Create a separate profile for yourself and
each child.

Everything runs in your browser. Your data is stored locally on your device
(browser local storage) and is never uploaded anywhere.

## Features

- Multiple profiles (you + each kid)
- Habits with emoji icons, categories, weekly goals, and reward points
- Monthly habit grid — tap a day to mark a habit done
- Daily to-do list with High / Medium / Low priority
- Calendar with events and a "Today's events" reminder banner
- Weekly and monthly reports with reward levels and suggestions
- Works offline and can be installed to your phone's home screen (PWA)

## Use it on your phone

This app is hosted for free with GitHub Pages. Once deployed:

1. Open the Pages URL on your phone's browser.
2. **iPhone (Safari):** tap the Share button → **Add to Home Screen**.
3. **Android (Chrome):** tap the ⋮ menu → **Install app** / **Add to Home screen**.
4. Launch it from the home screen icon — it opens full-screen and works offline.

## Family setup (roles + cloud sync)

The app supports role-based URLs so each person sees the right thing:

| Person | URL | Can do |
| --- | --- | --- |
| Shubha (admin) | `.../habit-tracker/?u=shubha` | See/manage all profiles, create & edit habits for everyone |
| Darsh | `.../habit-tracker/?u=darsh` | See only his profile, tick habits, use To-Do / Calendar / Reports |
| Gauri | `.../habit-tracker/?u=gauri` | See only her profile, tick habits, use To-Do / Calendar / Reports |

The child role locks to the profile whose **name matches** the URL (so the admin must
create profiles named exactly `Darsh` and `Gauri`).

### Cloud sync setup (needed so all devices share the same data)

Without this, each device keeps its own separate data. To sync across phones:

1. Go to https://console.firebase.google.com and create a project (free).
2. In the project, open **Build → Firestore Database → Create database** (Start in **test mode**).
3. Open **Project settings → General**, scroll to **Your apps**, click the **Web** (`</>`) icon,
   register an app, and copy the `firebaseConfig` object it shows.
4. Paste that object into `firebase-config.js` (replace the `null`), commit, and push.
5. Everyone now shares the same data in real time.

### Private login (recommended) — only your family can access the data

Test-mode Firestore is open to anyone with the config. To lock it down so only your
family can read/write, add email/password login:

1. In Firebase: **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
2. **Authentication → Users → Add user** — create one account per person, e.g.
   `shubha@example.com`, `darsh@example.com`, `gauri@example.com` (set a password for each).
3. In `firebase-config.js`, set:
   ```js
   window.REQUIRE_LOGIN = true;
   window.ADMIN_EMAILS = ["shubha@example.com"];
   window.USER_PROFILES = {
     "darsh@example.com": "Darsh",
     "gauri@example.com": "Gauri"
   };
   ```
4. Lock the database. In **Firestore → Rules**, paste this and Publish (use your real emails):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /families/{doc} {
         allow read, write: if request.auth != null &&
           request.auth.token.email in [
             'shubha@example.com', 'darsh@example.com', 'gauri@example.com'
           ];
       }
     }
   }
   ```
5. Commit and push. Now everyone signs in with their email/password. The admin account
   sees all profiles; each child account is locked to their own profile automatically —
   no need for the `?u=` URL anymore (though it still works when login is off).

With login on, only those three email accounts can access the data, even if someone
finds the project config. Each person stays signed in across refreshes.

## Run locally

Just open `index.html` in any modern browser. No build step, no dependencies.
Cloud sync is optional; without it the app stores data on the current device only.

## Tech

Plain HTML, CSS, and JavaScript. No frameworks. Data persists via `localStorage`.
Offline support via a service worker (`sw.js`).
