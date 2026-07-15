/* ============================================================
   Habit Tracker - vanilla JS, data saved in localStorage.
   Data model:
   state = {
     currentProfileId,
     profiles: [{ id, name, habits:[], log:{}, todos:[] }]
   }
   habit = { id, name, category, goal(1-7), points }
   log   = { [habitId]: { "YYYY-MM-DD": true } }
   todo  = { id, text, priority, date:"YYYY-MM-DD", done }
============================================================ */

const STORAGE_KEY = "habitTrackerData.v1";

// ---------- Date helpers ----------
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }

// Monday-based start of week
function startOfWeek(d) {
  const c = new Date(d);
  const day = (c.getDay() + 6) % 7; // Mon=0
  c.setDate(c.getDate() - day);
  c.setHours(0, 0, 0, 0);
  return c;
}
function addDays(d, n) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }

// ---------- State ----------
let state = load();
let view = "habits";
let cursorMonth = new Date().getMonth();
let cursorYear = new Date().getFullYear();
let cursorDay = new Date();
let cursorWeek = startOfWeek(new Date());
let reportMonth = new Date().getMonth();
let reportYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();
let eventModalDate = null;
let reminderDismissed = false;
let habitScrollMemory = null;
let editingHabitId = null;
let selectedEmoji = "🎯";

// ---------- Roles (from URL ?u=...) ----------
// ?u=shubha -> admin (full access). ?u=darsh / ?u=gauri -> locked to that profile.
const ADMIN_ROLES = ["shubha", "admin", "parent"];
const ROLE = (new URLSearchParams(location.search).get("u") || "").trim().toLowerCase();
let roleLocked = false; // local-only lock driven by role (never synced)

function isAdminRole() { return !ROLE || ADMIN_ROLES.includes(ROLE); }

// ---------- Cloud sync (Firebase Firestore) + Auth ----------
let db = null, familyRef = null, cloudTimer = null, cloudReady = false;
let authUser = null, firebaseInited = false;

function ensureFirebase() {
  if (firebaseInited) return true;
  if (!window.FIREBASE_CONFIG || typeof firebase === "undefined") return false;
  try { firebase.initializeApp(window.FIREBASE_CONFIG); firebaseInited = true; return true; }
  catch (e) { console.warn("Firebase init failed:", e); return false; }
}

// Orchestrates: local-only, cloud-only, or cloud + login depending on config.
function initCloud() {
  if (!ensureFirebase()) return; // local-only mode
  if (window.REQUIRE_LOGIN && firebase.auth) initAuth();
  else startCloud();
}

// Email/password login gate.
function initAuth() {
  const auth = firebase.auth();
  $("authGate").classList.add("show"); // show until we know the auth state

  $("authForm").addEventListener("submit", (e) => {
    e.preventDefault();
    $("authError").textContent = "";
    $("authSubmit").disabled = true;
    auth.signInWithEmailAndPassword($("authEmail").value.trim(), $("authPassword").value)
      .catch((err) => { $("authError").textContent = friendlyAuthError(err); })
      .finally(() => { $("authSubmit").disabled = false; });
  });
  $("signOutBtn").addEventListener("click", () => auth.signOut());

  auth.onAuthStateChanged((user) => {
    authUser = user || null;
    if (!user) {
      document.body.classList.remove("authed");
      $("authGate").classList.add("show");
      return;
    }
    document.body.classList.add("authed");
    $("authGate").classList.remove("show");
    $("authPassword").value = "";
    startCloud();
    applyRoleLock();
    renderAll();
  });
}

// Begin real-time Firestore sync of the shared family data.
function startCloud() {
  if (familyRef) return; // already running
  db = firebase.firestore();
  familyRef = db.collection("families").doc(window.FAMILY_ID || "family");
  familyRef.onSnapshot(
    (doc) => {
      if (doc.metadata.hasPendingWrites) return; // ignore our own just-written data
      const data = doc.data();
      if (data && Array.isArray(data.profiles)) {
        // Sync only shared DATA; keep this device's own view/lock settings.
        state.profiles = data.profiles;
        if (typeof data.pin !== "undefined") state.pin = data.pin;
        migrate();
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
        if (!state.currentProfileId && state.profiles[0]) state.currentProfileId = state.profiles[0].id;
        applyRoleLock();
        renderAll();
      } else if (!cloudReady) {
        cloudSave(true); // first run: seed the cloud with local data
      }
      cloudReady = true;
    },
    (err) => console.warn("Cloud sync error:", err)
  );
}

function friendlyAuthError(err) {
  const c = (err && err.code) || "";
  if (c.includes("wrong-password") || c.includes("invalid-credential")) return "Wrong email or password.";
  if (c.includes("user-not-found")) return "No account found for that email.";
  if (c.includes("invalid-email")) return "That doesn't look like a valid email.";
  if (c.includes("too-many-requests")) return "Too many attempts. Please try again later.";
  if (c.includes("network")) return "Network error. Check your connection.";
  return (err && err.message) || "Sign-in failed.";
}

