


(() => {
  "use strict";

  const CONFIG = window.LITTLE_PLACE;
  const STORAGE_KEY = "little-place-progress-v1";
  const FLOWER_COUNT = CONFIG.flowerMessages.length + 1;
  const memoryStore = {};
  let storageAvailable = true;
  let audioContext;
  let state;
  let activeTimers = [];
  let starRound = null;
  let catRunning = false;
  let balloonsRunning = false;
  let memoryFlipTimeout = null;
  let moonTaps = 0;
  let keyboardCode = "";

  const $ = selector => document.querySelector(selector);
  const pageContent = $("#page-content");
  const pageNames = ["garden", "letter", "games", "about", "night", "memories"];
  let language = "es";

  function localizedText(value) {
    const text = String(value);
    if (language === "es") {
      const exact = window.LITTLE_PLACE_I18N.es[text];
      if (exact) return exact;
      const flowerReward = text.match(/^(A new flower opened up in your garden\.|A little flower is happy to see you\.) (.+)$/);
      if (flowerReward) return `${localizedText(flowerReward[1])} ${localizedText(flowerReward[2])}`;
      const patterns = [
        [/^Flower (\d+)$/, "Flor $1"],
        [/^(\d+) little seed is growing here ♡$/, "$1 semillita está creciendo aquí ♡"],
        [/^(\d+) little things are growing here ♡$/, "$1 cositas están creciendo aquí ♡"],
        [/^Score: (\d+) · Combo: (\d+) · Best: (\d+)$/, "Puntos: $1 · Racha: $2 · Récord: $3"],
        [/^Moves: (\d+) · Best: (.+)$/, "Intentos: $1 · Récord: $2"],
        [/^Taps: (\d+) · Best: (\d+)$/, "Toques: $1 · Récord: $2"],
        [/^Pops: (\d+) · Best: (\d+)$/, "Globos: $1 · Récord: $2"],
        [/^Best: (\d+)$/, "Récord: $1"],
        [/^You caught (\d+) star! ⭐ (.+)$/, "¡Atrapaste $1 estrella! ⭐ $2"],
        [/^You caught (\d+) (stars|star)! ⭐$/, "¡Atrapaste $1 estrellas! ⭐"],
        [/^A little garden with (\d+) unlocked flowers$/, "Un pequeño jardín con $1 flores descubiertas"],
        [/^Revealed (.+)$/, "Revelada: $1"],
        [/^Matched (.+)$/, "Pareja: $1"],
        [/^You found all the flowers in (\d+) (moves|move) and (\d+) seconds\. A lovely match\.$/, "Encontraste todas las flores en $1 intentos y $3 segundos. ¡Qué buena memoria!"],
        [/^(A new flower opened up in your garden\.|A little flower is happy to see you\.) (.+)$/, "$1 $2"]
      ];
      for (const [pattern, replacement] of patterns) {
        if (pattern.test(text)) return text.replace(pattern, replacement);
      }
      return text;
    }
    for (const [english, spanish] of Object.entries(window.LITTLE_PLACE_I18N.es)) {
      if (spanish === text) return english;
    }
    return text;
  }

  function translateDOM(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const trimmed = node.nodeValue.trim();
      if (!trimmed) continue;
      const translated = localizedText(trimmed);
      if (translated !== trimmed) {
        const leading = node.nodeValue.match(/^\s*/)[0];
        const trailing = node.nodeValue.match(/\s*$/)[0];
        node.nodeValue = `${leading}${translated}${trailing}`;
      }
    }
    root.querySelectorAll?.("[aria-label], [title]").forEach(element => {
      for (const attribute of ["aria-label", "title"]) {
        if (element.hasAttribute(attribute)) element.setAttribute(attribute, localizedText(element.getAttribute(attribute)));
      }
    });
  }

  function currentPage() {
    return document.querySelector(".nav-item.active")?.dataset.page || "garden";
  }

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      storageAvailable = false;
      return memoryStore[key] ?? null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      storageAvailable = false;
      memoryStore[key] = value;
    }
  }

  function makeInitialState() {
    return {
      visitCount: 0,
      lastVisit: "",
      flowersUnlocked: 1,
      flowersDiscovered: [],
      messagesDiscovered: [],
      gamesPlayed: 0,
      highScores: {},
      bonusStar: false,
      letterOpened: false,
      letterSaved: false,
      secretsFound: [],
      heartsDiscovered: [],
      soundEnabled: true,
      soundPreferenceSet: false,
      language: "es",
      lastMessage: "",
      dailyDate: "",
      dailyMessage: "",
      mysteryDate: "",
      mysteryResult: ""
    };
  }

  function loadState() {
    const initial = makeInitialState();
    try {
      const raw = readStorage(STORAGE_KEY);
      if (!raw) return initial;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return initial;
      const merged = { ...initial, ...saved };
      for (const key of ["flowersDiscovered", "messagesDiscovered", "secretsFound", "heartsDiscovered"]) {
        if (!Array.isArray(merged[key])) merged[key] = [];
      }
      if (!merged.highScores || typeof merged.highScores !== "object" || Array.isArray(merged.highScores)) merged.highScores = {};
      if (!Number.isFinite(merged.visitCount)) merged.visitCount = 0;
      if (!Number.isFinite(merged.gamesPlayed)) merged.gamesPlayed = 0;
      if (typeof merged.bonusStar !== "boolean") merged.bonusStar = false;
      if (typeof merged.soundPreferenceSet !== "boolean") merged.soundPreferenceSet = false;
      if (!["es", "en"].includes(merged.language)) merged.language = "es";
      return merged;
    } catch {
      return initial;
    }
  }

  function saveState() {
    writeStorage(STORAGE_KEY, JSON.stringify(state));
  }

  function today() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function dailyMessage() {
    const date = today();
    if (state.dailyDate !== date || !state.dailyMessage) {
      let index = [...date].reduce((total, char) => total + char.charCodeAt(0), 0) % CONFIG.encouragements.length;
      if (CONFIG.encouragements.length > 1 && CONFIG.encouragements[index].text === state.dailyMessage) {
        index = (index + 1) % CONFIG.encouragements.length;
      }
      state.dailyDate = date;
      state.dailyMessage = CONFIG.encouragements[index].text;
      saveState();
    }
    return state.dailyMessage;
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function playTone(kind = "tap") {
    if (!state.soundEnabled) return;
    try {
      const AudioContextClass = window.AudioContext || Reflect.get(window, "webkitAudioContext");
      if (!AudioContextClass) return;
      audioContext ||= new AudioContextClass();
      if (audioContext.state === "suspended") audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const start = audioContext.currentTime;
      const frequencies = { tap: 520, bloom: 670, catch: 780, match: 590, secret: 880 };
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequencies[kind] || 520, start);
      oscillator.frequency.exponentialRampToValueAtTime((frequencies[kind] || 520) * 1.25, start + .11);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(.055, start + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .2);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(start);
      oscillator.stop(start + .21);
    } catch (error) {
      console.warn("Gentle sounds could not be played.", error);
    }
  }

  function updateProgress() {
    const activities = Math.max(0, state.visitCount - 1)
      + state.gamesPlayed
      + state.messagesDiscovered.length
      + (state.letterOpened ? 2 : 0)
      + state.secretsFound.length;
    state.flowersUnlocked = Math.max(
      Math.min(FLOWER_COUNT, Number(state.flowersUnlocked) || 1),
      Math.min(FLOWER_COUNT, 1 + Math.floor(activities / 2))
    );
    saveState();
  }

  function registerGame() {
    state.gamesPlayed += 1;
    updateProgress();
  }

  function updateSoundButton() {
    const button = $("#sound-toggle");
    button.setAttribute("aria-pressed", String(state.soundEnabled));
    button.setAttribute("aria-label", localizedText(state.soundEnabled ? "Turn gentle sounds off" : "Turn gentle sounds on"));
    button.querySelector(".sound-label").textContent = language === "es"
      ? `Sonido: ${state.soundEnabled ? "sí" : "no"}`
      : `Sound ${state.soundEnabled ? "on" : "off"}`;
  }

  function updateLanguageButton() {
    const button = $("#language-toggle");
    button.textContent = language === "es" ? "EN" : "ES";
    button.setAttribute("aria-label", language === "es" ? "Cambiar a inglés" : "Switch to Spanish");
    button.setAttribute("title", language === "es" ? "Switch to English" : "Cambiar a español");
  }

  function setLanguage(nextLanguage) {
    language = nextLanguage;
    state.language = language;
    saveState();
    document.documentElement.lang = language === "es" ? "es-MX" : "en";
    document.title = language === "es" ? "Un rinconcito para ti" : CONFIG.siteTitle;
    const description = document.querySelector('meta[name="description"]');
    description?.setAttribute("content", language === "es"
      ? "Un jardín tranquilo, algunos juegos y un recordatorio de que alguien te apoya."
      : "A quiet little garden, a few games, and a reminder that someone is cheering for you.");
    updateLanguageButton();
    updateSoundButton();
    setPage(currentPage());
    translateDOM(document.body);
  }

  function showMessage(message, options = {}) {
    const dialog = $("#message-dialog");
    $("#dialog-kicker").textContent = localizedText(options.kicker || "a little reminder");
    $("#dialog-title").textContent = localizedText(options.title || "For you");
    $("#dialog-message").textContent = localizedText(message);
    dialog.showModal();
    playTone(options.tone || "bloom");
  }

  function closeMessage() {
    $("#message-dialog").close();
  }

  function chooseEncouragement(category) {
    let choices = CONFIG.encouragements.filter(item => !category || item.category === category);
    if (!choices.length) choices = CONFIG.encouragements;
    const freshChoices = choices.filter(item => item.text !== state.lastMessage);
    if (freshChoices.length) choices = freshChoices;
    const picked = choices[Math.floor(Math.random() * choices.length)];
    state.lastMessage = picked.text;
    saveState();
    return picked;
  }

  function recordDiscovery(listName, value) {
    if (!state[listName].includes(value)) {
      state[listName].push(value);
      updateProgress();
    }
  }

  function unlockedFlowerCount() {
    updateProgress();
    return state.flowersUnlocked;
  }

  function renderGarden() {
    const unlocked = unlockedFlowerCount();
    const flowers = Array.from({ length: FLOWER_COUNT }, (_, index) => {
      const isUnlocked = index < unlocked;
      const isSeed = index === 0;
      const discovered = state.flowersDiscovered.includes(index);
      const label = !isUnlocked ? "Waiting" : isSeed ? "Little seed" : discovered ? "Found" : `Flower ${index}`;
      return `<button class="garden-flower ${isUnlocked ? "" : "locked"} ${isSeed ? "seed" : ""}" type="button"
        data-flower="${index}" data-index="${Math.max(0, index - 1)}"
        aria-label="${language === "es"
          ? (isUnlocked ? `${localizedText(label)}. Toca para leer un mensajito.` : "Una flor esperando florecer")
          : (isUnlocked ? `${label}. Tap for a little message.` : "A flower waiting to bloom")}"
        style="--stem-height:${isSeed ? 76 : 102 + (index % 3) * 24}px;--lean:${index % 2 ? "5deg" : "-4deg"}">
        <span class="bloom" aria-hidden="true"></span><span class="stem" aria-hidden="true"></span>
        <span class="flower-label">${escapeHTML(label)}</span>
      </button>`;
    }).join("");

    pageContent.innerHTML = `
      <div class="section-heading">
        <p class="eyebrow">take a breath, stay a while</p>
        <h2>Your little <em>garden</em></h2>
        <p>A quiet corner for the days that ask a lot of you. Tap a flower when you need a small reminder.</p>
      </div>
      <div class="garden-card" aria-label="${language === "es" ? `Un pequeño jardín con ${unlocked} flores descubiertas` : `A little garden with ${unlocked} unlocked flowers`}">
        <div class="garden-status">A little more lovely every time you visit <strong>✧</strong></div>
        <div class="garden-fireflies" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="flower-bed">${flowers}</div>
      </div>
      <div class="garden-bottom">
        <p class="garden-progress"><strong>${unlocked}</strong> ${language === "es"
          ? (unlocked === 1 ? "semillita está creciendo aquí" : "cositas están creciendo aquí")
          : `little ${unlocked === 1 ? "seed is" : "things are"} growing here`} <span aria-hidden="true">♡</span></p>
        <button type="button" class="subtle-button" data-action="something">${language === "es" ? "✨ Dame una sorpresita" : "✨ Give me something"}</button>
      </div>
      <div class="daily-card"><span class="daily-star" aria-hidden="true">✦</span><div><p class="eyebrow">today's little reminder</p><p>${escapeHTML(dailyMessage())}</p></div></div>
      <div class="home-signoff"><p>Come back whenever you need a little escape.</p><p>I'll keep this little place here for you.</p><p><strong>— ${escapeHTML(CONFIG.senderName)} ❤️</strong></p></div>
    `;
  }

  function renderLetter() {
    const opened = state.letterOpened;
    pageContent.innerHTML = `
      <div class="section-heading"><p class="eyebrow">something from me to you</p><h2>A little <em>letter</em></h2><p>There's something I wanted to tell you...</p></div>
      <div class="letter-wrap">
        ${opened ? "" : `<div class="envelope-card" id="envelope-card">
          <div><div class="envelope" id="envelope" aria-hidden="true"><span class="envelope-seal">♡</span></div>
          <h3>There's something I wanted to tell you...</h3><p>Whenever you're ready.</p>
          <button class="primary-button" type="button" data-action="open-letter">Open letter <span aria-hidden="true">✉</span></button></div>
        </div>`}
        <article class="letter-paper" id="letter-paper" tabindex="-1" ${opened ? "" : "hidden"} aria-label="${language === "es" ? `Una carta de ${escapeHTML(CONFIG.senderName)}` : `A letter from ${escapeHTML(CONFIG.senderName)}`}">
          <h3>Hey you,</h3>
          ${CONFIG.letter.map(paragraph => `<p>${escapeHTML(paragraph)}</p>`).join("")}
          <p class="letter-signature">— ${escapeHTML(CONFIG.senderName)}</p>
        </article>
        ${opened ? `<div class="letter-actions">
          <button class="primary-button" type="button" data-action="save-letter">${state.letterSaved ? "Kept somewhere safe ✓" : "Keep this somewhere safe ♡"}</button>
          <button class="subtle-button" type="button" data-action="read-letter">Read it again</button>
        </div>
        ${state.letterSaved ? `<p class="letter-note">This little letter will always be here whenever you need it.</p>` : ""}` : ""}
      </div>`;
  }

  function renderGameCard(icon, title, description, name, content) {
    return `<article class="game-card" data-game="${name}">
      <div class="game-card-head"><span class="game-icon" aria-hidden="true">${icon}</span><div><h3>${title}</h3><p>${description}</p></div></div>
      <div class="game-panel">${content}</div>
    </article>`;
  }

  function renderGames() {
    clearGameTimers();
    pageContent.innerHTML = `
      <div class="games-intro"><div class="section-heading"><p class="eyebrow">a tiny change of scenery</p><h2>I'm <em>bored</em></h2><p>Pick a little game. No pressure, just play.</p></div>
        <button class="primary-button give-button" type="button" data-action="something">${language === "es" ? "✨ Dame una sorpresita" : "✨ Give me something"}</button></div>
      <div class="game-grid">
        ${renderGameCard("✦", "Catch the stars", "Catch as many as you can in 30 seconds.", "stars", `<div class="game-area" id="stars-area"><p class="game-hint">A few stars are waiting for you.</p></div><div class="game-controls"><button class="game-control-button" type="button" data-game-action="start-stars">Start a little round</button><span class="game-stat" id="stars-stat">Best: ${Number(state.highScores.stars) || 0}</span></div>`)}
        ${renderGameCard("🐈", "Catch the cat", "The cat is feeling a little playful.", "cat", `<div class="game-area" id="cat-area"><p class="game-hint">See if you can catch this little wanderer.</p></div><div class="game-controls"><button class="game-control-button" type="button" data-game-action="start-cat">Start playing</button><span class="game-stat" id="cat-stat">Taps: 0 · Best: ${Number(state.highScores.cat) || 0}</span></div>`)}
        ${renderGameCard("❀", "Flower memory", "Match the pairs. Take your time.", "memory", `<div class="game-area" id="memory-area"><div class="memory-board" id="memory-board" aria-label="Flower memory matching cards"></div></div><div class="game-controls"><button class="game-control-button" type="button" data-game-action="new-memory">Shuffle flowers</button><span class="game-stat" id="memory-stat">Moves: 0 · Best: ${Number(state.highScores.memory) ? `${state.highScores.memory} moves` : "—"}</span></div>`)}
        ${renderGameCard("🎈", "Balloon pop", "Tap the balloons before they float away.", "balloons", `<div class="game-area" id="balloon-area"><p class="game-hint">A few happy balloons might float by.</p></div><div class="game-controls"><button class="game-control-button" type="button" data-game-action="start-balloons">Let them float</button><span class="game-stat" id="balloon-stat">Pops: 0 · Best: ${Number(state.highScores.balloons) || 0}</span></div>`)}
        ${renderGameCard("🎁", "Mystery box", "A small surprise, just because.", "mystery", `<div class="game-area"><div class="box-visual"><button class="mystery-box" id="mystery-box" type="button" aria-label="Open today's little surprise">🎁</button></div></div><div class="game-controls"><button class="game-control-button" type="button" data-game-action="mystery">${state.mysteryDate === today() ? "See today's surprise" : "Open today's little surprise"}</button><span class="game-stat">One little surprise a day</span></div>`)}
      </div>`;
    prepareMemoryGame();
  }

  function renderAbout() {
    pageContent.innerHTML = `
      <div class="section-heading"><p class="eyebrow">in case you forget</p><h2>Things I like <em>about you</em></h2><p>Tap a little heart. Each one has something I wanted you to know.</p></div>
      <div class="like-grid">${CONFIG.likes.map((like, index) => {
        const revealed = state.heartsDiscovered.includes(index);
        return `<button class="like-heart ${revealed ? "revealed" : ""}" type="button" data-heart="${index}" aria-expanded="${revealed}">
          <span><span class="heart-icon" aria-hidden="true">♥</span><span class="like-copy">${revealed ? escapeHTML(like) : "tap to open"}</span></span>
        </button>`;
      }).join("")}</div>
      <div class="daily-card"><span class="daily-star" aria-hidden="true">♡</span><div><p class="eyebrow">just so you know</p><p>You don't need a special reason to be cared about. You can just be you.</p></div></div>`;
  }

  function renderNight() {
    document.body.classList.add("night-mode");
    pageContent.innerHTML = `
      <div class="section-heading"><p class="eyebrow">a softer kind of quiet</p><h2>If you can't <em>sleep</em></h2><p>The world can wait for a little while.</p></div>
      <div class="night-card">
        <button class="moon-button" type="button" data-action="moon" aria-label="Tap the moon for a secret">☾</button>
        <p class="night-copy"><span>Put the world down for a moment.</span><span>You don't have to solve everything tonight.</span><span>Breathe.</span><span>Tomorrow is another day.</span><span>Goodnight.</span></p>
        <button class="subtle-button wish-button" type="button" data-action="wish">Make a wish ⭐</button>
        <p class="night-wish" id="night-wish" aria-live="polite"></p>
        <button class="secret-stamp" type="button" data-action="butterfly" aria-label="A tiny butterfly">🦋</button>
      </div>`;
  }

  function renderMemories() {
    document.body.classList.remove("night-mode");
    pageContent.innerHTML = `
      <div class="section-heading"><p class="eyebrow">little things worth keeping</p><h2>Our Little <em>Timeline</em></h2><p>A few moments I like remembering. These are just little bookmarks in time.</p></div>
      <div class="timeline">${CONFIG.memories.map(memory => `<article class="memory-item">
        <span class="memory-marker" aria-hidden="true">${escapeHTML(memory.flower || "✿")}</span>
        <div class="memory-copy"><p class="eyebrow">${escapeHTML(memory.date)}</p><h3>${escapeHTML(memory.title)}</h3><p>${escapeHTML(memory.text)}</p></div>
      </article>`).join("")}</div>
      <div class="settings-panel"><p>${storageAvailable ? "Your little garden is saved only on this device." : "Local storage is unavailable; progress will last only while this page stays open."}</p><button type="button" class="danger-button" data-action="confirm-reset">Reset my garden</button></div>`;
  }

  function clearGameTimers() {
    activeTimers.forEach(timer => {
      clearTimeout(timer);
      clearInterval(timer);
    });
    activeTimers = [];
    if (starRound) starRound.active = false;
    starRound = null;
    catRunning = false;
    balloonsRunning = false;
  }

  function setPage(page, focus = false) {
    if (!pageNames.includes(page)) page = "garden";
    clearGameTimers();
    if (page !== "night") document.body.classList.remove("night-mode");
    document.querySelectorAll(".nav-item").forEach(button => {
      const active = button.dataset.page === page;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    const renderers = {
      garden: renderGarden, letter: renderLetter, games: renderGames,
      about: renderAbout, night: renderNight, memories: renderMemories
    };
    renderers[page]();
    translateDOM(pageContent);
    if (focus) pageContent.focus({ preventScroll: true });
  }

  function openSecret(message) {
    const overlay = document.createElement("div");
    const previousFocus = document.activeElement;
    const closeOverlay = () => {
      overlay.remove();
      previousFocus?.focus?.();
    };
    overlay.className = "secret-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "A little secret");
    const hearts = Array.from({ length: 24 }, (_, index) =>
      `<span aria-hidden="true" style="--i:${index}">${index % 2 ? "♡" : "♥"}</span>`).join("");
    overlay.innerHTML = `<div class="secret-hearts">${hearts}</div><div class="secret-card"><span class="secret-heart" aria-hidden="true">♡</span><p>${escapeHTML(message)}</p><button class="subtle-button secret-close" type="button">Keep this little secret</button></div>`;
    document.body.append(overlay);
    translateDOM(overlay);
    overlay.querySelector("button").focus();
    overlay.addEventListener("click", event => {
      if (event.target === overlay || event.target.closest(".secret-close")) closeOverlay();
    });
    overlay.addEventListener("keydown", event => {
      if (event.key === "Escape") closeOverlay();
      if (event.key === "Tab") {
        event.preventDefault();
        overlay.querySelector(".secret-close").focus();
      }
    });
    playTone("secret");
  }

  function discoverSecret(key, message) {
    if (state.secretsFound.includes(key)) {
      showMessage(message, { kicker: "a secret you found", title: "Still here for you" });
      return;
    }
    state.secretsFound.push(key);
    updateProgress();
    openSecret(message);
  }

  function giveMeSomething() {
    const options = ["encouragement", "romantic", "game", "flower", "secret", "memory", "funny"];
    const choice = options[Math.floor(Math.random() * options.length)];
    if (choice === "game") {
      setPage("games", true);
      showMessage("A tiny game might be just the change of pace you need. Pick whichever one feels fun.", { kicker: "a tiny detour", title: "Let's play something" });
    } else if (choice === "flower") {
      const unlocked = unlockedFlowerCount();
      const flower = Math.floor(Math.random() * Math.max(1, unlocked - 1)) + (unlocked > 1 ? 1 : 0);
      if (flower === 0) {
        showMessage("A little seed is waiting for you. Give it a tap in your garden and see what grows.", { kicker: "a little flower", title: "Something is growing" });
      } else {
        recordDiscovery("flowersDiscovered", flower);
        recordDiscovery("messagesDiscovered", `flower-${flower}`);
        if (document.querySelector('[data-page="garden"].active')) setPage("garden");
        showMessage(CONFIG.flowerMessages[flower - 1], { kicker: "a flower for you", title: "A little something" });
      }
    } else if (choice === "romantic") {
      const item = CONFIG.romanticMessages[Math.floor(Math.random() * CONFIG.romanticMessages.length)];
      showMessage(item, { kicker: "a random thought", title: "♡" });
    } else if (choice === "secret") {
      const item = CONFIG.secretMessages[0];
      if (!state.secretsFound.includes("gift")) {
        state.secretsFound.push("gift");
        updateProgress();
        openSecret(item);
      } else {
        showMessage(item, { kicker: "a secret", title: "♡" });
      }
    } else if (choice === "memory") {
      const memory = CONFIG.memories[Math.floor(Math.random() * CONFIG.memories.length)];
      showMessage(memory.text, { kicker: memory.date, title: memory.title });
    } else {
      const item = chooseEncouragement(choice === "funny" ? "funny" : null);
      showMessage(item.text, { kicker: choice === "funny" ? "a tiny giggle" : item.category, title: choice === "funny" ? "Official reminder" : "Today's little reminder" });
    }
  }

  function startStars() {
    const area = $("#stars-area");
    if (!area) return;
    clearGameTimers();
    registerGame();
    area.innerHTML = "";
    const stat = $("#stars-stat");
    const control = document.querySelector('[data-game-action="start-stars"]');
    const round = { score: 0, combo: 0, timeLeft: 30, active: true, expiry: null, schedule: null, bonusAvailable: state.bonusStar };
    starRound = round;
    control.textContent = localizedText("Start a little round");
    const countdown = setInterval(() => {
      round.timeLeft -= 1;
      control.textContent = language === "es" ? `Quedan ${round.timeLeft} s` : `${round.timeLeft}s left`;
      if (round.timeLeft <= 0) endRound();
    }, 1000);
    activeTimers.push(countdown);

    function updateStat() {
      stat.textContent = localizedText(`Score: ${round.score} · Combo: ${round.combo} · Best: ${Number(state.highScores.stars) || 0}`);
    }
    function scheduleSpawn(delay) {
      const timer = setTimeout(spawnStar, delay);
      activeTimers.push(timer);
    }
    function spawnStar() {
      if (!round.active || round.timeLeft <= 0 || !area.isConnected) return;
      const star = document.createElement("button");
      star.type = "button";
      star.className = "moving-target star-target";
      star.setAttribute("aria-label", "Catch the star");
      star.textContent = "✦";
      star.style.left = `${8 + Math.random() * 78}%`;
      star.style.top = `${10 + Math.random() * 68}%`;
      area.append(star);
      round.expiry = setTimeout(() => {
        if (star.isConnected) {
          star.remove();
          round.combo = 0;
          updateStat();
          scheduleSpawn(Math.max(420, 950 - round.score * 14));
        }
      }, Math.max(520, 1300 - round.score * 18));
    }
    function endRound() {
      round.active = false;
      clearGameTimers();
      area.querySelector(".moving-target")?.remove();
      control.textContent = localizedText("Play again");
      state.highScores.stars = Math.max(Number(state.highScores.stars) || 0, round.score);
      updateProgress();
      updateStat();
      const reaction = localizedText(round.score >= 25 ? "You're a star catcher!" : round.score >= 12 ? "Look at you go!" : "A lovely little round.");
      area.innerHTML = `<p class="game-hint">${localizedText(`You caught ${round.score} ${round.score === 1 ? "star" : "stars"}! ⭐`)}<br>${reaction}</p>`;
      showMessage(`${language === "es" ? `¡Atrapaste ${round.score} ${round.score === 1 ? "estrella" : "estrellas"}! ⭐` : `You caught ${round.score} stars! ⭐`} ${reaction}`, { kicker: "your little game", title: "Nicely done" });
    }
    round.catchTarget = star => {
      if (!round.active || !area.contains(star)) return;
      star.remove();
      clearTimeout(round.expiry);
      round.score += round.bonusAvailable ? 2 : 1;
      if (round.bonusAvailable) {
        round.bonusAvailable = false;
        state.bonusStar = false;
        saveState();
      }
      round.combo += 1;
      playTone("catch");
      updateStat();
      scheduleSpawn(Math.max(380, 850 - round.score * 12));
    };
    spawnStar();
  }

  let catScore = 0;
  function startCat() {
    const area = $("#cat-area");
    if (!area) return;
    const control = document.querySelector('[data-game-action="start-cat"]');
    if (catRunning) {
      catRunning = false;
      clearGameTimers();
      area.innerHTML = '<p class="game-hint">A little cat nap. Ready for another round?</p>';
      control.textContent = localizedText("Start playing");
      return;
    }
    catRunning = true;
    catScore = 0;
    registerGame();
    control.textContent = language === "es" ? "Dejar de jugar" : "Stop playing";
    area.innerHTML = "";
    const cat = document.createElement("button");
    cat.type = "button";
    cat.className = "moving-target cat-target";
    cat.setAttribute("aria-label", "Catch the cat");
    cat.textContent = "🐈";
    area.append(cat);
    const moveCat = () => {
      if (!catRunning || !cat.isConnected) return;
      const maxX = Math.max(0, area.clientWidth - cat.offsetWidth - 8);
      const maxY = Math.max(0, area.clientHeight - cat.offsetHeight - 8);
      cat.style.left = `${8 + Math.random() * maxX}px`;
      cat.style.top = `${8 + Math.random() * maxY}px`;
    };
    cat.addEventListener("click", event => {
      event.stopPropagation();
      catScore += 1;
      playTone("match");
      const best = Math.max(Number(state.highScores.cat) || 0, catScore);
      $("#cat-stat").textContent = localizedText(`Taps: ${catScore} · Best: ${best}`);
      state.highScores.cat = best;
      updateProgress();
      cat.textContent = catScore % 3 === 0 ? "😸" : "🐈";
      moveCat();
    });
    moveCat();
    const scheduleMove = () => {
      if (!catRunning) return;
      const mover = setTimeout(() => {
        if (!catRunning) return;
        moveCat();
        scheduleMove();
      }, Math.max(440, 1350 - catScore * 38));
      activeTimers.push(mover);
    };
    scheduleMove();
  }

  let memoryCards = [];
  let memoryFlipped = [];
  let memoryMoves = 0;
  let memoryStartedAt = 0;
  let memoryLocked = false;
  function prepareMemoryGame() {
    const board = $("#memory-board");
    if (!board) return;
    clearTimeout(memoryFlipTimeout);
    memoryFlipTimeout = null;
    memoryCards = ["🌸", "🌸", "💛", "💛", "⭐", "⭐", "🦋", "🦋"]
      .map((emoji, id) => ({ emoji, id, pair: Math.floor(id / 2) }))
      .sort(() => Math.random() - .5);
    memoryFlipped = [];
    memoryMoves = 0;
    memoryLocked = false;
    memoryStartedAt = 0;
    board.innerHTML = memoryCards.map((_, index) =>
      `<button class="memory-card" type="button" data-card="${index}" aria-label="Hidden flower memory card">?</button>`).join("");
    updateMemoryStat();
  }
  function updateMemoryStat() {
    const stat = $("#memory-stat");
    if (stat) stat.textContent = `Moves: ${memoryMoves} · Best: ${Number(state.highScores.memory) ? `${state.highScores.memory} moves` : "—"}`;
  }
  function flipMemoryCard(index, button) {
    if (memoryLocked || button.classList.contains("face-up") || button.classList.contains("matched")) return;
    if (!memoryStartedAt) {
      memoryStartedAt = Date.now();
      registerGame();
    }
    const card = memoryCards[index];
    button.classList.add("face-up");
    button.textContent = card.emoji;
    button.setAttribute("aria-label", `Revealed ${card.emoji}`);
    memoryFlipped.push({ card, button });
    if (memoryFlipped.length < 2) return;
    memoryMoves += 1;
    updateMemoryStat();
    const [first, second] = memoryFlipped;
    if (first.card.pair === second.card.pair) {
      first.button.classList.add("matched");
      second.button.classList.add("matched");
      first.button.setAttribute("aria-label", `Matched ${first.card.emoji}`);
      second.button.setAttribute("aria-label", `Matched ${second.card.emoji}`);
      memoryFlipped = [];
      playTone("match");
      if (document.querySelectorAll(".memory-card.matched").length === memoryCards.length) {
        const seconds = Math.max(1, Math.round((Date.now() - memoryStartedAt) / 1000));
        const previous = Number(state.highScores.memory);
        state.highScores.memory = previous ? Math.min(previous, memoryMoves) : memoryMoves;
        updateProgress();
        updateMemoryStat();
        showMessage(`You found all the flowers in ${memoryMoves} ${memoryMoves === 1 ? "move" : "moves"} and ${seconds} seconds. A lovely match.`, { kicker: "flower memory", title: "Every pair found ✿", tone: "match" });
      }
    } else {
      memoryLocked = true;
      memoryFlipTimeout = setTimeout(() => {
        for (const flipped of memoryFlipped) {
          flipped.button.classList.remove("face-up");
          flipped.button.textContent = "?";
          flipped.button.setAttribute("aria-label", "Hidden flower memory card");
        }
        memoryFlipped = [];
        memoryLocked = false;
        memoryFlipTimeout = null;
      }, 750);
      activeTimers.push(memoryFlipTimeout);
    }
  }

  let balloonScore = 0;
  function startBalloons() {
    const area = $("#balloon-area");
    if (!area) return;
    const control = document.querySelector('[data-game-action="start-balloons"]');
    if (balloonsRunning) {
      balloonsRunning = false;
      clearGameTimers();
      area.innerHTML = '<p class="game-hint">The balloons are taking a little rest.</p>';
      control.textContent = localizedText("Let them float");
      return;
    }
    area.innerHTML = "";
    balloonScore = 0;
    balloonsRunning = true;
    registerGame();
    control.textContent = language === "es" ? "Pausar globos" : "Pause balloons";
    const spawn = () => {
      if (!balloonsRunning || !area.isConnected) return;
      const heart = Math.random() < .12;
      const balloon = document.createElement("button");
      balloon.type = "button";
      balloon.className = "moving-target balloon-target";
      balloon.textContent = heart ? "💖" : ["🎈", "🎈", "🎈", "🩵"][Math.floor(Math.random() * 4)];
      balloon.setAttribute("aria-label", heart ? "Special heart balloon, worth five points" : "Pop balloon");
      balloon.style.left = `${6 + Math.random() * 82}%`;
      balloon.style.bottom = "-50px";
      balloon.style.animation = `balloonRise ${3.8 + Math.random() * 1.5}s linear forwards`;
      area.append(balloon);
      const lifetime = setTimeout(() => balloon.remove(), 5200);
      activeTimers.push(lifetime);
      const timer = setTimeout(spawn, 850);
      activeTimers.push(timer);
      balloon.addEventListener("click", () => {
        const points = heart ? 5 : 1;
        balloonScore += points;
        balloon.remove();
        playTone(heart ? "secret" : "catch");
        const best = Math.max(Number(state.highScores.balloons) || 0, balloonScore);
        state.highScores.balloons = best;
        updateProgress();
        $("#balloon-stat").textContent = localizedText(`Pops: ${balloonScore} · Best: ${best}`);
        if (heart) showMessage("Someone is cheering for you ❤️", { kicker: "special heart balloon", title: "For you" });
      }, { once: true });
    };
    spawn();
  }

  function openMysteryBox() {
    const button = $("#mystery-box");
    if (state.mysteryDate !== today() || !state.mysteryResult) {
      const reward = ["encouragement", "romantic", "flower", "secret", "bonus", "funny"][Math.floor(Math.random() * 6)];
      if (reward === "romantic") {
        state.mysteryResult = CONFIG.romanticMessages[Math.floor(Math.random() * CONFIG.romanticMessages.length)];
      } else if (reward === "flower") {
        const flowerCanOpen = state.flowersUnlocked < FLOWER_COUNT;
        state.flowersUnlocked = Math.min(FLOWER_COUNT, state.flowersUnlocked + 1);
        state.mysteryResult = `${flowerCanOpen ? "A new flower opened up in your garden." : "A little flower is happy to see you."} ${CONFIG.flowerMessages[Math.floor(Math.random() * CONFIG.flowerMessages.length)]}`;
      } else if (reward === "secret") {
        state.secretsFound.push(`mystery-${today()}`);
        state.mysteryResult = CONFIG.secretMessages[Math.floor(Math.random() * CONFIG.secretMessages.length)];
      } else if (reward === "bonus") {
        state.bonusStar = true;
        state.mysteryResult = "A little game bonus: your next star round starts with one extra point. ⭐";
      } else {
        state.mysteryResult = chooseEncouragement(reward === "funny" ? "funny" : null).text;
      }
      state.mysteryDate = today();
      registerGame();
    }
    if (button) {
      button.classList.remove("opened");
      void button.offsetWidth;
      button.classList.add("opened");
    }
    saveState();
    window.setTimeout(() => showMessage(state.mysteryResult, { kicker: "your little surprise", title: "Just for today 🎁", tone: "secret" }), 220);
  }

  function handleAction(action, target) {
    switch (action) {
      case "something": giveMeSomething(); break;
      case "open-letter": {
        const envelope = $("#envelope");
        envelope?.classList.add("open");
        playTone("bloom");
        window.setTimeout(() => {
          state.letterOpened = true;
          updateProgress();
          if (document.querySelector('[data-page="letter"].active')) {
            renderLetter();
            $("#letter-paper")?.focus();
          }
        }, 520);
        break;
      }
      case "save-letter":
        state.letterSaved = true;
        saveState();
        renderLetter();
        break;
      case "read-letter":
        $("#letter-paper")?.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      case "wish": {
        const card = $(".night-card");
        const shooting = document.createElement("span");
        shooting.className = "shooting-star";
        shooting.setAttribute("aria-hidden", "true");
        card.append(shooting);
        window.setTimeout(() => shooting.remove(), 1600);
        $("#night-wish").textContent = "I hope tomorrow is a little kinder to you.";
        playTone("secret");
        break;
      }
      case "moon":
        moonTaps += 1;
        target.classList.add("moon-glow");
        if (moonTaps >= 5) {
          moonTaps = 0;
          discoverSecret("moon", CONFIG.secretMessages[1]);
        }
        break;
      case "butterfly":
        target.classList.add("butterfly-fly");
        window.setTimeout(() => discoverSecret("butterfly", CONFIG.secretMessages[2]), 650);
        break;
      case "confirm-reset":
        $("#reset-dialog").showModal();
        break;
    }
  }

  function initialize() {
    state = loadState();
    language = state.language;
    if (!state.soundPreferenceSet) {
      state.soundEnabled = true;
      state.soundPreferenceSet = true;
    }
    state.visitCount += 1;
    state.lastVisit = today();
    updateProgress();
    saveState();
    if (CONFIG.recipientName) {
      $("#welcome-title").innerHTML = language === "es"
        ? `Un rinconcito <em>para ${escapeHTML(CONFIG.recipientName)}</em>`
        : `A Little Place <em>for ${escapeHTML(CONFIG.recipientName)}</em>`;
    }
    document.documentElement.lang = language === "es" ? "es-MX" : "en";
    document.title = language === "es" ? "Un rinconcito para ti" : CONFIG.siteTitle;

    const welcomeBack = $("#welcome-back");
    if (state.visitCount > 1 && state.visitCount % 2 === 0) {
      const welcomes = ["Your garden missed you.", "Look who's back. ♡", "Welcome back to your little place."];
      welcomeBack.textContent = welcomes[Math.floor(Math.random() * welcomes.length)];
      welcomeBack.hidden = false;
    }

    updateLanguageButton();
    updateSoundButton();
    setPage("garden");
    translateDOM(document.body);

    $("#welcome-flower").addEventListener("click", () => {
      const flower = $("#welcome-flower");
      if (flower.classList.contains("open")) return;
      flower.classList.add("open");
      const note = $("#welcome-note");
      note.innerHTML = "Hey you.<span>I made this little place for you. Whenever work gets tiring, whenever you're bored, or whenever you just need a little smile... come here.</span>";
      translateDOM(note);
      window.setTimeout(() => note.classList.add("visible"), 180);
      $("#enter-button").hidden = false;
      playTone("bloom");
    });
    $("#enter-button").addEventListener("click", () => {
      $("#welcome-screen").hidden = true;
      $("#app-shell").hidden = false;
      $("#site-footer").hidden = true;
      setPage("garden", true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    $("#sound-toggle").addEventListener("click", () => {
      state.soundEnabled = !state.soundEnabled;
      state.soundPreferenceSet = true;
      saveState();
      updateSoundButton();
      playTone("tap");
    });
    $("#language-toggle").addEventListener("click", () => {
      setLanguage(language === "es" ? "en" : "es");
    });
    document.querySelector(".wordmark").addEventListener("click", event => {
      event.preventDefault();
      if ($("#app-shell").hidden) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      setPage("garden");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    document.querySelector(".main-nav").addEventListener("click", event => {
      const button = event.target.closest("[data-page]");
      if (button) setPage(button.dataset.page, true);
    });
    pageContent.addEventListener("click", event => {
      const star = event.target.closest("#stars-area .star-target");
      if (star && starRound?.active) {
        starRound.catchTarget(star);
        return;
      }
      if (event.target.closest("#mystery-box")) {
        openMysteryBox();
        return;
      }
      const navTarget = event.target.closest("[data-flower]");
      if (navTarget) {
        const index = Number(navTarget.dataset.flower);
        if (index >= state.flowersUnlocked) {
          showMessage("This little flower will bloom when it feels ready. No rush. Just keep visiting, playing, and being here.", { kicker: "a little patience", title: "Growing in its own time" });
        } else if (index === 0) {
          recordDiscovery("flowersDiscovered", 0);
          state.flowersUnlocked = Math.min(FLOWER_COUNT, Math.max(state.flowersUnlocked, 2));
          updateProgress();
          setPage("garden");
          showMessage("Every lovely garden starts somewhere. This little seed is glad you're here.", { kicker: "the first little seed", title: "Something is growing" });
        } else {
          recordDiscovery("flowersDiscovered", index);
          recordDiscovery("messagesDiscovered", `flower-${index}`);
          setPage("garden");
          showMessage(CONFIG.flowerMessages[(index - 1) % CONFIG.flowerMessages.length], { kicker: `a flower for you · ${state.flowersDiscovered.filter(value => value > 0).length} found`, title: "A little reminder" });
        }
        playTone("bloom");
        if (state.flowersDiscovered.length >= FLOWER_COUNT && !state.secretsFound.includes("all-flowers")) {
          state.secretsFound.push("all-flowers");
          updateProgress();
          window.setTimeout(() => openSecret("You found them all. And look at this little garden now. ❤️"), 650);
        }
        return;
      }
      const heart = event.target.closest("[data-heart]");
      if (heart) {
        const index = Number(heart.dataset.heart);
        recordDiscovery("heartsDiscovered", index);
        heart.classList.add("revealed");
        heart.setAttribute("aria-expanded", "true");
        heart.querySelector(".like-copy").textContent = CONFIG.likes[index];
        playTone("bloom");
        return;
      }
      const action = event.target.closest("[data-action]");
      if (action) {
        handleAction(action.dataset.action, action);
        return;
      }
      const gameAction = event.target.closest("[data-game-action]");
      if (gameAction) {
        switch (gameAction.dataset.gameAction) {
          case "start-stars": startStars(); break;
          case "start-cat": startCat(); break;
          case "new-memory": prepareMemoryGame(); break;
          case "start-balloons": startBalloons(); break;
          case "mystery": openMysteryBox(); break;
        }
        return;
      }
      const memoryCard = event.target.closest("[data-card]");
      if (memoryCard) flipMemoryCard(Number(memoryCard.dataset.card), memoryCard);
    });

    $("#dialog-close").addEventListener("click", closeMessage);
    $("#dialog-done").addEventListener("click", closeMessage);
    $("#message-dialog").addEventListener("click", event => {
      if (event.target === $("#message-dialog")) closeMessage();
    });
    $("#reset-cancel").addEventListener("click", () => $("#reset-dialog").close());
    $("#reset-confirm").addEventListener("click", () => {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { storageAvailable = false; }
      delete memoryStore[STORAGE_KEY];
      state = makeInitialState();
      state.visitCount = 1;
      state.lastVisit = today();
      saveState();
      language = state.language;
      document.documentElement.lang = "es-MX";
      updateLanguageButton();
      updateSoundButton();
      $("#reset-dialog").close();
      setPage("garden");
      translateDOM(document.body);
    });

    window.addEventListener("keydown", event => {
      if (event.target.matches("input, textarea, select, [contenteditable='true']")) return;
      if (window.matchMedia("(max-width: 720px), (pointer: coarse)").matches) return;
      if (event.key.length !== 1 || !/[a-z]/i.test(event.key)) return;
      keyboardCode = (keyboardCode + event.key.toLowerCase()).slice(-7);
      if (keyboardCode === "corazon") {
        keyboardCode = "";
        discoverSecret("corazon", "You have a very good heart. I hope you know how much you deserve all the gentle things.");
      }
    });
    window.addEventListener("resize", () => {
      if (catRunning) {
        const cat = $("#cat-area .cat-target");
        if (cat) {
          const area = $("#cat-area");
          cat.style.left = `${Math.min(parseFloat(cat.style.left) || 0, area.clientWidth - cat.offsetWidth)}px`;
          cat.style.top = `${Math.min(parseFloat(cat.style.top) || 0, area.clientHeight - cat.offsetHeight)}px`;
        }
      }
    });

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("./sw.js").catch(error => console.warn("Offline garden setup was unavailable.", error));
    }

    const storedWelcome = readStorage(`${STORAGE_KEY}-entered`);
    if (storedWelcome === "yes") {
      $("#welcome-note").textContent = localizedText("Your little place is still here whenever you need it.");
    }
    writeStorage(`${STORAGE_KEY}-entered`, "yes");
  }

  initialize();
})();
