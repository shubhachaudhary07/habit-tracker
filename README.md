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

## Run locally

Just open `index.html` in any modern browser. No build step, no dependencies.

## Tech

Plain HTML, CSS, and JavaScript. No frameworks. Data persists via `localStorage`.
Offline support via a service worker (`sw.js`).