// Determine access from the login account (preferred) or the URL role.
function effectiveRole() {
  if (window.REQUIRE_LOGIN && authUser && authUser.email) {
    const email = authUser.email.trim().toLowerCase();
    const admins = (window.ADMIN_EMAILS || []).map((e) => String(e).toLowerCase());
    if (admins.includes(email)) return { admin: true, profileName: null };
    const map = window.USER_PROFILES || {};
    const key = Object.keys(map).find((k) => k.toLowerCase() === email);
    return { admin: false, profileName: key ? map[key] : null };
  }
  if (isAdminRole()) return { admin: true, profileName: null };
  return { admin: false, profileName: ROLE };
}

// Push shared data (profiles + pin only) to the cloud, debounced.
function cloudSave(immediate) {
  if (!familyRef) return;
  if (!cloudReady && !immediate) return; // wait until we've seen the cloud once
  clearTimeout(cloudTimer);
  const write = () =>
    familyRef.set({ profiles: state.profiles, pin: state.pin || null, _updatedAt: Date.now() })
      .catch((e) => console.warn("Cloud write failed:", e));
  if (immediate) write();
  else cloudTimer = setTimeout(write, 600);
}

// Kid-friendly emoji choices for the picker
const EMOJI_CHOICES = [
  "🎯","📚","✏️","📖","🧮","🔬","🎨","🎵",
  "🏃","⚽","🚴","🏊","🧘","💪","🤸","🥋",
  "🦷","🛁","🛏️","🧹","🍎","🥦","💧","🥕",
  "🐶","🐱","🌱","☀️","⭐","❤️","😊","🙏",
  "💻","🎮","📝","🧩","🎹","🎸","🏀","🎾"
];

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn("Could not load data", e); }
  return {
    currentProfileId: null,
    profiles: [],
    pin: null,          // parent PIN to unlock Kid Mode
    locked: false,      // is Kid Mode active
    lockedProfileId: null,
  };
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.warn("Local save failed", e); }
  cloudSave();
}

function currentProfile() {
  return state.profiles.find((p) => p.id === state.currentProfileId) || null;
}

function seedIfEmpty() {
  if (state.profiles.length === 0) {
    const p = newProfile("Me");
    p.habits = [
      { id: uid(), name: "Exercise", category: "Health", goal: 5, points: 10, emoji: "🏃" },
      { id: uid(), name: "Read", category: "Growth", goal: 7, points: 10, emoji: "📚" },
      { id: uid(), name: "Drink water", category: "Health", goal: 7, points: 5, emoji: "💧" },
    ];
    state.profiles.push(p);
    state.currentProfileId = p.id;
    save();
  }
  if (!state.currentProfileId && state.profiles.length) {
    state.currentProfileId = state.profiles[0].id;
  }
}

function newProfile(name) {
  return { id: uid(), name, habits: [], log: {}, todos: [], events: [] };
}

// Event types -> emoji labels
const EVENT_TYPES = {
  meeting: "📅",
  birthday: "🎂",
  party: "🎉",
  reminder: "⏰",
  appointment: "🩺",
  other: "📌",
};

// Make sure older saved profiles/state have the newer fields
function migrate() {
  state.profiles.forEach((p) => { if (!p.events) p.events = []; });
  if (typeof state.pin === "undefined") state.pin = null;
  if (typeof state.locked === "undefined") state.locked = false;
  if (typeof state.lockedProfileId === "undefined") state.lockedProfileId = null;
  // If a locked profile was removed, drop the lock so the app isn't stuck.
  if (state.locked && !state.profiles.some((p) => p.id === state.lockedProfileId)) {
    state.locked = false;
    state.lockedProfileId = null;
  }
}

// ---------- Element refs ----------
const $ = (id) => document.getElementById(id);
const profileSelect = $("profileSelect");

// ---------- Profiles ----------
function renderProfiles() {
  profileSelect.innerHTML = "";
  state.profiles.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === state.currentProfileId) opt.selected = true;
    profileSelect.appendChild(opt);
  });
}

profileSelect.addEventListener("change", (e) => {
  if (state.locked || roleLocked) { applyRoleLock(); return; }
  state.currentProfileId = e.target.value;
  reminderDismissed = false;
  save();
  renderAll();
});

$("addProfileBtn").addEventListener("click", () => {
  if (state.locked || roleLocked) return;
  const name = prompt("Profile name (e.g. a child's name):");
  if (!name || !name.trim()) return;
  const p = newProfile(name.trim());
  state.profiles.push(p);
  state.currentProfileId = p.id;
  save();
  renderProfiles();
  renderAll();
});

// ---------- Kid Mode (lock to one profile) ----------
$("lockBtn").addEventListener("click", toggleLock);

function toggleLock() {
  if (state.locked) {
    // Unlock requires the parent PIN
    const entered = prompt("Enter parent PIN to unlock:");
    if (entered === null) return;
    if (entered === state.pin) {
      state.locked = false;
      save();
      applyMode();
      renderAll();
    } else {
      alert("Incorrect PIN.");
    }
    return;
  }

  // Turning Kid Mode ON
  if (!state.pin) {
    const pin = prompt("Create a parent PIN (needed to unlock and manage habits):");
    if (!pin || !pin.trim()) return;
    const confirmPin = prompt("Re-enter the PIN to confirm:");
    if (confirmPin !== pin) { alert("PINs did not match. Try again."); return; }
    state.pin = pin.trim();
  }
  const p = currentProfile();
  if (!p) return;
  const ok = confirm(
    `Lock the app to "${p.name}"'s profile (Kid Mode)?\n\n` +
    `They can tick habits, use To-Do, Calendar and Reports, and add/edit their own events, ` +
    `but cannot add or edit habits or switch profiles.\n\nEnter your PIN to unlock later.`
  );
  if (!ok) return;
  state.locked = true;
  state.lockedProfileId = p.id;
  save();
  applyMode();
  renderAll();
}

// Applies the effective role (from login account or URL) on top of Kid Mode.
function applyRoleLock() {
  const r = effectiveRole();
  if (!r.admin) {
    // Child: lock to the profile whose name matches.
    roleLocked = true;
    const prof = r.profileName
      ? state.profiles.find((p) => (p.name || "").trim().toLowerCase() === r.profileName.trim().toLowerCase())
      : null;
    if (prof) {
      state.currentProfileId = prof.id;
      $("lockedProfileName").textContent = prof.name;
    } else {
      const nice = r.profileName || "Your profile";
      $("lockedProfileName").textContent = `${nice} — ask admin to create this profile`;
      state.currentProfileId = null;
    }
    document.body.classList.add("kid-mode", "role-kid");
    document.body.classList.remove("role-admin");
    return;
  }
  // Admin: full access.
  roleLocked = false;
  if (ROLE || window.REQUIRE_LOGIN) {
    state.locked = false;
    document.body.classList.add("role-admin");
    document.body.classList.remove("kid-mode", "role-kid");
  }
  applyMode();
}

// Applies lock restrictions to the UI and forces the locked profile.
function applyMode() {
  if (state.locked && state.lockedProfileId) {
    state.currentProfileId = state.lockedProfileId;
  }
  document.body.classList.toggle("kid-mode", !!state.locked);
  const p = currentProfile();
  $("lockedProfileName").textContent = p ? p.name : "";
  $("lockBtn").textContent = state.locked ? "🔒 Unlock" : "🔒 Kid Mode";
}

$("deleteProfileBtn").addEventListener("click", () => {
  if (state.locked || roleLocked) return;
  const p = currentProfile();
  if (!p) return;
  if (state.profiles.length === 1) {
    alert("You need at least one profile.");
    return;
  }
  if (!confirm(`Delete profile "${p.name}" and all its data?`)) return;
  state.profiles = state.profiles.filter((x) => x.id !== p.id);
  state.currentProfileId = state.profiles[0].id;
  save();
  renderProfiles();
  renderAll();
});

// ---------- Tabs ----------
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    view = tab.dataset.view;
    $(`view-${view}`).classList.add("active");
    renderAll();
  });
});

// ---------- Habits view ----------
$("prevMonth").addEventListener("click", () => { shiftMonth(-1); renderHabits(); });
$("nextMonth").addEventListener("click", () => { shiftMonth(1); renderHabits(); });

function shiftMonth(delta) {
  cursorMonth += delta;
  if (cursorMonth < 0) { cursorMonth = 11; cursorYear--; }
  if (cursorMonth > 11) { cursorMonth = 0; cursorYear++; }
}

function isDone(profile, habitId, dateStr) {
  return !!(profile.log[habitId] && profile.log[habitId][dateStr]);
}

function toggleDone(profile, habitId, dateStr) {
  if (!profile.log[habitId]) profile.log[habitId] = {};
  if (profile.log[habitId][dateStr]) delete profile.log[habitId][dateStr];
  else profile.log[habitId][dateStr] = true;
  save();
}

function renderHabits(autoScroll = true) {
  const p = currentProfile();
  $("monthLabel").textContent = `${MONTHS[cursorMonth]} ${cursorYear}`;
  const table = $("habitTable");
  const hint = $("habitEmptyHint");
  table.innerHTML = "";

  if (!p || p.habits.length === 0) {
    hint.style.display = "block";
    $("monthPointsBanner").textContent = "";
    return;
  }
  hint.style.display = "none";

  const dim = daysInMonth(cursorYear, cursorMonth);
  const todayStr = iso(new Date());

  // Header row
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  hr.innerHTML = `<th class="habit-name">Habit</th>`;
  for (let d = 1; d <= dim; d++) {
    const dateStr = `${cursorYear}-${pad(cursorMonth + 1)}-${pad(d)}`;
    const wd = DAYS[new Date(cursorYear, cursorMonth, d).getDay()];
    const cls = dateStr === todayStr ? "today" : "";
    hr.innerHTML += `<th class="date-col ${cls}">${d}<br><span class="cat">${wd}</span></th>`;
  }
  hr.innerHTML += `<th class="col-goal">✓ / Goal</th><th class="col-points">Points</th>`;
  thead.appendChild(hr);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement("tbody");
  let monthPoints = 0;

  p.habits.forEach((h) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="habit-name">
      <div class="hn-main"><span class="habit-emoji">${escapeHtml(h.emoji || "🎯")}</span><span class="hn-text">${escapeHtml(h.name)}</span></div>
      <div class="hn-sub">
        <span class="cat">${escapeHtml(h.category || "")}</span>
        <span class="habit-actions">
          <button class="icon-btn edit" title="Edit">✎</button>
          <button class="icon-btn del" title="Delete">✕</button>
        </span>
      </div>
    </td>`;
    let count = 0;
    for (let d = 1; d <= dim; d++) {
      const dateStr = `${cursorYear}-${pad(cursorMonth + 1)}-${pad(d)}`;
      const done = isDone(p, h.id, dateStr);
      if (done) count++;
      const cls = "habit-cell date-col" + (done ? " done" : "") + (dateStr === todayStr ? " today" : "");
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = done ? "✓" : "";
      td.addEventListener("click", () => {
        const wrap = document.querySelector("#view-habits .table-wrap");
        habitScrollMemory = wrap ? wrap.scrollLeft : null;
        toggleDone(p, h.id, dateStr);
        renderHabits(false);
      });
      tr.appendChild(td);
    }
    const pts = count * (h.points || 0);
    monthPoints += pts;
    // monthly target = goal per week * ~weeks in month
    const weeks = dim / 7;
    const target = Math.round((h.goal || 7) * weeks);
    const summaryTd = document.createElement("td");
    summaryTd.className = "habit-summary col-goal";
    summaryTd.textContent = `${count} / ${target}`;
    tr.appendChild(summaryTd);
    const ptsTd = document.createElement("td");
    ptsTd.className = "col-points";
    ptsTd.textContent = pts;
    tr.appendChild(ptsTd);
    // Edit/delete icons now live inside the habit-name cell
    tr.querySelector(".edit").addEventListener("click", () => openHabitModal(h));
    tr.querySelector(".del").addEventListener("click", () => deleteHabit(h.id));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  $("monthPointsBanner").innerHTML =
    `<span class="star">★</span> ${monthPoints} reward points earned in ${MONTHS[cursorMonth]}`;

  // On mobile, put today's column first; otherwise preserve the scroll position.
  if (autoScroll) scrollHabitsToToday();
  else restoreHabitScroll();
}

// Positions the horizontal scroll so today's date sits right after the
// frozen habit column (mobile frozen-pane behavior).
function scrollHabitsToToday() {
  if (window.innerWidth > 720) return;
  requestAnimationFrame(() => {
    const wrap = document.querySelector("#view-habits .table-wrap");
    const todayTh = document.querySelector("#habitTable thead th.today");
    const habitTh = document.querySelector("#habitTable thead th.habit-name");
    if (!wrap || !todayTh || !habitTh) return;
    wrap.scrollLeft = todayTh.offsetLeft - habitTh.offsetWidth;
  });
}

// Keeps the current horizontal scroll after re-render (e.g. ticking a day).
function restoreHabitScroll() {
  if (habitScrollMemory == null) return;
  const target = habitScrollMemory;
  requestAnimationFrame(() => {
    const wrap = document.querySelector("#view-habits .table-wrap");
    if (wrap) wrap.scrollLeft = target;
  });
}

function deleteHabit(id) {
  if (state.locked || roleLocked) return; // Kid Mode: cannot delete habits
  const p = currentProfile();
  if (!confirm("Delete this habit and its history?")) return;
  p.habits = p.habits.filter((h) => h.id !== id);
  delete p.log[id];
  save();
  renderHabits();
}

// ---------- Habit modal ----------
$("addHabitBtn").addEventListener("click", () => openHabitModal(null));
$("cancelHabit").addEventListener("click", closeHabitModal);
$("saveHabit").addEventListener("click", saveHabitFromModal);
$("habitModal").addEventListener("click", (e) => {
  if (e.target.id === "habitModal") closeHabitModal();
});

function openHabitModal(habit) {
  if (state.locked || roleLocked) return; // Kid Mode: habits are fill-only
  editingHabitId = habit ? habit.id : null;
  $("habitModalTitle").textContent = habit ? "Edit Habit" : "Add Habit";
  $("habitName").value = habit ? habit.name : "";
  $("habitCategory").value = habit ? habit.category || "" : "";
  $("habitGoal").value = habit ? habit.goal : 7;
  $("habitPoints").value = habit ? habit.points : 10;
  selectedEmoji = habit && habit.emoji ? habit.emoji : "🎯";
  buildEmojiPicker();
  $("habitModal").classList.add("open");
  document.body.classList.add("modal-open");
  $("habitName").focus();
}

function buildEmojiPicker() {
  $("emojiPreview").textContent = selectedEmoji;
  const picker = $("emojiPicker");
  picker.innerHTML = "";
  EMOJI_CHOICES.forEach((emo) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = emo;
    if (emo === selectedEmoji) b.classList.add("selected");
    b.addEventListener("click", () => {
      selectedEmoji = emo;
      buildEmojiPicker();
    });
    picker.appendChild(b);
  });
}

function closeHabitModal() {
  $("habitModal").classList.remove("open");
  document.body.classList.remove("modal-open");
  editingHabitId = null;
}

function saveHabitFromModal() {
  if (state.locked || roleLocked) return; // Kid Mode: cannot create/edit habits
  const p = currentProfile();
  const name = $("habitName").value.trim();
  if (!name) { alert("Please enter a habit name."); return; }
  const category = $("habitCategory").value.trim();
  const goal = Math.min(7, Math.max(1, parseInt($("habitGoal").value) || 7));
  const points = Math.max(1, parseInt($("habitPoints").value) || 10);

  if (editingHabitId) {
    const h = p.habits.find((x) => x.id === editingHabitId);
    Object.assign(h, { name, category, goal, points, emoji: selectedEmoji });
  } else {
    p.habits.push({ id: uid(), name, category, goal, points, emoji: selectedEmoji });
  }
  save();
  closeHabitModal();
  renderHabits();
}

// ---------- To-Do view ----------
$("prevDay").addEventListener("click", () => { cursorDay = addDays(cursorDay, -1); renderTodos(); });
$("nextDay").addEventListener("click", () => { cursorDay = addDays(cursorDay, 1); renderTodos(); });
$("todayBtn").addEventListener("click", () => { cursorDay = new Date(); renderTodos(); });

$("todoForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const p = currentProfile();
  const text = $("todoInput").value.trim();
  if (!text) return;
  p.todos.push({
    id: uid(),
    text,
    priority: $("todoPriority").value,
    date: iso(cursorDay),
    done: false,
  });
  $("todoInput").value = "";
  save();
  renderTodos();
});

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function renderTodos() {
  const p = currentProfile();
  if (!p) { $("todoList").innerHTML = ""; $("todoEmptyHint").style.display = "block"; return; }
  const dateStr = iso(cursorDay);
  const isToday = dateStr === iso(new Date());
  $("dayLabel").textContent =
    (isToday ? "Today · " : "") +
    `${DAYS[cursorDay.getDay()]}, ${MONTHS[cursorDay.getMonth()]} ${cursorDay.getDate()}`;

  const list = $("todoList");
  list.innerHTML = "";
  const items = p.todos
    .filter((t) => t.date === dateStr)
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  $("todoEmptyHint").style.display = items.length ? "none" : "block";

  items.forEach((t) => {
    const li = document.createElement("li");
    li.className = `todo-item p-${t.priority}` + (t.done ? " done" : "");
    li.innerHTML = `
      <input type="checkbox" ${t.done ? "checked" : ""} />
      <span class="todo-text">${escapeHtml(t.text)}</span>
      <span class="todo-badge">${t.priority}</span>
      <button class="icon-btn del" title="Delete">✕</button>`;
    li.querySelector("input").addEventListener("change", () => {
      t.done = !t.done; save(); renderTodos();
    });
    li.querySelector(".del").addEventListener("click", () => {
      p.todos = p.todos.filter((x) => x.id !== t.id); save(); renderTodos();
    });
    list.appendChild(li);
  });
}

// ---------- Reporting helpers ----------
// Count completions + points for a habit over a date range [start, end] inclusive.
function tallyRange(profile, start, end) {
  const result = { habits: [], totalDone: 0, totalPossible: 0, totalPoints: 0 };
  const days = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) days.push(iso(d));
  const spanDays = days.length;
  const spanWeeks = spanDays / 7;

  profile.habits.forEach((h) => {
    let done = 0;
    days.forEach((ds) => { if (isDone(profile, h.id, ds)) done++; });
    const target = Math.max(1, Math.round((h.goal || 7) * spanWeeks));
    const pct = Math.min(100, Math.round((done / target) * 100));
    const points = done * (h.points || 0);
    result.habits.push({ name: h.name, emoji: h.emoji || "🎯", category: h.category, done, target, pct, points, goal: h.goal });
    result.totalDone += done;
    result.totalPossible += target;
    result.totalPoints += points;
  });
  result.overallPct = result.totalPossible
    ? Math.round((result.totalDone / result.totalPossible) * 100) : 0;
  return result;
}

// Current streak (consecutive days up to `upTo`) across any completion.
function longestStreak(profile, start, end) {
  let best = 0, cur = 0;
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const ds = iso(d);
    const any = profile.habits.some((h) => isDone(profile, h.id, ds));
    if (any) { cur++; best = Math.max(best, cur); } else cur = 0;
  }
  return best;
}

function statCard(num, label) {
  return `<div class="stat-card"><div class="num">${num}</div><div class="lbl">${label}</div></div>`;
}

function barRows(habits) {
  if (!habits.length) return `<p class="empty-hint">No habits to report.</p>`;
  return habits.map((h) => `
    <div class="bar-row">
      <span class="name"><span class="habit-emoji">${escapeHtml(h.emoji || "🎯")}</span>${escapeHtml(h.name)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${h.pct}%"></span></span>
      <span class="pct">${h.pct}%</span>
    </div>`).join("");
}

function rewardTier(points) {
  if (points >= 300) return { tag: "good", text: "🏆 Champion" };
  if (points >= 150) return { tag: "good", text: "🌟 Great" };
  if (points >= 50) return { tag: "warn", text: "👍 Good start" };
  return { tag: "bad", text: "🌱 Keep going" };
}

// ---------- Weekly report ----------
$("prevWeek").addEventListener("click", () => { cursorWeek = addDays(cursorWeek, -7); renderWeekly(); });
$("nextWeek").addEventListener("click", () => { cursorWeek = addDays(cursorWeek, 7); renderWeekly(); });

function renderWeekly() {
  const p = currentProfile();
  const start = startOfWeek(cursorWeek);
  const end = addDays(start, 6);
  $("weekLabel").textContent =
    `${MONTHS[start.getMonth()].slice(0,3)} ${start.getDate()} – ${MONTHS[end.getMonth()].slice(0,3)} ${end.getDate()}`;

  const el = $("weeklyReport");
  if (!p || p.habits.length === 0) {
    el.innerHTML = `<p class="empty-hint">Add habits to see your weekly report.</p>`;
    return;
  }
  const t = tallyRange(p, start, end);
  const streak = longestStreak(p, start, end);
  const tier = rewardTier(t.totalPoints);

  const sorted = [...t.habits].sort((a, b) => b.pct - a.pct);
  const best = sorted[0];
  const weakest = sorted[sorted.length - 1];

  el.innerHTML = `
    <div class="cards">
      ${statCard(t.overallPct + "%", "Completion rate")}
      ${statCard("★ " + t.totalPoints, "Reward points")}
      ${statCard(streak + "d", "Longest streak")}
      ${statCard(t.totalDone, "Habits completed")}
    </div>
    <div class="report-block">
      <h3>Reward level <span class="tag ${tier.tag}">${tier.text}</span></h3>
      <p>You earned <strong>${t.totalPoints}</strong> points this week
      ${best ? `— best habit: <strong>${escapeHtml(best.name)}</strong> (${best.pct}%)` : ""}.</p>
    </div>
    <div class="report-block">
      <h3>Per-habit progress</h3>
      ${barRows(sorted)}
    </div>
    <div class="report-block">
      <h3>Suggestions</h3>
      <ul class="suggestions">${weeklySuggestions(t, best, weakest, streak)}</ul>
    </div>`;
}

function weeklySuggestions(t, best, weakest, streak) {
  const s = [];
  if (t.overallPct >= 85) s.push("Excellent consistency. Consider adding a new habit or raising a weekly goal.");
  else if (t.overallPct >= 50) s.push("Solid week. Pick one habit below 50% and give it priority next week.");
  else s.push("This week was light. Start small — aim to complete just your top 2 habits daily.");

  if (weakest && weakest.pct < 50) {
    s.push(`\"${escapeHtml(weakest.name)}\" is lagging at ${weakest.pct}%. Try scheduling it at a fixed time each day.`);
  }
  if (best && best.pct >= 80) {
    s.push(`Great job on \"${escapeHtml(best.name)}\" — keep the momentum going.`);
  }
  if (streak >= 5) s.push(`You kept a ${streak}-day streak. Protect it — don't break the chain!`);
  return s.map((x) => `<li>${x}</li>`).join("");
}

// ---------- Monthly report ----------
$("prevMonthR").addEventListener("click", () => { shiftReportMonth(-1); renderMonthly(); });
$("nextMonthR").addEventListener("click", () => { shiftReportMonth(1); renderMonthly(); });

function shiftReportMonth(delta) {
  reportMonth += delta;
  if (reportMonth < 0) { reportMonth = 11; reportYear--; }
  if (reportMonth > 11) { reportMonth = 0; reportYear++; }
}

function renderMonthly() {
  const p = currentProfile();
  $("monthReportLabel").textContent = `${MONTHS[reportMonth]} ${reportYear}`;
  const el = $("monthlyReport");
  if (!p || p.habits.length === 0) {
    el.innerHTML = `<p class="empty-hint">Add habits to see your monthly report.</p>`;
    return;
  }
  const start = new Date(reportYear, reportMonth, 1);
  const end = new Date(reportYear, reportMonth, daysInMonth(reportYear, reportMonth));
  const t = tallyRange(p, start, end);
  const streak = longestStreak(p, start, end);
  const tier = rewardTier(t.totalPoints);
  const sorted = [...t.habits].sort((a, b) => b.pct - a.pct);

  // Compare with previous month for trend
  const pmMonth = reportMonth === 0 ? 11 : reportMonth - 1;
  const pmYear = reportMonth === 0 ? reportYear - 1 : reportYear;
  const pmStart = new Date(pmYear, pmMonth, 1);
  const pmEnd = new Date(pmYear, pmMonth, daysInMonth(pmYear, pmMonth));
  const prev = tallyRange(p, pmStart, pmEnd);
  const trend = t.overallPct - prev.overallPct;
  const trendTxt = prev.totalPossible === 0 ? "—"
    : (trend >= 0 ? `▲ +${trend}%` : `▼ ${trend}%`);

  el.innerHTML = `
    <div class="cards">
      ${statCard(t.overallPct + "%", "Monthly completion")}
      ${statCard("★ " + t.totalPoints, "Reward points")}
      ${statCard(trendTxt, "vs last month")}
      ${statCard(streak + "d", "Longest streak")}
    </div>
    <div class="report-block">
      <h3>Reward level <span class="tag ${tier.tag}">${tier.text}</span></h3>
      <p>Across ${MONTHS[reportMonth]}, ${escapeHtml(p.name)} completed
      <strong>${t.totalDone}</strong> habit check-ins and earned
      <strong>${t.totalPoints}</strong> reward points.</p>
    </div>
    <div class="report-block">
      <h3>Habit breakdown</h3>
      ${barRows(sorted)}
    </div>
    <div class="report-block">
      <h3>Suggestions for next month</h3>
      <ul class="suggestions">${monthlySuggestions(t, sorted, trend, prev)}</ul>
    </div>`;
}

function monthlySuggestions(t, sorted, trend, prev) {
  const s = [];
  const best = sorted[0];
  const weak = sorted.filter((h) => h.pct < 50);

  if (t.overallPct >= 80) s.push("Outstanding month overall. Lock in these routines and consider a stretch goal.");
  else if (t.overallPct >= 50) s.push("Good progress. Focus next month on the habits below, one at a time.");
  else s.push("Reset and simplify: choose your 2-3 most important habits and build consistency first.");

  if (prev.totalPossible > 0) {
    if (trend > 0) s.push(`You improved by ${trend}% versus last month — nice upward trend.`);
    else if (trend < 0) s.push(`Completion dropped ${Math.abs(trend)}% versus last month. Review what changed.`);
  }
  weak.slice(0, 3).forEach((h) => {
    s.push(`\"${escapeHtml(h.name)}\" needs attention (${h.pct}%). Consider lowering its weekly target or pairing it with an existing routine.`);
  });
  if (best && best.pct >= 90) s.push(`\"${escapeHtml(best.name)}\" is a strong anchor habit — use it to trigger weaker ones.`);
  if (t.totalPoints >= 300) s.push("Reward milestone reached! Celebrate with something meaningful.");
  return s.map((x) => `<li>${x}</li>`).join("");
}

// ---------- Calendar view ----------
$("prevCalMonth").addEventListener("click", () => { shiftCalMonth(-1); renderCalendar(); });
$("nextCalMonth").addEventListener("click", () => { shiftCalMonth(1); renderCalendar(); });
$("calTodayBtn").addEventListener("click", () => {
  calMonth = new Date().getMonth(); calYear = new Date().getFullYear(); renderCalendar();
});

function shiftCalMonth(delta) {
  calMonth += delta;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  if (calMonth > 11) { calMonth = 0; calYear++; }
}

function eventsOn(profile, dateStr) {
  if (!profile || !profile.events) return [];
  return profile.events
    .filter((e) => e.date === dateStr)
    .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
}

function renderCalendar() {
  const p = currentProfile();
  $("calMonthLabel").textContent = `${MONTHS[calMonth]} ${calYear}`;

  const wd = $("calWeekdays");
  wd.innerHTML = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
    .map((d) => `<span>${d}</span>`).join("");

  const grid = $("calGrid");
  grid.innerHTML = "";
  const first = new Date(calYear, calMonth, 1);
  const startOffset = (first.getDay() + 6) % 7; // Mon-based
  const gridStart = addDays(first, -startOffset);
  const todayStr = iso(new Date());

  for (let i = 0; i < 42; i++) {
    const day = addDays(gridStart, i);
    const dateStr = iso(day);
    const inMonth = day.getMonth() === calMonth;
    const cell = document.createElement("div");
    cell.className = "cal-cell" + (inMonth ? "" : " other-month") + (dateStr === todayStr ? " today" : "");
    cell.innerHTML = `<span class="cal-date">${day.getDate()}</span>`;

    const dayEvents = eventsOn(p, dateStr);
    dayEvents.slice(0, 3).forEach((e) => {
      const badge = document.createElement("div");
      badge.className = `cal-event ${e.type}`;
      badge.textContent = `${EVENT_TYPES[e.type] || "📌"} ${e.time ? e.time + " " : ""}${e.title}`;
      cell.appendChild(badge);
    });
    if (dayEvents.length > 3) {
      const more = document.createElement("div");
      more.className = "cal-more";
      more.textContent = `+${dayEvents.length - 3} more`;
      cell.appendChild(more);
    }
    cell.addEventListener("click", () => openEventModal(dateStr));
    grid.appendChild(cell);
  }
}

// ---------- Event modal ----------
$("cancelEvent").addEventListener("click", closeEventModal);
$("saveEvent").addEventListener("click", saveEventFromModal);
$("eventModal").addEventListener("click", (e) => {
  if (e.target.id === "eventModal") closeEventModal();
});

function openEventModal(dateStr) {
  eventModalDate = dateStr;
  const d = new Date(dateStr + "T00:00:00");
  $("eventModalDate").textContent =
    `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  $("eventTitle").value = "";
  $("eventTime").value = "";
  $("eventNote").value = "";
  renderEventDayList();
  $("eventModal").classList.add("open");
  document.body.classList.add("modal-open");
  $("eventTitle").focus();
}

function renderEventDayList() {
  const p = currentProfile();
  const list = $("eventDayList");
  const items = eventsOn(p, eventModalDate);
  if (!items.length) { list.innerHTML = ""; return; }
  list.innerHTML = "";
  items.forEach((e) => {
    const row = document.createElement("div");
    row.className = "event-day-item";
    row.innerHTML = `
      <span>${EVENT_TYPES[e.type] || "📌"}</span>
      <span class="e-text">${escapeHtml(e.title)}${e.note ? " · " + escapeHtml(e.note) : ""}</span>
      ${e.time ? `<span class="e-time">${e.time}</span>` : ""}
      <button class="icon-btn del" title="Delete">✕</button>`;
    row.querySelector(".del").addEventListener("click", () => {
      p.events = p.events.filter((x) => x.id !== e.id);
      save(); renderEventDayList(); renderCalendar(); renderReminder();
    });
    list.appendChild(row);
  });
}

function closeEventModal() {
  $("eventModal").classList.remove("open");
  document.body.classList.remove("modal-open");
  eventModalDate = null;
}

function saveEventFromModal() {
  const p = currentProfile();
  const title = $("eventTitle").value.trim();
  if (!title) { alert("Please enter an event title."); return; }
  p.events.push({
    id: uid(),
    date: eventModalDate,
    type: $("eventType").value,
    title,
    time: $("eventTime").value || "",
    note: $("eventNote").value.trim(),
  });
  save();
  $("eventTitle").value = "";
  $("eventTime").value = "";
  $("eventNote").value = "";
  renderEventDayList();
  renderCalendar();
  renderReminder();
}

// ---------- Today's reminder banner ----------
function renderReminder() {
  const p = currentProfile();
  const banner = $("reminderBanner");
  if (!p || reminderDismissed) { banner.classList.remove("show"); return; }
  const todayStr = iso(new Date());
  const items = eventsOn(p, todayStr);
  if (!items.length) { banner.classList.remove("show"); banner.innerHTML = ""; return; }

  const rows = items.map((e) => `
    <li>${EVENT_TYPES[e.type] || "📌"}
      ${e.time ? `<span class="r-time">${e.time}</span>` : ""}
      ${escapeHtml(e.title)}${e.note ? " · " + escapeHtml(e.note) : ""}</li>`).join("");

  banner.innerHTML = `
    <div class="reminder-card">
      <div class="r-head">
        <h4>🔔 Today (${items.length} event${items.length > 1 ? "s" : ""})</h4>
        <button class="close-x" id="dismissReminder" title="Dismiss">✕</button>
      </div>
      <ul>${rows}</ul>
    </div>`;
  banner.classList.add("show");
  $("dismissReminder").addEventListener("click", () => {
    reminderDismissed = true;
    banner.classList.remove("show");
  });

  // Chime + popup once when the app opens on a day that has events.
  maybeShowReminderPopup(items);
}

// ---------- Beep sound (Web Audio, no file needed) ----------
let audioCtx = null;
let pendingBeep = false;

function getAudioCtx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { audioCtx = null; }
  }
  return audioCtx;
}

// Two short "beep beep" tones.
function playBeep(times = 2) {
  const ctx = getAudioCtx();
  if (!ctx) return false;
  if (ctx.state === "suspended") { ctx.resume(); }
  if (ctx.state !== "running") return false; // blocked until a user tap
  let t = ctx.currentTime + 0.02;
  for (let i = 0; i < times; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.2);
    t += 0.28;
  }
  return true;
}

// Try to beep now; if the browser blocks audio (e.g. iOS before any tap),
// remember it and beep on the user's first tap instead.
function requestBeep() {
  if (!playBeep()) pendingBeep = true;
}

// First user gesture unlocks audio; play any pending beep.
function primeAudio() {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === "suspended") ctx.resume();
  if (pendingBeep) { pendingBeep = false; playBeep(); }
}
["pointerdown", "touchstart", "click", "keydown"].forEach((ev) =>
  window.addEventListener(ev, primeAudio));

// ---------- Reminder popup ----------
let reminderPopupShown = false;
const firedEventIds = new Set();

$("reminderPopupOk").addEventListener("click", closeReminderPopup);
$("reminderPopup").addEventListener("click", (e) => {
  if (e.target.id === "reminderPopup") closeReminderPopup();
});

function showReminderPopup(items, title) {
  $("reminderPopupTitle").textContent = title;
  const list = $("reminderPopupList");
  list.innerHTML = "";
  items.forEach((e) => {
    const row = document.createElement("div");
    row.className = "event-day-item";
    row.innerHTML = `
      <span>${EVENT_TYPES[e.type] || "📌"}</span>
      <span class="e-text">${escapeHtml(e.title)}${e.note ? " · " + escapeHtml(e.note) : ""}</span>
      ${e.time ? `<span class="e-time">${e.time}</span>` : ""}`;
    list.appendChild(row);
  });
  $("reminderPopup").classList.add("open");
  document.body.classList.add("modal-open");
  requestBeep();
}

function closeReminderPopup() {
  $("reminderPopup").classList.remove("open");
  document.body.classList.remove("modal-open");
}

// Shows the "today's events" popup once per app session.
function maybeShowReminderPopup(items) {
  if (reminderPopupShown || !items.length) return;
  reminderPopupShown = true;
  showReminderPopup(items, `🔔 Today's Reminders (${items.length})`);
}

// While the app is open, beep at each event's exact time (HH:MM).
function startEventAlarms() {
  setInterval(() => {
    const p = currentProfile();
    if (!p) return;
    const now = new Date();
    const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    eventsOn(p, iso(now)).forEach((e) => {
      if (e.time && e.time === hhmm && !firedEventIds.has(e.id)) {
        firedEventIds.add(e.id);
        showReminderPopup([e], `⏰ ${escapeHtml(e.title)} — now`);
      }
    });
  }, 20000);
}

// ---------- Utilities & init ----------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderAll() {
  renderProfiles();
  renderReminder();
  if (view === "habits") renderHabits();
  else if (view === "todos") renderTodos();
  else if (view === "calendar") renderCalendar();
  else if (view === "weekly") renderWeekly();
  else if (view === "monthly") renderMonthly();
}

seedIfEmpty();
migrate();
initCloud();      // sets up cloud sync (no-op if not configured)
applyRoleLock();  // apply URL role (?u=shubha/darsh/gauri)
save();           // persist locally; cloud write is suppressed until first sync
renderAll();
startEventAlarms(); // beep at each event's time while the app stays open
