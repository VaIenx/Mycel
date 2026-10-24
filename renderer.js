const api = window.mycel;
const state = {
  project: null,
  recentProjects: [],
  page: "home",
  activeChapter: null,
  activeCharacter: null,
  timer: null,
  lastSavedBody: "",
  saveTimer: null,
  preferences: loadPreferences(),
  searchMode: "find",
  searchHitIndex: 0,
  searchHits: [],
  chapterView: localStorage.getItem("mycel-chapter-view") || "grid",
  placeTab: localStorage.getItem("mycel-place-tab") || "list",
  writingMode: ["normal", "blinders", "typewriter"].includes(
    localStorage.getItem("mycel-writing-mode"),
  )
    ? localStorage.getItem("mycel-writing-mode")
    : "normal",
  wikiArticle: null,
  wikiEditing: false,
  wikiDraft: null,
  wikiReturnPage: "home",
  wikiReturnArticle: null,
  wikiCategory: "all",
  wikiSearch: "",
};
const page = document.querySelector("#page");
const dialog = document.querySelector("#dialog");
const searchDialog = document.querySelector("#search-dialog");
const toastEl = document.querySelector("#toast");

function loadPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem("mycel-preferences") || "{}");
    delete saved.theme;
    const size = Math.min(32, Math.max(12, Number(saved.size) || 16));
    const oldSpacing = { compact: 1.45, normal: 1.7, relaxed: 1.95 };
    const lineSpacing = Math.min(
      52,
      Math.max(
        16,
        Number(saved.lineSpacing) ||
          Math.round(size * (oldSpacing[saved.spacing] || 1.7)),
      ),
    );
    delete saved.spacing;
    return {
      ...saved,
      font: saved.font || "sans",
      size: String(size),
      lineSpacing: String(lineSpacing),
    };
  } catch {
    return { font: "sans", size: "16", lineSpacing: "27" };
  }
}

function applyPreferences() {
  const root = document.documentElement;
  root.dataset.font = state.preferences.font;
  root.dataset.theme = "moss";
  root.style.setProperty("--text-size", `${state.preferences.size}px`);
  root.style.setProperty(
    "--reading-line",
    `${state.preferences.lineSpacing}px`,
  );
}

function savePreferences() {
  localStorage.setItem("mycel-preferences", JSON.stringify(state.preferences));
  applyPreferences();
}

function html(strings, ...values) {
  return strings.reduce(
    (output, part, index) =>
      output + part + (index < values.length ? String(values[index]) : ""),
    "",
  );
}

const esc = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const wordCount = (text = "") =>
  (
    String(text)
      .trim()
      .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []
  ).length;
const characterColors = [
  "#d9e8ff",
  "#f8d9df",
  "#f6e8b8",
  "#d8ecd8",
  "#eadcf8",
  "#f5dcc6",
  "#d0eceb",
  "#e8e4c9",
];
const characterColor = (
  character,
  characters = [
    ...(state.project?.characters || []),
    ...(state.project?.places || []),
    ...(state.project?.knowledge || []),
  ],
) => {
  if (/^#[0-9a-f]{6}$/i.test(character.color || "")) return character.color;
  const used = new Set(
    characters
      .filter((item) => item.id !== character.id)
      .map((item) => item.color)
      .filter((color) => /^#[0-9a-f]{6}$/i.test(color || "")),
  );
  const available = characterColors.filter((color) => !used.has(color));
  const index = characters.findIndex((item) => item.id === character.id);
  const previousUncolored = (
    index < 0 ? characters : characters.slice(0, index)
  ).filter((item) => !/^#[0-9a-f]{6}$/i.test(item.color || "")).length;
  if (previousUncolored < available.length) return available[previousUncolored];
  let colorIndex = index < 0 ? characters.length : index;
  let color = generatedCharacterColor(colorIndex);
  while (used.has(color)) color = generatedCharacterColor(++colorIndex);
  return color;
};

function generatedCharacterColor(index) {
  const hue = (index * 137.508) % 360;
  const saturation = 0.42;
  const lightness = 0.86;
  const amplitude = saturation * Math.min(lightness, 1 - lightness);
  const channel = (offset) => {
    const k = (offset + hue / 30) % 12;
    const value =
      lightness - amplitude * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}
const format = (value) => new Intl.NumberFormat("de-DE").format(value || 0);
const excerpt = (text, length = 205) =>
  String(text || "")
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/[#>*_`\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length);
const slug = (text) =>
  String(text || "")
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
const todayKey = () => {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
};
const totalWords = () =>
  state.project?.chapters.reduce((sum, ch) => sum + wordCount(ch.body), 0) || 0;
const currentChapter = () =>
  state.project?.chapters.find((ch) => ch.id === state.activeChapter);

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(state.timer);
  state.timer = setTimeout(() => toastEl.classList.remove("show"), 2300);
}

function setPage(next) {
  if (state.page === "writing" && next !== "writing") void saveCurrentChapter();
  state.page = next;
  document
    .querySelectorAll(".primary-nav [data-page]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.page === next),
    );
  render();
}

function heading(title, actions = "") {
  return html`<div class="page-heading">
    <div>
      <h1>${esc(title)}</h1>
    </div>
    <div class="heading-actions">${actions}</div>
  </div>`;
}

function emptyState(title, detail, buttonText, action) {
  return html`<div class="empty-state">
    <strong>${esc(title)}</strong><span>${esc(detail)}</span>
    <div style="margin-top:17px">
      <button class="button primary" data-action="${action}">
        ${esc(buttonText)}
      </button>
    </div>
  </div>`;
}

function renderWelcome() {
  page.innerHTML = html`<section class="welcome">
    <h1>Deine Geschichte<br />beginnt hier.</h1>
    <p>
      Schreibe Kapitel, entwickle Figuren und behalte deinen Fortschritt im
      Blick.<br />Deine Texte bleiben als Markdown-Dateien auf deinem Rechner.
    </p>
    <div class="heading-actions">
      <button class="button primary" data-action="create-project">
        Neues Projekt</button
      ><button class="button" data-action="open-project">Projekt öffnen</button>
    </div>
    ${state.recentProjects.length
      ? html`<section class="welcome-recent">
          <h2>Zuletzt geöffnet</h2>
          <div class="welcome-project-list">
            ${state.recentProjects
              .slice(0, 4)
              .map(
                (project) =>
                  html`<div class="welcome-project-row">
                    <button
                      class="welcome-project"
                      data-action="open-recent-project"
                      data-root="${esc(project.root)}"
                    >
                      <span class="welcome-project-icon">↗</span>
                      <span class="welcome-project-copy">
                        <strong>${esc(project.name)}</strong>
                        <small>${esc(project.root)}</small>
                      </span>
                      <span class="welcome-project-arrow">›</span>
                    </button>
                    <button
                      class="welcome-project-remove"
                      data-action="remove-recent-project"
                      data-root="${esc(project.root)}"
                      aria-label="${esc(
                        project.name,
                      )} aus Zuletzt geöffnet entfernen"
                      title="Aus der Liste entfernen"
                    >
                      ×
                    </button>
                  </div>`,
              )
              .join("")}
          </div>
        </section>`
      : ""}
  </section>`;
}

function renderSettings() {
  const preference = state.preferences;
  return html`${heading("Einstellungen")}
    <div class="settings-page">
      <section class="settings-section">
        <div class="settings-section-heading">
          <h2>Schrift</h2>
          <p>
            Stelle die Ansicht so ein, dass sie sich beim Schreiben angenehm
            liest.
          </p>
        </div>
        <label class="settings-row"
          ><span
            ><strong>Schriftgröße</strong
            ><small>Passt Navigation, Notizen und Oberfläche an.</small></span
          >
          <div class="preference-px-control">
            <input
              type="range"
              min="12"
              max="32"
              step="1"
              data-preference="size"
              value="${esc(preference.size)}"
              aria-label="Schriftgröße in Pixeln"
            />
            <input
              type="number"
              min="12"
              max="32"
              step="1"
              data-preference="size"
              value="${esc(preference.size)}"
              aria-label="Schriftgröße in Pixeln"
            />
            <span>px</span>
          </div>
        </label>
        <label class="settings-row"
          ><span
            ><strong>Schriftart</strong
            ><small
              >Vier ruhige Schriftbilder für unterschiedliche Vorlieben.</small
            ></span
          >
          <select data-preference="font">
            <option
              value="sans"
              ${preference.font === "sans" ? "selected" : ""}
            >
              Inter
            </option>
            <option
              value="humanist"
              ${preference.font === "humanist" ? "selected" : ""}
            >
              Trebuchet MS
            </option>
            <option
              value="serif"
              ${preference.font === "serif" ? "selected" : ""}
            >
              Georgia
            </option>
            <option
              value="mono"
              ${preference.font === "mono" ? "selected" : ""}
            >
              Courier New
            </option>
          </select>
        </label>
        <label class="settings-row"
          ><span
            ><strong>Zeilenabstand</strong
            ><small
              >Mehr Luft zwischen Textzeilen erleichtert längeres Lesen.</small
            ></span
          >
          <div class="preference-px-control">
            <input
              type="range"
              min="16"
              max="52"
              step="1"
              data-preference="lineSpacing"
              value="${esc(preference.lineSpacing)}"
              aria-label="Zeilenabstand in Pixeln"
            />
            <input
              type="number"
              min="16"
              max="52"
              step="1"
              data-preference="lineSpacing"
              value="${esc(preference.lineSpacing)}"
              aria-label="Zeilenabstand in Pixeln"
            />
            <span>px</span>
          </div>
        </label>
      </section>
      <section class="settings-section settings-preview">
        <span class="settings-preview-label">Vorschau</span>
        <p>
          Deine Geschichte wächst mit jedem Satz. Passe Mycel an deinen
          Schreibfluss an.
        </p>
      </section>
      <div class="settings-reset-row">
        <span>Du kannst alle Änderungen jederzeit zurücksetzen.</span
        ><button class="button" data-action="reset-preferences">
          Zurücksetzen
        </button>
      </div>
    </div>`;
}

function renderHome() {
  const project = state.project;
  const chapters = project.chapters;
  const words = totalWords();
  const today =
    project.history.find((row) => row.date === todayKey())?.words || 0;
  const goalPercent = project.goal
    ? Math.min(100, Math.round((words / project.goal) * 100))
    : 0;
  const latest = [...chapters]
    .sort((a, b) =>
      String(b.updated || "").localeCompare(String(a.updated || "")),
    )
    .slice(0, 4);
  return html`${heading("Willkommen zurück")}
    <div class="overview-grid">
      <section class="panel">
        <div class="daily-big">
          ${format(today)} <span>WÖRTER GESCHRIEBEN</span>
        </div>
        <p class="quiet">
          ${today
            ? "Ein guter Anfang. Geh in deinem Tempo weiter."
            : "Deine Geschichte wartet auf den ersten Satz."}
        </p>
        <div class="progress-bar">
          <i
            style="width:${Math.min(
              100,
              project.goal
                ? (today / Math.max(1, Math.round(project.goal / 30))) * 100
                : 0,
            )}%"
          ></i>
        </div>
        <div class="small-note">
          Tagesfortschritt zum Monatsziel von
          ${format(Math.round(project.goal / 30))} Wörtern
        </div>
      </section>
      <section class="panel">
        <h2 style="font:25px var(--serif);margin:5px 0">
          ${esc(project.name)}
        </h2>
        <div class="manuscript-stats">
          <div><strong>${format(words)}</strong><span>WÖRTER</span></div>
          <div><strong>${chapters.length}</strong><span>KAPITEL</span></div>
          <div><strong>${goalPercent}%</strong><span>ZIEL</span></div>
        </div>
        <div class="progress-bar"><i style="width:${goalPercent}%"></i></div>
        <div class="small-note">Ziel: ${format(project.goal)} Wörter</div>
      </section>
    </div>
    <div class="stat-grid">
      <section class="stat-card">
        <div class="stat-label">Kapitel</div>
        <div class="stat-value">${chapters.length}</div>
        <div class="stat-note">Dein Manuskript wächst.</div>
      </section>
      <section class="stat-card">
        <div class="stat-label">Figuren</div>
        <div class="stat-value">${project.characters.length}</div>
        <div class="stat-note">Menschen und Wesen deiner Geschichte.</div>
      </section>
      <section class="stat-card">
        <div class="stat-label">Noch bis zum Ziel</div>
        <div class="stat-value">
          ${format(Math.max(0, project.goal - words))}
        </div>
        <div class="stat-note">Wörter bis zu deinem Manuskriptziel.</div>
      </section>
    </div>
    <h2 class="section-title">Zuletzt bearbeitet</h2>
    <div class="recent-list">
      ${latest.length
        ? latest
            .map(
              (ch) =>
                html`<button
                  class="recent-row"
                  data-action="write-chapter"
                  data-id="${esc(ch.id)}"
                >
                  <strong>${esc(ch.title || ch.id)}</strong
                  ><small>${format(wordCount(ch.body))} Wörter</small
                  ><span>›</span>
                </button>`,
            )
            .join("")
        : emptyState(
            "Noch kein Kapitel",
            "Lege dein erstes Kapitel an und fang an zu schreiben.",
            "Kapitel erstellen",
            "new-chapter",
          )}
    </div>`;
}

function chapterCard(ch, index) {
  const status = ch.status || "Entwurf";
  const statuses = [
    ...new Set([
      "Entwurf",
      "In Arbeit",
      "Fertig",
      ...(state.project.chapterStatuses || []),
      ...state.project.chapters.map((chapter) => chapter.status),
    ]),
  ].sort();
  const statusIndex = statuses.indexOf(status);
  const statusHue = Math.round(statusIndex * 137.508) % 360;
  return html`<article
    class="chapter-card"
    data-action="write-chapter"
    data-id="${esc(ch.id)}"
    style="--chapter-status-color: hsl(${statusHue} 32% 87%)"
  >
    <button
      class="card-edit"
      data-action="edit-chapter"
      data-id="${esc(ch.id)}"
      aria-label="Kapitel bearbeiten"
    >
      ···</button
    ><span class="chapter-number">${index + 1}</span>
    <h3>${esc(ch.title || ch.id)}</h3>
    <span class="status">${esc(status)}</span>
    <div class="volume-label">${esc(ch.volume || "Band 1")}</div>
    <p class="chapter-excerpt">
      ${esc(
        excerpt(ch.body) || "Noch leer — hier beginnt das nächste Kapitel.",
      )}
    </p>
    <div class="card-foot">
      ${ch.target
        ? `Ziel: ${format(ch.target)} Wörter`
        : "Manuskriptkapitel"}<span
        >Zuletzt bearbeitet ·
        ${ch.updated
          ? new Date(ch.updated).toLocaleDateString("de-DE")
          : "Gerade eben"}
        · ${format(wordCount(ch.body))} Wörter</span
      >
    </div>
  </article>`;
}

function renderChapters() {
  const chapters = state.project.chapters;
  const cards = chapters.length
    ? chapters.map(chapterCard).join("")
    : emptyState(
        "Dein erstes Kapitel wartet",
        "Füge ein Kapitel hinzu oder öffne den Schreibbereich.",
        "Kapitel hinzufügen",
        "new-chapter",
      );
  return html`${heading(
      "Kapitel",
      html`<button class="button primary" data-action="new-chapter">
        ＋ Kapitel
      </button>`,
    )}
    <div class="collection-summary">
      ${chapters.length} Kapitel · ${format(totalWords())} Wörter insgesamt
    </div>
    <div class="filterbar">
      <select class="select-like" id="volume-filter">
        <option value="all">Band: Alle Bände</option>
        ${[...new Set(chapters.map((ch) => ch.volume || "Band 1"))]
          .sort((a, b) => a.localeCompare(b, "de", { numeric: true }))
          .map((v) => html`<option>${esc(v)}</option>`)
          .join("")}</select
      ><input
        id="chapter-search"
        class="search"
        placeholder="Kapitel suchen …"
      />
      <div class="view-toggle" aria-label="Kapitelansicht">
        <button
          type="button"
          data-chapter-view="grid"
          class="${state.chapterView === "grid" ? "active" : ""}"
          aria-label="Kachelansicht"
          title="Kachelansicht"
        >
          ▦</button
        ><button
          type="button"
          data-chapter-view="list"
          class="${state.chapterView === "list" ? "active" : ""}"
          aria-label="Listenansicht"
          title="Listenansicht"
        >
          ☷
        </button>
      </div>
    </div>
    <div
      id="chapter-grid"
      class="grid chapter-grid ${state.chapterView === "list"
        ? "list-view"
        : ""}"
    >
      ${cards}
    </div>
    ${chapters.length
      ? html`<div class="quiet" data-chapter-no-results hidden>
          Keine passenden Kapitel gefunden.
        </div>`
      : ""}
    <button
      class="fab"
      data-action="new-chapter"
      aria-label="Kapitel hinzufügen"
    >
      ＋
    </button>`;
}

function characterCard(ch) {
  const initials = String(ch.name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  const cover = ch.image
    ? html`<img src="${esc(ch.image)}" alt="" />`
    : html`<span>${esc(initials)}</span>`;
  return html`<article
    class="character-card"
    data-action="open-character"
    data-id="${esc(ch.id)}"
  >
    <div class="character-cover">${cover}</div>
    <div class="character-card-content">
      <span class="role-chip">${esc(ch.role || "Nebenfigur")}</span>
      <h3>${esc(ch.name || ch.id)}</h3>
      <p>
        ${esc(
          excerpt(
            ch.description ||
              ch.traits ||
              (ch.wikiSections || [])
                .map((section) => section.body)
                .join(" ") ||
              "Noch keine Beschreibung.",
            95,
          ),
        )}
      </p>
      <button
        class="button small"
        data-action="open-character"
        data-id="${esc(ch.id)}"
      >
        Profil ansehen
      </button>
    </div>
  </article>`;
}

function renderCharacters() {
  const list = state.project.characters;
  return html`${heading(
      "Charaktere",
      html`<button class="button" data-action="relationship-info">
          ♧ &nbsp; Figuren verknüpfen</button
        ><button class="button primary" data-action="new-character">
          ＋ Figur
        </button>`,
    )}
    <div class="collection-summary">${list.length} Figuren</div>
    <div class="filterbar">
      <select class="select-like" id="role-filter">
        <option value="all">Rolle: Alle</option>
        ${[...new Set(list.map((ch) => ch.role || "Nebenfigur"))]
          .map((v) => html`<option>${esc(v)}</option>`)
          .join("")}</select
      ><input
        class="search"
        id="character-search"
        placeholder="Figur suchen …"
      />
    </div>
    <div class="grid" id="character-grid">
      ${list.length
        ? list.map(characterCard).join("")
        : emptyState(
            "Noch keine Figuren",
            "Erstelle Profile, Aliase und kurze Beschreibungen.",
            "Figur erstellen",
            "new-character",
          )}
    </div>
    <button
      class="fab"
      data-action="new-character"
      aria-label="Figur hinzufügen"
    >
      ＋
    </button>`;
}

function placePath(place) {
  return place.name || "";
}

function placeContinent(place) {
  return place.continent || "";
}

function placeCity(place) {
  return place.city || "";
}

function placeRegion(place) {
  return place.region || "";
}

function placeCard(place) {
  const image = place.image
    ? html`<img src="${esc(place.image)}" alt="" />`
    : html`<span>⌖</span>`;
  return html`<article
    class="place-card"
    data-action="open-place"
    data-id="${esc(place.id)}"
  >
    <div class="place-card-image ${place.image ? "has-image" : ""}">
      ${image}
    </div>
    <div class="place-card-content">
      <div class="place-card-top">
        <span class="role-chip">${esc(place.category || "Ort")}</span>
        <i style="--character-highlight: ${characterColor(place)}"></i>
      </div>
      <h3>${esc(place.name)}</h3>
      <div class="place-path">${esc(placePath(place))}</div>
      <p>
        ${esc(
          excerpt(
            place.description ||
              place.traits ||
              (place.wikiSections || [])
                .map((section) => section.body)
                .join(" ") ||
              "Noch keine Beschreibung.",
            120,
          ),
        )}
      </p>
      <small
        >${esc(
          [placeContinent(place), placeRegion(place), placeCity(place)]
            .filter(Boolean)
            .join(" · ") || "Noch nicht geografisch eingeordnet",
        )}</small
      >
    </div>
  </article>`;
}

function renderPlaces() {
  const places = state.project.places || [];
  const categories = [
    ...new Set(places.map((place) => place.category || "Ort")),
  ];
  const continents = [
    ...new Set(places.map(placeContinent).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
  const regions = [...new Set(places.map(placeRegion).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
  const cities = [...new Set(places.map(placeCity).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );
  const tabs = html`<div
    class="place-tabs"
    role="tablist"
    aria-label="Ortsansicht"
  >
    <button
      type="button"
      role="tab"
      aria-selected="${state.placeTab === "list"}"
      class="${state.placeTab === "list" ? "active" : ""}"
      data-place-tab="list"
    >
      Orte
    </button>
    <button
      type="button"
      role="tab"
      aria-selected="${state.placeTab === "map"}"
      class="${state.placeTab === "map" ? "active" : ""}"
      data-place-tab="map"
    >
      Karte
    </button>
  </div>`;
  const list = html`<div class="place-tools">
      <input class="search" id="place-search" placeholder="Ort suchen …" />
      <select class="select-like" id="place-category-filter">
        <option value="all">Alle Kategorien</option>
        ${categories
          .map((value) => html`<option>${esc(value)}</option>`)
          .join("")}
      </select>
      <select class="select-like" id="place-continent-filter">
        <option value="all">Alle Kontinente</option>
        ${continents
          .map((value) => html`<option>${esc(value)}</option>`)
          .join("")}
      </select>
      <select class="select-like" id="place-city-filter">
        <option value="all">Alle Städte</option>
        ${cities.map((value) => html`<option>${esc(value)}</option>`).join("")}
      </select>
      <select class="select-like" id="place-region-filter">
        <option value="all">Alle Regionen</option>
        ${regions.map((value) => html`<option>${esc(value)}</option>`).join("")}
      </select>
      <select class="select-like" id="place-sort">
        <option value="name">Sortieren: Name</option>
        <option value="category">Kategorie</option>
        <option value="continent">Kontinent</option>
        <option value="city">Stadt</option>
        <option value="region">Region</option>
      </select>
    </div>
    <div class="grid" id="place-grid">
      ${places.length
        ? places.map(placeCard).join("")
        : emptyState(
            "Noch keine Orte",
            "Lege Kontinente, Städte und Schauplätze an.",
            "Ort erstellen",
            "new-place",
          )}
    </div>`;
  const map = renderPlaceMap(places);
  return html`${heading(
    "Orte",
    html`<button class="button primary" data-action="new-place">
      ＋ Ort
    </button>`,
  )}
  ${tabs} ${state.placeTab === "map" ? map : list}`;
}

function renderPlaceMap(places) {
  const map = state.project.placeMap || { image: "", markers: {} };
  const markers = Object.entries(map.markers || {})
    .map(([id, position]) => {
      const place = places.find((item) => item.id === id);
      if (!place) return "";
      return html`<button
        type="button"
        class="world-map-marker"
        data-map-place="${esc(id)}"
        style="left: ${Number(position.x)}%; top: ${Number(
          position.y,
        )}%; --character-highlight: ${characterColor(place)}"
        aria-label="${esc(place.name)}"
      >
        <span>⌖</span>
      </button>`;
    })
    .join("");
  return html`<section class="world-map-panel">
    <div class="world-map-toolbar">
      <p>Klicke auf die Karte, um einen Ort zu markieren.</p>
      ${map.image
        ? html`<button
            type="button"
            class="button small"
            data-action="choose-world-map"
          >
            Karte wechseln
          </button>`
        : ""}
    </div>
    ${map.image
      ? html`<div class="world-map-stage" data-world-map>
          <img
            class="world-map-image"
            src="${esc(map.image)}"
            alt="Weltkarte"
          />
          ${markers}
        </div>`
      : html`<div class="world-map-empty">
          <span>⌖</span>
          <strong>Noch keine Karte ausgewählt</strong>
          <p>Wähle eine Karte aus deinem Medienordner als Grundlage.</p>
          <button
            type="button"
            class="button primary"
            data-action="choose-world-map"
          >
            Karte aus Medien auswählen
          </button>
        </div>`}
  </section>`;
}

function renderMapMediaOptions(media, selected = "") {
  return media.length
    ? media
        .map(
          (item, index) =>
            html`<label class="map-media-option">
              <input
                type="radio"
                name="image"
                value="${esc(item.url)}"
                ${item.url === selected || (!selected && index === 0)
                  ? "checked"
                  : ""}
                required
              />
              <img src="${esc(item.url)}" alt="" />
              <span>${esc(item.name)}</span>
            </label>`,
        )
        .join("")
    : '<p class="quiet">Im Medienordner liegen noch keine Bilder.</p>';
}

async function chooseWorldMap() {
  let media = await api.listMedia();
  openDialog(
    "Weltkarte auswählen",
    html`<p class="quiet">
        Wähle ein vorhandenes Bild oder füge eine Karte zum Medienordner hinzu.
      </p>
      <div class="map-media-grid" data-map-media-list>
        ${renderMapMediaOptions(media, state.project.placeMap?.image)}
      </div>
      <button type="button" class="button small" data-map-upload>
        Bild zum Medienordner hinzufügen …
      </button>`,
    async (data) => {
      const image = data.get("image");
      if (!image) {
        toast("Bitte wähle eine Karte aus.");
        return false;
      }
      state.project = await api.savePlaceMap({
        ...(state.project.placeMap || {}),
        image,
      });
      render();
      toast("Weltkarte gespeichert.");
    },
    "Karte verwenden",
  );
  dialog
    .querySelector("[data-map-upload]")
    .addEventListener("click", async () => {
      const image = await api.choosePlaceImage();
      if (!image) return;
      media = await api.listMedia();
      dialog.querySelector("[data-map-media-list]").innerHTML =
        renderMapMediaOptions(media, image);
    });
}

function chooseMapPlace(x, y) {
  const places = state.project.places || [];
  if (!places.length) {
    toast("Lege zuerst einen Ort an, den du auf der Karte markieren kannst.");
    return;
  }
  const options = [...places]
    .sort((a, b) => a.name.localeCompare(b.name, "de"))
    .map(
      (place) =>
        html`<option value="${esc(place.id)}">
          ${esc(place.name)} · ${esc(place.category || "Ort")}
        </option>`,
    )
    .join("");
  openDialog(
    "Ort auf der Karte markieren",
    html`<label class="field full"
        >Ort<select name="place" required>
          ${options}
        </select></label
      >
      <p class="quiet">
        Ein bereits markierter Ort wird an diese Stelle verschoben.
      </p>`,
    async (data) => {
      const id = data.get("place");
      const current = state.project.placeMap || { image: "", markers: {} };
      state.project = await api.savePlaceMap({
        ...current,
        markers: { ...current.markers, [id]: { x, y } },
      });
      render();
      toast("Ort auf der Karte markiert.");
    },
    "Ort markieren",
  );
}

function knowledgeCard(entry) {
  return html`<article
    class="knowledge-card"
    data-action="open-knowledge"
    data-id="${esc(entry.id)}"
  >
    ${entry.image
      ? html`<img
          class="knowledge-card-image"
          src="${esc(entry.image)}"
          alt=""
        />`
      : ""}
    <div class="knowledge-card-top">
      <span class="role-chip">${esc(entry.category || "Allgemein")}</span>
      <i style="--character-highlight: ${characterColor(entry)}"></i>
    </div>
    <h3>${esc(entry.name)}</h3>
    ${(entry.aliases || []).length
      ? html`<small class="knowledge-aliases"
          >${esc(entry.aliases.join(" · "))}</small
        >`
      : ""}
    <p>
      ${esc(
        entry.description ||
          entry.traits ||
          (entry.wikiSections || []).map((section) => section.body).join(" ") ||
          "Noch keine Beschreibung.",
      )}
    </p>
    ${entry.relationships?.length
      ? html`<small class="knowledge-relations"
          >${entry.relationships.length} Verknüpfungen</small
        >`
      : ""}
  </article>`;
}

function renderKnowledge() {
  const entries = state.project.knowledge || [];
  const categories = [...new Set(entries.map((entry) => entry.category))].sort(
    (a, b) => a.localeCompare(b, "de", { sensitivity: "base" }),
  );
  return html`${heading(
      "Wissen",
      html`<button class="button primary" data-action="new-knowledge">
        ＋ Eintrag
      </button>`,
    )}
    <div class="knowledge-tools">
      <input
        class="search"
        id="knowledge-search"
        placeholder="Wissen durchsuchen …"
      />
      <select class="select-like" id="knowledge-category-filter">
        <option value="all">Alle Kategorien</option>
        ${categories
          .map(
            (category) =>
              html`<option value="${esc(category)}">${esc(category)}</option>`,
          )
          .join("")}
      </select>
      <select class="select-like" id="knowledge-sort">
        <option value="name">Sortieren: Name</option>
        <option value="category">Kategorie</option>
      </select>
      <span class="knowledge-count">${entries.length} Einträge</span>
    </div>
    <div class="grid" id="knowledge-grid">
      ${entries.length
        ? entries.map(knowledgeCard).join("")
        : emptyState(
            "Noch kein Wissen angelegt",
            "Sammle hier alles, wofür es noch keine eigene Rubrik gibt.",
            "Eintrag erstellen",
            "new-knowledge",
          )}
    </div>`;
}

function wikiArticles() {
  if (!state.project) return [];
  const project = state.project;
  const characters = project.characters.map((character) => ({
    key: `character|${character.id}`,
    kind: "character",
    id: character.id,
    title: character.name,
    category: "Figuren",
    aliases: character.aliases || [],
    image: character.image || "",
    facts: [
      ["Rolle", character.role || "Nebenfigur"],
      ["__properties:Eigenschaften", character.traits || ""],
      ["Aliase", (character.aliases || []).join(", ") || "—"],
    ],
    sections: [
      { title: "Beschreibung", body: character.description || "" },
      { title: "Notizen", body: character.notes || "" },
      ...(character.wikiSections || []),
    ],
    related: (character.relationships || [])
      .map((relation) => {
        const target = project.characters.find(
          (item) => item.id === relation.target,
        );
        return target
          ? {
              kind: "character",
              id: target.id,
              title: target.name,
              label: `${relation.bidirectional ? "↔" : "→"} ${relation.type || "Beziehung"}`,
            }
          : null;
      })
      .filter(Boolean),
  }));
  const places = project.places.map((place) => ({
    key: `place|${place.id}`,
    kind: "place",
    id: place.id,
    title: place.name,
    category: "Orte",
    aliases: place.aliases || [],
    image: place.image || "",
    facts: [
      ["Kategorie", place.category || "Ort"],
      ["Kontinent", place.continent || "—"],
      ["Region", place.region || "—"],
      ["Stadt", place.city || "—"],
      ["Hierarchie", placePath(place) || "—"],
      ["__properties:Notizen", place.traits || ""],
      ["Aliase", (place.aliases || []).join(", ") || "—"],
    ],
    sections: [
      { title: "Beschreibung", body: place.description || "" },
      ...(place.wikiSections || []),
    ],
    related: [],
  }));
  const knowledge = project.knowledge.map((entry) => ({
    key: `knowledge|${entry.id}`,
    kind: "knowledge",
    id: entry.id,
    title: entry.name,
    category: "Wissen",
    aliases: entry.aliases || [],
    image: entry.image || "",
    facts: [
      ["Kategorie", entry.category || "Allgemein"],
      ["__properties:Eigenschaften und Notizen", entry.traits || ""],
      ["Aliase", (entry.aliases || []).join(", ") || "—"],
    ],
    sections: [
      { title: "Beschreibung", body: entry.description || "" },
      ...(entry.wikiSections || []),
    ],
    related: (entry.relationships || [])
      .map((relation) => {
        const collection = {
          character: project.characters,
          place: project.places,
          knowledge: project.knowledge,
        }[relation.targetKind];
        const target = collection?.find((item) => item.id === relation.target);
        return target
          ? {
              kind: relation.targetKind,
              id: target.id,
              title: target.name,
              label: relation.type || "Verknüpfung",
            }
          : null;
      })
      .filter(Boolean),
  }));
  return [...characters, ...places, ...knowledge];
}

function wikiInlinePlain(text, article, articles) {
  const entries = new Map();
  for (const target of articles) {
    if (target.key === article.key) continue;
    const names = [target.title, ...(target.aliases || [])];
    for (const name of names) {
      const value = String(name || "").trim();
      if (!value || value.length < 2 || /^\d+$/.test(value)) continue;
      const key = value.toLocaleLowerCase("de-DE");
      if (!entries.has(key)) entries.set(key, { name: value, target });
    }
  }
  const matches = [...entries.values()].sort(
    (left, right) => right.name.length - left.name.length,
  );
  if (!matches.length) return esc(text);
  const byName = new Map(
    matches.map(({ name, target }) => [
      name.toLocaleLowerCase("de-DE"),
      target,
    ]),
  );
  const expression = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${matches
      .map(({ name }) => escapeRegex(name))
      .join("|")})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  let output = "";
  let previous = 0;
  for (const match of text.matchAll(expression)) {
    output += esc(text.slice(previous, match.index));
    const target = byName.get(match[0].toLocaleLowerCase("de-DE"));
    output += `<a class="wiki-inline-link" href="#" data-wiki-open="${esc(
      target.key,
    )}">${esc(match[0])}</a>`;
    previous = match.index + match[0].length;
  }
  return output + esc(text.slice(previous));
}

function wikiInline(text, article, articles) {
  const expression =
    /(\[[^\]]+\]\((?:https?:\/\/|mailto:)[^\s)]+\)|\*\*[^*]+\*\*|__[^_]+__|(?<!\*)\*[^*\n]+\*(?!\*)|(?<!_)_[^_\n]+_(?!_)|`[^`\n]+`)/g;
  let output = "";
  let previous = 0;
  for (const match of text.matchAll(expression)) {
    output += wikiInlinePlain(
      text.slice(previous, match.index),
      article,
      articles,
    );
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) {
      output += `<strong>${wikiInline(
        token.slice(2, -2),
        article,
        articles,
      )}</strong>`;
    } else if (token.startsWith("*") || token.startsWith("_")) {
      output += `<em>${wikiInline(token.slice(1, -1), article, articles)}</em>`;
    } else if (token.startsWith("`")) {
      output += `<code>${esc(token.slice(1, -1))}</code>`;
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const url = link?.[2] || "";
      if (/^(https?:\/\/|mailto:)/i.test(url))
        output += `<a class="wiki-external-link" href="${esc(
          url,
        )}" target="_blank" rel="noopener noreferrer">${wikiInline(
          link[1],
          article,
          articles,
        )}</a>`;
      else output += esc(token);
    }
    previous = match.index + token.length;
  }
  return output + wikiInlinePlain(text.slice(previous), article, articles);
}

function wikiText(text, article, articles) {
  const source = String(text || "").trim();
  if (!source)
    return '<p class="wiki-empty-copy">Noch kein Inhalt vorhanden.</p>';
  return source
    .split(/\r?\n\s*\r?\n+/)
    .map((block) => {
      const value = block.trim();
      if (!value) return "";
      const imagePattern = /!\[([^\]]*)\]\(([^\s)]+)\)/g;
      const images = [...value.matchAll(imagePattern)];
      if (images.length) {
        let previous = 0;
        const content = [];
        for (const image of images) {
          const before = value.slice(previous, image.index).trim();
          if (before)
            content.push(
              `<p>${wikiInline(before.replace(/\r?\n/g, " "), article, articles)}</p>`,
            );
          if (/^(?:file:|https?:)/i.test(image[2]))
            content.push(
              html`<figure class="wiki-inline-image">
                <img src="${esc(image[2])}" alt="${esc(image[1])}" />
                ${image[1]
                  ? html`<figcaption>
                      ${wikiInline(image[1], article, articles)}
                    </figcaption>`
                  : ""}
              </figure>`,
            );
          else
            content.push(`<p>${wikiInline(image[0], article, articles)}</p>`);
          previous = image.index + image[0].length;
        }
        const after = value.slice(previous).trim();
        if (after)
          content.push(
            `<p>${wikiInline(after.replace(/\r?\n/g, " "), article, articles)}</p>`,
          );
        return content.join("");
      }
      if (/^(?:-{3,}|\*\s+\*\s+\*)$/.test(value))
        return '<hr class="wiki-scene-break" />';
      const lines = value.split(/\r?\n/);
      const heading = lines[0].trim().match(/^(#{1,3})\s*(.+)$/);
      if (heading) {
        const level = Math.min(4, heading[1].length + 1);
        const body = lines
          .slice(1)
          .map((line) => line.trim())
          .filter(Boolean)
          .join(" ");
        return `<h${level}>${wikiInline(heading[2], article, articles)}</h${level}>${
          body ? `<p>${wikiInline(body, article, articles)}</p>` : ""
        }`;
      }
      const embeddedHeading = value.match(
        /^([\s\S]*?)\s+(#{1,3})\s*(\S[^\r\n]*)$/,
      );
      if (embeddedHeading) {
        const before = embeddedHeading[1].trim();
        const level = Math.min(4, embeddedHeading[2].length + 1);
        const title = embeddedHeading[3].trim();
        const paragraph = before
          ? `<p>${wikiInline(before, article, articles)}</p>`
          : "";
        return `${paragraph}<h${level}>${wikiInline(
          title,
          article,
          articles,
        )}</h${level}>`;
      }
      if (lines.every((line) => /^\s*[-*]\s+/.test(line)))
        return `<ul>${lines
          .map(
            (line) =>
              `<li>${wikiInline(line.replace(/^\s*[-*]\s+/, ""), article, articles)}</li>`,
          )
          .join("")}</ul>`;
      if (lines.every((line) => /^\s*>\s?/.test(line)))
        return `<blockquote>${wikiInline(
          lines.map((line) => line.replace(/^\s*>\s?/, "")).join(" "),
          article,
          articles,
        )}</blockquote>`;
      return `<p>${wikiInline(lines.join(" "), article, articles)}</p>`;
    })
    .join("");
}

function wikiEntity(kind, id) {
  const collection = {
    character: state.project.characters,
    place: state.project.places,
    knowledge: state.project.knowledge,
  }[kind];
  return collection?.find((entry) => entry.id === id);
}

function openWikiEditor(kind, id) {
  state.wikiReturnPage = state.page;
  state.wikiReturnArticle = state.wikiArticle;
  state.wikiDraft = null;
  state.wikiArticle = `${kind}|${id}`;
  state.wikiEditing = true;
  state.page = "wiki";
  render();
}

function startWikiEntry(kind) {
  state.wikiReturnPage = state.page;
  state.wikiReturnArticle = state.wikiArticle;
  state.wikiDraft = {
    kind,
    entry: {
      id: "",
      name: "",
      role: "Nebenfigur",
      category: kind === "place" ? "Ort" : "Allgemein",
      aliases: [],
      relationships: [],
      wikiSections: [],
      color: characterColor({ id: "__wiki-draft__" }),
      description: "",
      traits: "",
      notes: "",
      image: "",
    },
  };
  state.wikiArticle = `${kind}|draft`;
  state.wikiEditing = true;
  state.page = "wiki";
  render();
}

function wikiEditSection(field, title, body) {
  const editorBody = wikiEditorBodyParts(body);
  return html`<section
    class="wiki-edit-section"
    data-wiki-field-section="${field}"
  >
    <label>${title}</label>
    <div class="wiki-edit-toolbar">
      <button type="button" data-wiki-format="bold">
        <strong>Fett</strong>
      </button>
      <button type="button" data-wiki-format="italic"><em>Kursiv</em></button>
      <button type="button" data-wiki-format="list">Liste</button>
      <button type="button" data-wiki-insert-image>Bild</button>
    </div>
    <textarea
      data-wiki-field="${field}"
      data-wiki-images="${esc(JSON.stringify(editorBody.images))}"
      placeholder="Text schreiben …"
    >
${esc(editorBody.text)}</textarea
    >
    ${wikiEditImagePreviews(editorBody.images)}
  </section>`;
}

function wikiEditorBodyParts(body) {
  const images = [];
  const text = String(body || "").replace(
    /!\[([^\]]*)\]\(([^\s)]+)\)/g,
    (markdown, caption, url) => {
      const marker = `⟦Bild: ${caption || "ohne Bildunterschrift"} · ${images.length + 1}⟧`;
      images.push({ marker, caption, url });
      return marker;
    },
  );
  return { text, images };
}

function wikiEditorBody(textarea) {
  let body = textarea.value;
  const images = JSON.parse(textarea.dataset.wikiImages || "[]");
  for (const image of images) {
    const url = String(image.url).replace(/\(/g, "%28").replace(/\)/g, "%29");
    const markdown = `![${image.caption}](${url})`;
    body = body.replaceAll(image.marker, markdown);
  }
  return body;
}

function wikiEditImagePreviews(images) {
  return images.length
    ? html`<div class="wiki-edit-image-previews">
        ${images.map(
          (image) =>
            html`<figure class="wiki-edit-image-preview">
              <img src="${esc(image.url)}" alt="${esc(image.caption)}" />
              <figcaption>
                ${esc(image.caption || "Ohne Bildunterschrift")}
              </figcaption>
              <button
                type="button"
                class="button subtle"
                data-wiki-remove-inline-image="${esc(image.marker)}"
              >
                Bild entfernen
              </button>
            </figure>`,
        )}
      </div>`
    : "";
}

function addWikiEditorImage(textarea, image, start, end) {
  const images = JSON.parse(textarea.dataset.wikiImages || "[]");
  let number = images.length + 1;
  let marker = `⟦Bild: ${image.caption || "ohne Bildunterschrift"} · ${number}⟧`;
  while (images.some((item) => item.marker === marker)) {
    number += 1;
    marker = `⟦Bild: ${image.caption || "ohne Bildunterschrift"} · ${number}⟧`;
  }
  images.push({ ...image, marker });
  textarea.dataset.wikiImages = JSON.stringify(images);
  textarea.setRangeText(`\n\n${marker}\n\n`, start, end, "end");
  textarea.parentElement.querySelector(".wiki-edit-image-previews")?.remove();
  textarea.insertAdjacentHTML("afterend", wikiEditImagePreviews(images));
  textarea.focus();
}

async function chooseWikiImage(textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  let media = await api.listMedia();
  dialog.className = "dialog";
  openDialog(
    "Bild in den Text einfügen",
    html`<p class="quiet">
        Das Bild wird rechts neben dem Text mit Bildunterschrift angezeigt.
      </p>
      <div class="map-media-grid" data-wiki-media-list>
        ${renderMapMediaOptions(media)}
      </div>
      <label class="field full"
        >Bildunterschrift<input
          name="caption"
          placeholder="Bildunterschrift eingeben …"
        />
      </label>
      <button type="button" class="button small" data-wiki-image-upload>
        Bild zum Medienordner hinzufügen …
      </button>`,
    (data) => {
      const image = data.get("image");
      if (!image) {
        toast("Bitte wähle ein Bild aus dem Medienordner.");
        return false;
      }
      const caption = String(data.get("caption") || "").replace(
        /[\[\]\r\n]/g,
        "",
      );
      addWikiEditorImage(textarea, { caption, url: String(image) }, start, end);
      return true;
    },
    "Einfügen",
  );
  dialog
    .querySelector("[data-wiki-image-upload]")
    .addEventListener("click", async () => {
      const image = await api.choosePlaceImage();
      if (!image) return;
      media = await api.listMedia();
      dialog.querySelector("[data-wiki-media-list]").innerHTML =
        renderMapMediaOptions(media, image);
    });
}

function wikiEditProperty(label, field, value, type = "text") {
  const id = `wiki-property-${field}`;
  return html`<tr>
    <th scope="row"><label for="${id}">${label}</label></th>
    <td>
      <input
        id="${id}"
        data-wiki-field="${field}"
        type="${type}"
        value="${esc(value || "")}"
      />
    </td>
  </tr>`;
}

function wikiEditTextProperty(label, field, value) {
  const properties = parseWikiProperties(value);
  const rows = properties.length ? properties : [{ name: "", value: "" }];
  return html`<tr class="wiki-property-heading">
      <th colspan="2">${label}</th>
    </tr>
    <tr class="wiki-property-editor-row">
      <td colspan="2">
        <div class="wiki-property-editor" data-wiki-properties="${field}">
          ${rows.map(wikiEditPropertyRow).join("")}
        </div>
        <button type="button" class="button" data-wiki-add-property="${field}">
          ＋ Eigenschaft hinzufügen
        </button>
      </td>
    </tr>`;
}

function parseWikiProperties(value) {
  const source = String(value || "").trim();
  if (!source) return [];
  const cleanValue = (propertyValue) =>
    propertyValue.trim().replace(/^[,\s]+|[,\s]+$/g, "");
  const lines = source.split(/\r?\n/);
  const lineProperties = [];
  for (const line of lines) {
    if (/^[,\s]*$/.test(line)) continue;
    const match = line.match(/^\s*([\p{L}][^:\n]{0,31}):\s*(.*)$/u);
    if (match)
      lineProperties.push({
        name: match[1].trim(),
        value: cleanValue(match[2]),
      });
    else if (lineProperties.length)
      lineProperties[lineProperties.length - 1].value += ` ${line.trim()}`;
  }
  if (
    lineProperties.length &&
    (lines.length > 1 || !source.includes(":", source.indexOf(":") + 1))
  )
    return lineProperties;
  const labels = [
    "Symbolpflanze",
    "Kontrollwahn",
    "Eigenschaften",
    "Gewohnheiten",
    "Temperament",
    "Machtkontrolle",
    "Haarfarbe",
    "Augenfarbe",
    "Schwächen",
    "Stärken",
    "Ängste",
    "Größe",
    "Alter",
    "Rolle",
  ];
  const pattern = new RegExp(
    `(?:^|\\s)(${labels.map(escapeRegex).join("|")}):\\s*`,
    "giu",
  );
  const matches = [...source.matchAll(pattern)];
  if (!matches.length) return [{ name: "", value: source }];
  return matches.map((match, index) => ({
    name: match[1].trim(),
    value: cleanValue(
      source.slice(
        match.index + match[0].length,
        matches[index + 1]?.index ?? source.length,
      ),
    ),
  }));
}

function wikiEditPropertyRow(property = {}) {
  return html`<div class="wiki-property-editor-item">
    <input
      data-property-name
      value="${esc(property.name || "")}"
      placeholder="Eigenschaft"
    />
    <span>:</span>
    <input
      data-property-value
      value="${esc(property.value || "")}"
      placeholder="Wert"
    />
    <button
      type="button"
      class="button subtle"
      data-wiki-remove-property
      aria-label="Eigenschaft entfernen"
    >
      ×
    </button>
  </div>`;
}

function wikiCustomSection(section = {}) {
  const editorBody = wikiEditorBodyParts(section.body);
  return html`<section class="wiki-edit-section wiki-edit-custom">
    <div class="wiki-edit-section-heading">
      <input
        data-wiki-custom-title
        value="${esc(section.title || "")}"
        placeholder="Abschnittstitel"
        aria-label="Abschnittstitel"
      />
      <button type="button" class="button subtle" data-wiki-remove-section>
        Abschnitt entfernen
      </button>
    </div>
    <div class="wiki-edit-toolbar">
      <button type="button" data-wiki-format="bold">
        <strong>Fett</strong>
      </button>
      <button type="button" data-wiki-format="italic"><em>Kursiv</em></button>
      <button type="button" data-wiki-format="list">Liste</button>
      <button type="button" data-wiki-insert-image>Bild</button>
    </div>
    <textarea
      data-wiki-custom-body
      data-wiki-images="${esc(JSON.stringify(editorBody.images))}"
      placeholder="Text schreiben …"
    >
${esc(editorBody.text)}</textarea
    >
    ${wikiEditImagePreviews(editorBody.images)}
  </section>`;
}

function wikiRelationEditor(kind, entry) {
  if (kind === "character") {
    const others = state.project.characters.filter(
      (character) => character.id !== entry.id,
    );
    return (entry.relationships || [])
      .map(
        (relation) =>
          html`<div class="wiki-edit-relation" data-wiki-relation>
            <select data-relation-target aria-label="Verknüpfte Figur">
              <option value="">Figur auswählen</option>
              ${others
                .map(
                  (character) =>
                    html`<option
                      value="${esc(character.id)}"
                      ${relation.target === character.id ? "selected" : ""}
                    >
                      ${esc(character.name)}
                    </option>`,
                )
                .join("")}
            </select>
            <input
              data-relation-type
              value="${esc(relation.type || "")}"
              placeholder="Beziehung"
            />
            <label
              ><input
                type="checkbox"
                data-relation-bidirectional
                ${relation.bidirectional ? "checked" : ""}
              />Beidseitig</label
            >
            <button
              type="button"
              class="button subtle"
              data-wiki-remove-relation
            >
              Entfernen
            </button>
          </div>`,
      )
      .join("");
  }
  if (kind === "knowledge")
    return (entry.relationships || [])
      .map(
        (relation) =>
          html`<div class="wiki-edit-relation" data-wiki-relation>
            <select data-relation-target aria-label="Verknüpfter Eintrag">
              <option value="">Eintrag auswählen</option>
              ${knowledgeTargets(entry.id)
                .map(
                  (target) =>
                    html`<option
                      value="${esc(`${target.targetKind}:${target.id}`)}"
                      ${relation.targetKind === target.targetKind &&
                      relation.target === target.id
                        ? "selected"
                        : ""}
                    >
                      ${target.targetKind === "character"
                        ? "Figur"
                        : target.targetKind === "place"
                          ? "Ort"
                          : "Wissen"}
                      · ${esc(target.name)}
                    </option>`,
                )
                .join("")}
            </select>
            <input
              data-relation-type
              value="${esc(relation.type || "")}"
              placeholder="Verknüpfung"
            />
            <button
              type="button"
              class="button subtle"
              data-wiki-remove-relation
            >
              Entfernen
            </button>
          </div>`,
      )
      .join("");
  return "";
}

function wikiEditor(selected) {
  const draft = state.wikiDraft?.entry;
  const entry = draft || wikiEntity(selected.kind, selected.id);
  if (!entry) return "";
  const propertyRows =
    selected.kind === "character"
      ? [
          wikiEditProperty("Rolle", "role", entry.role || "Nebenfigur"),
          wikiEditTextProperty("Eigenschaften", "traits", entry.traits),
        ].join("")
      : selected.kind === "place"
        ? [
            wikiEditProperty("Kategorie", "category", entry.category || "Ort"),
            wikiEditProperty("Kontinent", "continent", entry.continent),
            wikiEditProperty("Region", "region", entry.region),
            wikiEditProperty("Stadt", "city", entry.city),
            wikiEditTextProperty("Notizen", "traits", entry.traits),
          ].join("")
        : [
            wikiEditProperty(
              "Kategorie",
              "category",
              entry.category || "Allgemein",
            ),
            wikiEditTextProperty(
              "Eigenschaften und Notizen",
              "traits",
              entry.traits,
            ),
          ].join("");
  const contentFields =
    selected.kind === "character"
      ? [
          wikiEditSection("description", "Beschreibung", entry.description),
          wikiEditSection("notes", "Notizen", entry.notes),
        ].join("")
      : selected.kind === "place"
        ? [
            wikiEditSection("description", "Beschreibung", entry.description),
          ].join("")
        : [
            wikiEditSection("description", "Beschreibung", entry.description),
          ].join("");
  const relations = wikiRelationEditor(selected.kind, entry);
  const relationPanel =
    selected.kind === "character" || selected.kind === "knowledge"
      ? html`<section class="wiki-edit-panel">
          <h2>
            ${selected.kind === "character" ? "Beziehungen" : "Verknüpfungen"}
          </h2>
          <div class="wiki-edit-relations">${relations}</div>
          <button type="button" class="button" data-wiki-add-relation>
            ＋ ${selected.kind === "character" ? "Beziehung" : "Verknüpfung"}
            hinzufügen
          </button>
        </section>`
      : "";
  return html`<form
    class="wiki-editor"
    id="wiki-editor-form"
    data-kind="${selected.kind}"
    data-id="${esc(entry.id || "")}"
  >
    <header class="wiki-editor-header">
      <div>
        <span class="wiki-eyebrow">${selected.category} · BEARBEITEN</span>
        <input
          class="wiki-edit-title"
          data-wiki-field="name"
          value="${esc(entry.name || selected.title)}"
          aria-label="Name des Eintrags"
          required
        />
      </div>
      <div class="wiki-editor-actions">
        <button type="button" class="button subtle" data-wiki-cancel>
          Abbrechen
        </button>
        <button type="submit" class="button primary">Speichern</button>
      </div>
    </header>
    <div class="wiki-edit-layout">
      <div class="wiki-edit-content">
        <section class="wiki-edit-panel">
          <h2>Inhalt</h2>
          ${contentFields}
          <div class="wiki-edit-custom-list">
            ${(entry.wikiSections || []).map(wikiCustomSection).join("")}
          </div>
          <button type="button" class="button" data-wiki-add-section>
            ＋ Eigenen Abschnitt hinzufügen
          </button>
        </section>
        ${relationPanel}
      </div>
      <aside class="wiki-edit-properties">
        <h2>Eintrag</h2>
        <div class="wiki-edit-image-box">
          <span>Bild</span>
          ${entry.image
            ? html`<img
                class="wiki-edit-image"
                src="${esc(entry.image)}"
                alt=""
              />`
            : html`<span class="small-note">Kein Bild ausgewählt</span>`}
          <input
            data-wiki-field="image"
            type="hidden"
            value="${esc(entry.image || "")}"
          />
          <div class="wiki-edit-image-actions">
            <button type="button" class="button" data-wiki-image>
              Bild aus Medien wählen
            </button>
            ${entry.image
              ? html`<button
                  type="button"
                  class="button subtle"
                  data-wiki-remove-image
                >
                  Entfernen
                </button>`
              : ""}
          </div>
        </div>
        <table class="wiki-edit-table">
          <tbody>
            ${propertyRows}
            ${wikiEditProperty(
              "Aliase",
              "aliases",
              (entry.aliases || []).join(", "),
            )}
            ${wikiEditProperty(
              "Markierungsfarbe",
              "color",
              characterColor(entry),
              "color",
            )}
          </tbody>
        </table>
      </aside>
    </div>
  </form>`;
}

function renderWiki() {
  const articles = wikiArticles();
  const groups = [
    ["character", "Figuren"],
    ["place", "Orte"],
    ["knowledge", "Wissen"],
  ];
  if (
    state.wikiCategory !== "all" &&
    !groups.some(([kind]) => kind === state.wikiCategory)
  ) {
    state.wikiCategory = "all";
  }
  const selected = state.wikiDraft
    ? {
        key: state.wikiArticle,
        kind: state.wikiDraft.kind,
        id: "",
        title: state.wikiDraft.entry.name || "Neuer Eintrag",
        category:
          state.wikiDraft.kind === "character"
            ? "Figuren"
            : state.wikiDraft.kind === "place"
              ? "Orte"
              : "Wissen",
      }
    : articles.find((article) => article.key === state.wikiArticle);
  const sidebar = html`<aside class="wiki-sidebar">
    <div class="wiki-sidebar-title">Enzyklopädie</div>
    <input
      id="wiki-search"
      class="search"
      value="${esc(state.wikiSearch)}"
      placeholder="Einträge suchen …"
      aria-label="Enzyklopädie durchsuchen"
    />
    <nav class="wiki-categories" aria-label="Wiki-Kategorien">
      <button
        data-wiki-category="all"
        class="${state.wikiCategory === "all" ? "active" : ""}"
      >
        Alle
      </button>
      ${groups
        .map(
          ([kind, label]) =>
            html`<button
              data-wiki-category="${kind}"
              class="${state.wikiCategory === kind ? "active" : ""}"
            >
              ${label}
            </button>`,
        )
        .join("")}
    </nav>
    <div class="wiki-index">
      ${groups
        .map(([kind, label]) => {
          const entries = articles.filter((article) => article.kind === kind);
          return entries.length
            ? html`<section data-wiki-group="${kind}">
                <h2>${label}</h2>
                ${entries
                  .map(
                    (article) =>
                      html`<button
                        class="wiki-index-entry ${article.key ===
                        state.wikiArticle
                          ? "active"
                          : ""}"
                        data-wiki-open="${esc(article.key)}"
                        data-wiki-kind="${kind}"
                        data-wiki-title="${esc(
                          `${article.title} ${(article.aliases || []).join(" ")}`.toLocaleLowerCase(
                            "de-DE",
                          ),
                        )}"
                      >
                        ${esc(article.title)}
                      </button>`,
                  )
                  .join("")}
              </section>`
            : "";
        })
        .join("")}
      <p class="wiki-index-empty" hidden>Keine passenden Einträge.</p>
    </div>
  </aside>`;
  if (selected && state.wikiEditing)
    return html`<div class="wiki-layout">
      ${sidebar}${wikiEditor(selected)}
    </div>`;
  if (!selected)
    return html`<div class="wiki-layout">
      ${sidebar}
      <main class="wiki-welcome">
        <span class="wiki-eyebrow">MYCEL · ENZYKLOPÄDIE</span>
        <h1>Wissen, das zusammenwächst</h1>
        <p>
          Durchsuche Figuren, Orte und Wissen. Erkannte Namen und Aliase führen
          direkt zu ihren Einträgen.
        </p>
        <div class="wiki-overview-grid">
          ${groups
            .map(([kind, label]) => {
              const entries = articles.filter(
                (article) => article.kind === kind,
              );
              return html`<section class="wiki-overview-group">
                <h2>${label}</h2>
                <p>${entries.length} Einträge</p>
                <div>
                  ${entries
                    .slice(0, 6)
                    .map(
                      (article) =>
                        html`<button data-wiki-open="${esc(article.key)}">
                          ${esc(article.title)}
                        </button>`,
                    )
                    .join("")}
                </div>
              </section>`;
            })
            .join("")}
        </div>
      </main>
    </div>`;
  const facts = selected.facts
    .map(([label, value]) => {
      if (label.startsWith("__properties:")) {
        const title = label.slice("__properties:".length);
        const properties = parseWikiProperties(value);
        return html`<div class="wiki-infobox-properties">
          <dt>${esc(title)}</dt>
          <dd>
            ${properties.length
              ? html`<table>
                  <tbody>
                    ${properties.map(
                      (property) =>
                        html`<tr>
                          <th>${esc(property.name)}</th>
                          <td>
                            ${wikiText(property.value, selected, articles)}
                          </td>
                        </tr>`,
                    )}
                  </tbody>
                </table>`
              : "—"}
          </dd>
        </div>`;
      }
      return html`<div>
        <dt>${esc(label)}</dt>
        <dd>${wikiText(value, selected, articles)}</dd>
      </div>`;
    })
    .join("");
  const image = selected.image
    ? html`<img src="${esc(selected.image)}" alt="${esc(selected.title)}" />`
    : "";
  const sections = selected.sections
    .filter((section) => section.body.trim())
    .map(
      (section, index) =>
        html`<section class="wiki-section">
          <h2>${esc(section.title)}</h2>
          <div class="wiki-copy">
            ${wikiText(section.body, selected, articles)}
          </div>
        </section>`,
    )
    .join("");
  const related = selected.related.length
    ? html`<section class="wiki-section">
        <h2>Verknüpfungen</h2>
        <div class="wiki-related-list">
          ${selected.related
            .map(
              (relation) =>
                html`<button
                  data-wiki-open="${esc(`${relation.kind}|${relation.id}`)}"
                >
                  <span>${esc(relation.label)}</span>
                  <strong>${esc(relation.title)}</strong>
                </button>`,
            )
            .join("")}
        </div>
      </section>`
    : "";
  return html`<div class="wiki-layout">
    ${sidebar}
    <main class="wiki-article">
      <div class="wiki-article-actions">
        <span>${esc(selected.category)}</span>
        <button
          class="button subtle"
          data-wiki-edit="${selected.kind}|${esc(selected.id)}"
        >
          Bearbeiten
        </button>
      </div>
      <h1>${esc(selected.title)}</h1>
      <div class="wiki-article-columns">
        <div class="wiki-article-body">
          ${sections ||
          '<p class="wiki-empty-copy">Noch kein Inhalt vorhanden.</p>'}
          ${related}
        </div>
        <aside class="wiki-infobox">
          <h2>${esc(selected.title)}</h2>
          ${image}
          <dl>${facts}</dl>
        </aside>
      </div>
    </main>
  </div>`;
}

function applyWikiFilters() {
  const query = state.wikiSearch.trim().toLocaleLowerCase("de-DE");
  const entries = [...page.querySelectorAll(".wiki-index-entry")];
  entries.forEach((entry) => {
    entry.hidden =
      (state.wikiCategory !== "all" &&
        entry.dataset.wikiKind !== state.wikiCategory) ||
      (query && !entry.dataset.wikiTitle.includes(query));
  });
  page.querySelectorAll("[data-wiki-group]").forEach((group) => {
    group.hidden = !group.querySelector(".wiki-index-entry:not([hidden])");
  });
  const empty = page.querySelector(".wiki-index-empty");
  if (empty) empty.hidden = entries.some((entry) => !entry.hidden);
}

function keepTypewriterLineInView(editor) {
  const lineHeight =
    Number.parseFloat(getComputedStyle(editor).lineHeight) || 27;
  editor.scrollTop = Math.max(
    0,
    editor.scrollHeight - editor.clientHeight - lineHeight,
  );
}

function renderWriting() {
  const chapters = state.project.chapters;
  if (!state.activeChapter && chapters.length)
    state.activeChapter = chapters[0].id;
  const chapter = currentChapter();
  if (!chapter)
    return html`${heading("Schreiben")}
      <div class="empty-state">
        <strong>Wähle ein Kapitel</strong
        ><span>Erstelle ein Kapitel, dann kannst du direkt losschreiben.</span>
        <div style="margin-top:17px">
          <button class="button primary" data-action="new-chapter">
            ＋ Kapitel erstellen
          </button>
        </div>
      </div>`;
  const ordered = [...chapters].sort(
    (a, b) => (a.order ?? 9999) - (b.order ?? 9999),
  );
  return html`<div class="editor-layout">
    <aside class="chapter-rail">
      <div class="rail-top">
        <span class="rail-title">Kapitel</span
        ><button class="button small" data-action="new-chapter">＋</button>
      </div>
      <div class="rail-list">
        ${ordered
          .map(
            (ch, i) =>
              html`<button
                class="rail-item ${ch.id === chapter.id ? "active" : ""}"
                data-action="write-chapter"
                data-id="${esc(ch.id)}"
              >
                <span>⠿</span><span>${i + 1}.</span
                ><span>${esc(ch.title || ch.id)}</span
                ><small>${format(wordCount(ch.body))}</small>
              </button>`,
          )
          .join("")}
      </div>
      <div
        class="path-note"
        style="margin-top:auto;padding-top:15px"
        title="${esc(state.project.root)}"
      >
        ${esc(state.project.root)}
      </div>
    </aside>
    <section class="editor-main">
      <div class="editor-crumb">
        ${esc(chapter.volume || "Band 1")} &nbsp;/&nbsp;
        <strong>${esc(chapter.title || chapter.id)}</strong>
      </div>
      <div
        class="editor-tools toolbar"
        data-writing-mode="${state.writingMode}"
      >
        <button data-format="undo" title="Rückgängig">↶</button
        ><button data-format="redo" title="Wiederholen">↷</button
        ><i class="editor-tools-sep"></i><button data-format="heading">H</button
        ><button data-format="bold"><b>B</b></button
        ><button data-format="italic"><i>I</i></button
        ><button data-format="quote">❞</button
        ><button data-format="list">☷</button
        ><button data-format="scene">— ✦ —</button
        ><i class="editor-tools-sep"></i
        ><button data-action="save-now">✓ Gespeichert</button>
        <label class="writing-mode-control" for="writing-mode">
          Schreibmodus
          <select id="writing-mode" class="select-like">
            <option
              value="normal"
              ${state.writingMode === "normal" ? "selected" : ""}
            >
              Normal
            </option>
            <option
              value="blinders"
              ${state.writingMode === "blinders" ? "selected" : ""}
            >
              Scheuklappen
            </option>
            <option
              value="typewriter"
              ${state.writingMode === "typewriter" ? "selected" : ""}
            >
              Schreibmaschine
            </option>
          </select>
        </label>
      </div>
      <div class="editor-wrap" data-writing-mode="${state.writingMode}">
        <div
          id="editor-highlight"
          class="editor-highlight"
          aria-hidden="true"
          data-placeholder="Schreib den ersten Satz deiner Geschichte …"
        ></div>
        <textarea
          id="editor-text"
          class="editor-text"
          spellcheck="${state.writingMode === "typewriter" ? "false" : "true"}"
          placeholder="Schreib den ersten Satz deiner Geschichte …"
        ></textarea>
      </div>
      <div class="editor-status">
        <span id="save-indicator">Alle Änderungen gespeichert</span
        ><span
          ><b id="word-count-live">${format(wordCount(chapter.body))}</b> Wörter
          · ${String((chapter.body || "").length)} Zeichen</span
        >
      </div>
    </section>
  </div>`;
}

function renderProgress() {
  const project = state.project;
  const words = totalWords();
  const average = project.history.length
    ? Math.round(
        project.history.reduce((sum, row) => sum + row.words, 0) /
          project.history.length,
      )
    : 0;
  const history = [...project.history].slice(-14);
  const max = Math.max(1, ...history.map((row) => row.words));
  const bars = history.length
    ? history
        .map(
          (row) =>
            html`<div
              class="chart-bar"
              style="height:${Math.max(5, Math.round((row.words / max) * 82))}%"
              title="${row.date}: ${format(row.words)} Wörter"
            >
              <span
                >${new Date(row.date + "T12:00:00").toLocaleDateString(
                  "de-DE",
                  { day: "2-digit", month: "2-digit" },
                )}</span
              >
            </div>`,
        )
        .join("")
    : '<div class="quiet">Dein Schreibverlauf erscheint hier, sobald du schreibst.</div>';
  return html`${heading(
      "Statistiken",
      html`<label class="goal-form"
        ><span class="small-note">Manuskriptziel</span
        ><input
          id="goal-input"
          type="number"
          min="0"
          step="1000"
          value="${project.goal}"
        /><button class="button small" data-action="save-goal">
          Speichern
        </button></label
      >`,
    )}
    <div class="stat-grid">
      <section class="stat-card">
        <div class="stat-label">Wörter im Manuskript</div>
        <div class="stat-value">${format(words)}</div>
        <div class="stat-note">
          ${project.goal
            ? `${Math.round((words / project.goal) * 100)} % deines Ziels`
            : "Setze ein Manuskriptziel."}
        </div>
      </section>
      <section class="stat-card">
        <div class="stat-label">Kapitel</div>
        <div class="stat-value">${project.chapters.length}</div>
        <div class="stat-note">
          ${format(
            project.chapters.filter((ch) => ch.status === "Fertig").length,
          )}
          abgeschlossen
        </div>
      </section>
      <section class="stat-card">
        <div class="stat-label">Tagesdurchschnitt</div>
        <div class="stat-value">${format(average)}</div>
        <div class="stat-note">Wörter pro erfasstem Schreibtag</div>
      </section>
    </div>
    <section class="panel" style="margin-top:17px;padding:23px">
      <h2 style="font:22px var(--serif);margin:4px 0">Dein Schreibrhythmus</h2>
      <div class="chart">${bars}</div>
    </section>
    <h2 class="section-title">Kapitelumfang</h2>
    <div class="recent-list">
      ${project.chapters
        .map(
          (ch) =>
            html`<div class="recent-row">
              <strong>${esc(ch.title || ch.id)}</strong
              ><small
                >${format(wordCount(ch.body))} Wörter
                ${ch.target ? `· Ziel ${format(ch.target)}` : ""}</small
              ><span>${ch.status === "Fertig" ? "✓" : "·"}</span>
            </div>`,
        )
        .join("") ||
      '<div class="small-note">Noch keine Kapitel vorhanden.</div>'}
    </div>`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function characterMatchData(characters, places, knowledge = []) {
  const matches = new Map();
  [
    ...characters.map((character) => ({ ...character, kind: "character" })),
    ...places.map((place) => ({ ...place, kind: "place" })),
    ...knowledge.map((entry) => ({ ...entry, kind: "knowledge" })),
  ].forEach((entity) => {
    [entity.name, ...(entity.aliases || [])]
      .map((name) => String(name || "").trim())
      .filter(Boolean)
      .forEach((name) => {
        const key = name.toLocaleLowerCase("de-DE");
        if (!matches.has(key)) matches.set(key, { name, entity });
      });
  });
  return [...matches.values()].sort((a, b) => b.name.length - a.name.length);
}

function highlightedText(text, characters, places, knowledge = []) {
  const matches = characterMatchData(characters, places, knowledge);
  if (!matches.length) return esc(text);
  const expression = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${matches
      .map(({ name }) => escapeRegex(name))
      .join("|")})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  const byName = new Map(
    matches.map(({ name, entity }) => [
      name.toLocaleLowerCase("de-DE"),
      entity,
    ]),
  );
  let output = "";
  let previous = 0;
  for (const match of text.matchAll(expression)) {
    output += esc(text.slice(previous, match.index));
    const entity = byName.get(match[0].toLocaleLowerCase("de-DE"));
    output += `<span class="character-mention" data-action="open-${entity.kind}" data-id="${esc(
      entity.id,
    )}" style="--character-highlight: ${characterColor(entity)}">${esc(
      match[0],
    )}</span>`;
    previous = match.index + match[0].length;
  }
  return output + esc(text.slice(previous));
}

function showEntityTooltip(entity, event) {
  const tooltip = document.querySelector("#character-tooltip");
  tooltip.innerHTML = html`<strong>${esc(entity.name)}</strong>
    <span
      >${esc(
        entity.kind === "place"
          ? `Ort · ${entity.category || "Ort"}`
          : entity.kind === "knowledge"
            ? `Wissen · ${entity.category || "Allgemein"}`
            : entity.role || "Figur",
      )}</span
    >
    ${entity.kind === "place"
      ? html`<span
          >${esc(
            [entity.continent, entity.city].filter(Boolean).join(" · ") ||
              placePath(entity),
          )}</span
        >`
      : ""}
    <p>
      ${esc(
        excerpt(
          [entity.description, entity.traits, entity.notes]
            .filter(Boolean)
            .join(" · ") || "Noch keine Beschreibung.",
          120,
        ),
      )}
    </p>`;
  tooltip.hidden = false;
  tooltip.style.left = `${Math.min(event.clientX + 14, innerWidth - 270)}px`;
  tooltip.style.top = `${Math.min(event.clientY + 16, innerHeight - 120)}px`;
}

function applyChapterFilters() {
  const search = page.querySelector("#chapter-search");
  const filter = page.querySelector("#volume-filter");
  const query = (search?.value || "").trim().toLocaleLowerCase("de-DE");
  const volume = filter?.value || "all";
  const cards = [...page.querySelectorAll(".chapter-card")];
  for (const card of cards) {
    const chapter = state.project.chapters.find(
      (item) => item.id === card.dataset.id,
    );
    const searchable = chapter
      ? [
          chapter.title,
          chapter.body,
          chapter.volume || "Band 1",
          chapter.status || "Entwurf",
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("de-DE")
      : "";
    card.hidden =
      !chapter ||
      (query && !searchable.includes(query)) ||
      (volume !== "all" && (chapter.volume || "Band 1") !== volume);
  }
  const empty = page.querySelector("[data-chapter-no-results]");
  if (empty) empty.hidden = cards.some((card) => !card.hidden);
}

function render() {
  document
    .querySelectorAll(".primary-nav [data-page]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.page === state.page),
    );
  document
    .querySelector("#settings-open")
    .classList.toggle("active", state.page === "settings");
  if (!state.project && state.page !== "settings" && state.page !== "wiki")
    return renderWelcome();
  if (state.page === "settings") page.innerHTML = renderSettings();
  else if (state.page === "home") page.innerHTML = renderHome();
  else if (state.page === "wiki") page.innerHTML = renderWiki();
  else if (state.page === "chapters") page.innerHTML = renderChapters();
  else if (state.page === "characters") page.innerHTML = renderCharacters();
  else if (state.page === "places") page.innerHTML = renderPlaces();
  else if (state.page === "knowledge") page.innerHTML = renderKnowledge();
  else if (state.page === "writing") page.innerHTML = renderWriting();
  else if (state.page === "progress") page.innerHTML = renderProgress();
  if (state.page === "chapters") applyChapterFilters();
  if (state.page === "wiki") applyWikiFilters();
  if (state.page === "settings") {
    page.querySelectorAll("[data-preference]").forEach((control) => {
      const updatePreference = () => {
        const name = control.dataset.preference;
        const minimum = Number(control.min);
        const maximum = Number(control.max);
        const rawValue = Number(control.value);
        const value =
          control.type === "range" || control.type === "number"
            ? Number.isFinite(rawValue)
              ? Math.min(maximum, Math.max(minimum, rawValue))
              : Number(state.preferences[name])
            : control.value;
        state.preferences[name] = String(value);
        page
          .querySelectorAll(`[data-preference="${name}"]`)
          .forEach((field) => {
            field.value = String(value);
          });
        savePreferences();
      };
      control.addEventListener(
        control.type === "range" ? "input" : "change",
        updatePreference,
      );
    });
    page
      .querySelector("[data-action=reset-preferences]")
      .addEventListener("click", () => {
        state.preferences = {
          font: "sans",
          size: "16",
          lineSpacing: "27",
        };
        savePreferences();
        render();
        toast("Darstellung zurückgesetzt.");
      });
  }
  if (state.page === "characters") {
    const search = page.querySelector("#character-search");
    const filter = page.querySelector("#role-filter");
    const apply = () =>
      page.querySelectorAll(".character-card").forEach((card) => {
        const ch = state.project.characters.find(
          (item) => item.id === card.dataset.id,
        );
        card.hidden =
          !ch ||
          (!!search.value &&
            !(ch.name + " " + ch.description)
              .toLowerCase()
              .includes(search.value.toLowerCase())) ||
          (filter.value !== "all" &&
            (ch.role || "Nebenfigur") !== filter.value);
      });
    search?.addEventListener("input", apply);
    filter?.addEventListener("change", apply);
  }
  if (state.page === "places" && state.placeTab === "map") {
    const mapStage = page.querySelector("[data-world-map]");
    mapStage?.addEventListener("click", (event) => {
      if (event.target.closest("[data-map-place]")) return;
      const bounds = mapStage.getBoundingClientRect();
      const x = Math.max(
        0,
        Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100),
      );
      const y = Math.max(
        0,
        Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100),
      );
      chooseMapPlace(x, y);
    });
    mapStage?.addEventListener("pointerover", (event) => {
      const marker = event.target.closest("[data-map-place]");
      if (!marker) return;
      const place = state.project.places.find(
        (item) => item.id === marker.dataset.mapPlace,
      );
      if (place) showEntityTooltip({ ...place, kind: "place" }, event);
    });
    mapStage?.addEventListener("pointermove", (event) => {
      if (!event.target.closest("[data-map-place]")) return;
      const tooltip = document.querySelector("#character-tooltip");
      tooltip.style.left = `${Math.min(event.clientX + 14, innerWidth - 270)}px`;
      tooltip.style.top = `${Math.min(event.clientY + 16, innerHeight - 120)}px`;
    });
    mapStage?.addEventListener("pointerout", (event) => {
      if (
        event.target.closest("[data-map-place]") &&
        !event.relatedTarget?.closest?.("[data-map-place]")
      )
        document.querySelector("#character-tooltip").hidden = true;
    });
  }
  if (state.page === "places" && state.placeTab === "list") {
    const search = page.querySelector("#place-search");
    const category = page.querySelector("#place-category-filter");
    const continent = page.querySelector("#place-continent-filter");
    const city = page.querySelector("#place-city-filter");
    const region = page.querySelector("#place-region-filter");
    const sort = page.querySelector("#place-sort");
    const apply = () => {
      const query = search.value.trim().toLocaleLowerCase("de-DE");
      const visible = state.project.places
        .filter((place) => {
          const text = [
            place.name,
            ...(place.aliases || []),
            place.category,
            placeContinent(place),
            placeRegion(place),
            placeCity(place),
            placePath(place),
            place.description,
            place.traits,
          ]
            .join(" ")
            .toLocaleLowerCase("de-DE");
          return (
            (!query || text.includes(query)) &&
            (category.value === "all" ||
              (place.category || "Ort") === category.value) &&
            (continent.value === "all" ||
              placeContinent(place) === continent.value) &&
            (city.value === "all" || placeCity(place) === city.value) &&
            (region.value === "all" || placeRegion(place) === region.value)
          );
        })
        .sort((a, b) => {
          const key = sort.value;
          const value = (place) =>
            key === "category"
              ? place.category
              : key === "continent"
                ? placeContinent(place)
                : key === "city"
                  ? placeCity(place)
                  : key === "region"
                    ? placeRegion(place)
                    : key === "hierarchy"
                      ? placePath(place)
                      : place.name;
          return value(a).localeCompare(value(b), "de", {
            numeric: true,
            sensitivity: "base",
          });
        });
      page.querySelector("#place-grid").innerHTML = visible.length
        ? visible.map(placeCard).join("")
        : '<div class="quiet">Keine passenden Orte.</div>';
    };
    [search, category, continent, city, region].forEach((control) => {
      control.addEventListener("input", apply);
      control.addEventListener("change", apply);
    });
    sort.addEventListener("change", apply);
  }
  if (state.page === "knowledge") {
    const search = page.querySelector("#knowledge-search");
    const category = page.querySelector("#knowledge-category-filter");
    const sort = page.querySelector("#knowledge-sort");
    const apply = () => {
      const query = search.value.trim().toLocaleLowerCase("de-DE");
      const visible = state.project.knowledge
        .filter((entry) => {
          const text = [
            entry.name,
            entry.category,
            ...(entry.aliases || []),
            entry.description,
            entry.traits,
          ]
            .join(" ")
            .toLocaleLowerCase("de-DE");
          return (
            (!query || text.includes(query)) &&
            (category.value === "all" || entry.category === category.value)
          );
        })
        .sort((a, b) => {
          const first = sort.value === "category" ? a.category : a.name;
          const second = sort.value === "category" ? b.category : b.name;
          return first.localeCompare(second, "de", {
            numeric: true,
            sensitivity: "base",
          });
        });
      page.querySelector("#knowledge-grid").innerHTML = visible.length
        ? visible.map(knowledgeCard).join("")
        : '<div class="quiet">Keine passenden Einträge.</div>';
    };
    search.addEventListener("input", apply);
    category.addEventListener("change", apply);
    sort.addEventListener("change", apply);
  }
  const editor = page.querySelector("#editor-text");
  if (editor) {
    editor.value = currentChapter()?.body || "";
    state.lastSavedWords = wordCount(editor.value);
    const highlight = page.querySelector("#editor-highlight");
    const updateHighlights = () => {
      highlight.innerHTML = highlightedText(
        editor.value,
        state.project.characters,
        state.project.places,
        state.project.knowledge,
      );
      highlight.scrollTop = editor.scrollTop;
      highlight.scrollLeft = editor.scrollLeft;
    };
    updateHighlights();
    if (state.writingMode === "typewriter") {
      editor.setSelectionRange(editor.value.length, editor.value.length);
      keepTypewriterLineInView(editor);
    }
    editor.addEventListener("scroll", () => {
      highlight.scrollTop = editor.scrollTop;
      highlight.scrollLeft = editor.scrollLeft;
    });
    const modeSelect = page.querySelector("#writing-mode");
    modeSelect?.addEventListener("change", () => {
      state.writingMode = modeSelect.value;
      localStorage.setItem("mycel-writing-mode", state.writingMode);
      editor.closest(".editor-wrap").dataset.writingMode = state.writingMode;
      modeSelect.closest(".toolbar").dataset.writingMode = state.writingMode;
      editor.spellcheck = state.writingMode !== "typewriter";
      if (state.writingMode === "typewriter") {
        editor.setSelectionRange(editor.value.length, editor.value.length);
        keepTypewriterLineInView(editor);
      }
      updateHighlights();
      editor.focus();
    });
    const isTypewriter = () => state.writingMode === "typewriter";
    const moveCaretToEnd = () => {
      if (!isTypewriter()) return;
      const end = editor.value.length;
      if (editor.selectionStart !== end || editor.selectionEnd !== end)
        editor.setSelectionRange(end, end);
    };
    editor.addEventListener("focus", moveCaretToEnd);
    editor.addEventListener(
      "wheel",
      (event) => {
        if (!isTypewriter()) return;
        event.preventDefault();
        keepTypewriterLineInView(editor);
      },
      { passive: false },
    );
    editor.addEventListener("beforeinput", (event) => {
      if (!isTypewriter()) return;
      const allowed = [
        "insertText",
        "insertLineBreak",
        "insertParagraph",
        "insertCompositionText",
        "insertFromComposition",
      ];
      if (!allowed.includes(event.inputType)) {
        event.preventDefault();
        return;
      }
      moveCaretToEnd();
    });
    editor.addEventListener("keydown", (event) => {
      if (!isTypewriter()) return;
      const blockedKeys = [
        "Backspace",
        "Delete",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "PageUp",
        "PageDown",
      ];
      if (blockedKeys.includes(event.key)) {
        event.preventDefault();
        moveCaretToEnd();
        return;
      }
      const blockedShortcuts = ["x", "v", "z", "y"];
      if (
        (event.ctrlKey || event.metaKey) &&
        blockedShortcuts.includes(event.key.toLowerCase())
      )
        event.preventDefault();
    });
    editor.addEventListener("paste", (event) => {
      if (isTypewriter()) event.preventDefault();
    });
    editor.addEventListener("cut", (event) => {
      if (isTypewriter()) event.preventDefault();
    });
    highlight.addEventListener("pointerover", (event) => {
      const mention = event.target.closest(".character-mention");
      if (!mention) return;
      const entities =
        mention.dataset.action === "open-place"
          ? state.project.places
          : mention.dataset.action === "open-knowledge"
            ? state.project.knowledge
            : state.project.characters;
      const entity = entities.find((item) => item.id === mention.dataset.id);
      if (entity)
        showEntityTooltip(
          {
            ...entity,
            kind: mention.dataset.action.replace("open-", ""),
          },
          event,
        );
    });
    highlight.addEventListener("pointermove", (event) => {
      if (event.target.closest(".character-mention")) {
        const tooltip = document.querySelector("#character-tooltip");
        tooltip.style.left = `${Math.min(event.clientX + 14, innerWidth - 270)}px`;
        tooltip.style.top = `${Math.min(event.clientY + 16, innerHeight - 120)}px`;
      }
    });
    highlight.addEventListener("pointerout", (event) => {
      if (
        event.target.closest(".character-mention") &&
        !event.relatedTarget?.closest?.(".character-mention")
      )
        document.querySelector("#character-tooltip").hidden = true;
    });
    highlight.addEventListener("click", (event) => {
      const mention = event.target.closest(".character-mention");
      if (!mention) return;
      event.preventDefault();
      event.stopPropagation();
      document.querySelector("#character-tooltip").hidden = true;
      state.wikiArticle = `${mention.dataset.action.replace("open-", "")}|${mention.dataset.id}`;
      setPage("wiki");
    });
  }
  editor?.addEventListener("input", () => {
    if (state.writingMode === "typewriter") {
      editor.setSelectionRange(editor.value.length, editor.value.length);
      keepTypewriterLineInView(editor);
    }
    const ch = currentChapter();
    if (!ch) return;
    ch.body = editor.value;
    page.querySelector("#editor-highlight").innerHTML = highlightedText(
      editor.value,
      state.project.characters,
      state.project.places,
      state.project.knowledge,
    );
    const currentWords = wordCount(ch.body);
    page.querySelector("#word-count-live").textContent = format(currentWords);
    page.querySelector(".editor-status").lastElementChild.innerHTML = html`<b
        id="word-count-live"
        >${format(currentWords)}</b
      >
      Wörter · ${format(editor.value.length)} Zeichen`;
    page.querySelector("#save-indicator").textContent =
      "Änderungen werden gespeichert …";
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      void saveCurrentChapter();
    }, 650);
  });
}

async function saveCurrentChapter(newWords = 0) {
  const chapter = currentChapter();
  if (!chapter || !state.project) return;
  const editor = document.querySelector("#editor-text");
  if (editor) chapter.body = editor.value;
  const currentWords = wordCount(chapter.body);
  if (!newWords)
    newWords = Math.max(
      0,
      currentWords - (state.lastSavedWords ?? currentWords),
    );
  const result = await api.saveChapter({
    ...chapter,
    order: state.project.chapters.indexOf(chapter) + 1,
  });
  chapter.id = result.id;
  chapter.file = result.file;
  chapter.updated = new Date().toISOString();
  if (newWords > 0)
    state.project.history = await api.saveSession({ words: newWords });
  state.lastSavedWords = currentWords;
  const status = document.querySelector("#save-indicator");
  if (status) status.textContent = "Alle Änderungen gespeichert";
}

function openDialog(title, inner, onSubmit, submitLabel = "Speichern") {
  dialog.innerHTML = html`<form method="dialog" class="dialog-content">
    <h2>${esc(title)}</h2>
    ${inner}
    <div class="dialog-actions">
      <span></span>
      <div>
        <button type="button" class="button subtle" data-cancel>
          Abbrechen</button
        ><button type="submit" class="button primary">
          ${esc(submitLabel)}
        </button>
      </div>
    </div>
  </form>`;
  dialog.showModal();
  dialog
    .querySelector("[data-cancel]")
    .addEventListener("click", () => dialog.close());
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const accepted = await onSubmit(new FormData(event.currentTarget));
    if (accepted !== false && dialog.open) dialog.close();
  });
  dialog.querySelector("input,textarea,select")?.focus();
}

function editChapterForm(existing = null) {
  const editing = !!existing;
  openDialog(
    editing ? "Kapitel bearbeiten" : "Neues Kapitel",
    html`<div class="form-grid">
      <label class="field full"
        >Kapiteltitel<input
          name="title"
          required
          value="${esc(existing?.title || "")}"
          placeholder="Kapitel" /></label
      ><label class="field"
        >Band<input
          name="volume"
          value="${esc(existing?.volume || "Band 1")}" /></label
      ><label class="field"
        >Status<input
          name="status"
          list="chapter-status-options"
          value="${esc(existing?.status || "Entwurf")}"
        />
        <datalist id="chapter-status-options">
          ${[
            ...new Set([
              "Entwurf",
              "In Arbeit",
              "Fertig",
              ...(state.project.chapterStatuses || []),
              ...state.project.chapters.map((chapter) => chapter.status),
            ]),
          ]
            .map((status) => html`<option value="${esc(status)}"></option>`)
            .join("")}
        </datalist></label
      ><label class="field"
        >Reihenfolge<input
          name="order"
          type="number"
          min="1"
          value="${Number(existing?.order) ||
          state.project.chapters.length + 1}" /></label
      ><label class="field"
        >Wortziel (optional)<input
          name="target"
          type="number"
          min="0"
          value="${Number(existing?.target) || ""}"
          placeholder="3000"
      /></label>
    </div>`,
    async (data) => {
      const title = data.get("title").trim();
      let id = existing?.id || slug(title);
      let suffix = 2;
      while (!existing && state.project.chapters.some((ch) => ch.id === id))
        id = `${slug(title)}-${suffix++}`;
      const chapter = {
        ...(existing || {}),
        id,
        title,
        volume: data.get("volume").trim() || "Band 1",
        status: data.get("status").trim() || "Entwurf",
        target: Number(data.get("target")) || 0,
        body: existing?.body || "",
        order: Number(data.get("order")) || state.project.chapters.length + 1,
      };
      if (!editing) state.project.chapters.push(chapter);
      state.project.chapterStatuses = [
        ...new Set([...(state.project.chapterStatuses || []), chapter.status]),
      ];
      await api.saveSettings({
        goal: state.project.goal,
        chapterStatuses: state.project.chapterStatuses,
      });
      Object.assign(existing || chapter, chapter);
      if (!editing) state.activeChapter = id;
      state.project.chapters.sort(
        (a, b) => (a.order ?? 9999) - (b.order ?? 9999),
      );
      for (let i = 0; i < state.project.chapters.length; i++) {
        state.project.chapters[i].order = i + 1;
        await api.saveChapter(state.project.chapters[i]);
      }
      dialog.close();
      toast(
        editing ? "Kapiteleinstellungen gespeichert." : "Kapitel angelegt.",
      );
      render();
    },
    editing ? "Änderungen speichern" : "Kapitel anlegen",
  );
  if (editing) {
    const actions = dialog.querySelector(".dialog-actions");
    actions.firstElementChild.innerHTML =
      '<button type="button" class="button subtle" data-delete>Kapitel löschen</button>';
    dialog
      .querySelector("[data-delete]")
      .addEventListener("click", async () => {
        if (
          !confirm(
            `Kapitel „${existing.title || existing.id}“ und seine Markdown-Datei löschen?`,
          )
        )
          return;
        await api.deleteChapter(existing.id);
        state.project = await api.currentProject();
        if (state.activeChapter === existing.id)
          state.activeChapter = state.project.chapters[0]?.id || null;
        dialog.close();
        toast("Kapitel gelöscht.");
        render();
      });
  }
}

function createChapter() {
  editChapterForm();
}

function openCharacter(ch) {
  state.activeCharacter = ch.id;
  const initials = String(ch.name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();
  const image = ch.image
    ? html`<img src="${esc(ch.image)}" alt="" />`
    : html`<span>${esc(initials)}</span>`;
  const relationships = (ch.relationships || [])
    .map((rel) => {
      const target = state.project.characters.find(
        (item) => item.id === rel.target,
      );
      return target
        ? html`<div class="relation-chip">
            <strong
              >${rel.bidirectional ? "↔" : "→"} ${esc(target.name)}</strong
            ><span>${esc(rel.type)}</span>
          </div>`
        : "";
    })
    .join("");
  openDialog(
    ch.name,
    html`<div class="character-detail">
      <div class="character-cover">${image}</div>
      <div class="detail-panel">
        <span class="role-chip">${esc(ch.role || "Nebenfigur")}</span>
        <div class="detail-meta">
          <div>
            <small>Auch bekannt als</small>${esc(
              (ch.aliases || []).join(", ") || "—",
            )}
          </div>
          <div>
            <small>Erwähnungen im Manuskript</small
            >${state.project.chapters.reduce(
              (n, c) =>
                n +
                ((ch.name &&
                  c.body.match(new RegExp(escapeRegex(ch.name), "giu"))
                    ?.length) ||
                  0),
              0,
            )}
          </div>
        </div>
        <div class="detail-copy">
          ${wikiEntityText(
            "character",
            ch,
            ch.description || "Noch keine Beschreibung.",
          )}
        </div>
        <h3>Eigenschaften</h3>
        <div class="detail-copy">
          ${wikiEntityText(
            "character",
            ch,
            ch.traits || "Noch keine Eigenschaften.",
          )}
        </div>
        <h3>Notizen</h3>
        <div class="detail-copy">
          ${wikiEntityText("character", ch, ch.notes || "Noch keine Notizen.")}
        </div>
        ${wikiEntitySections("character", ch)}
        <h3>Beziehungen</h3>
        <div class="relation-list">
          ${relationships ||
          '<span class="small-note">Noch keine Beziehungen festgehalten.</span>'}
        </div>
      </div>
    </div>`,
    async () => {
      dialog.close();
      openWikiEditor("character", ch.id);
    },
    "Bearbeiten",
  );
  dialog.classList.add("entity-dialog");
  dialog.querySelector("[data-cancel]").textContent = "Schließen";
  dialog.querySelector(".dialog-actions").firstElementChild.innerHTML =
    '<button type="button" class="button subtle" data-delete>Figur löschen</button>';
  dialog.querySelector("[data-delete]").addEventListener("click", async () => {
    if (
      !confirm(`Figur „${ch.name}“ löschen? Die Markdown-Datei wird entfernt.`)
    )
      return;
    await api.deleteCharacter(ch.id);
    state.project = await api.currentProject();
    dialog.close();
    render();
    toast("Figur gelöscht.");
  });
}

function openPlace(place) {
  openDialog(
    place.name,
    html`<div class="place-detail">
      ${place.image
        ? html`<div class="place-detail-cover">
            <img src="${esc(place.image)}" alt="${esc(place.name)}" />
          </div>`
        : ""}
      <span class="role-chip">${esc(place.category || "Ort")}</span>
      <div class="place-path">${esc(placePath(place))}</div>
      <div class="place-facts">
        <span>Kontinent: ${esc(placeContinent(place) || "—")}</span>
        <span>Region: ${esc(placeRegion(place) || "—")}</span>
        <span>Stadt: ${esc(placeCity(place) || "—")}</span>
        <span>Aliase: ${esc((place.aliases || []).join(", ") || "—")}</span>
      </div>
      <div class="detail-copy">
        ${wikiEntityText(
          "place",
          place,
          place.description || "Noch keine Beschreibung.",
        )}
      </div>
      <h3>Notizen</h3>
      <div class="detail-copy">
        ${wikiEntityText("place", place, place.traits || "Keine Notizen.")}
      </div>
      ${wikiEntitySections("place", place)}
    </div>`,
    async () => {
      dialog.close();
      openWikiEditor("place", place.id);
    },
    "Bearbeiten",
  );
  dialog.classList.add("entity-dialog");
  dialog.querySelector("[data-cancel]").textContent = "Schließen";
  dialog.querySelector(".dialog-actions").firstElementChild.innerHTML =
    '<button type="button" class="button subtle" data-delete>Ort löschen</button>';
  dialog.querySelector("[data-delete]").addEventListener("click", async () => {
    if (!confirm(`Ort „${place.name}“ löschen?`)) return;
    await api.deletePlace(place.id);
    state.project = await api.currentProject();
    dialog.close();
    render();
    toast("Ort gelöscht.");
  });
}

function knowledgeTargets(excludeId = "") {
  return [
    ...state.project.characters.map((item) => ({
      ...item,
      targetKind: "character",
    })),
    ...state.project.places.map((item) => ({ ...item, targetKind: "place" })),
    ...state.project.knowledge
      .filter((item) => item.id !== excludeId)
      .map((item) => ({ ...item, targetKind: "knowledge" })),
  ].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

function openKnowledge(entry) {
  const relationshipCards = (entry.relationships || [])
    .map((relation) => {
      const collection = {
        character: state.project.characters,
        place: state.project.places,
        knowledge: state.project.knowledge,
      }[relation.targetKind];
      const target = collection?.find((item) => item.id === relation.target);
      if (!target) return "";
      return html`<button
        type="button"
        class="knowledge-related"
        data-action="open-${esc(relation.targetKind)}"
        data-id="${esc(target.id)}"
      >
        <span>${esc(relation.type)}</span><strong>${esc(target.name)}</strong>
      </button>`;
    })
    .join("");
  openDialog(
    entry.name,
    html`<div class="knowledge-detail">
      <span class="role-chip">${esc(entry.category || "Allgemein")}</span>
      ${entry.image
        ? html`<img
            class="knowledge-detail-image"
            src="${esc(entry.image)}"
            alt="${esc(entry.name)}"
          />`
        : ""}
      <div class="detail-copy">
        ${wikiEntityText(
          "knowledge",
          entry,
          entry.description || "Noch keine Beschreibung.",
        )}
      </div>
      <div>
        <h3>Aliase</h3>
        <p>${esc((entry.aliases || []).join(", ") || "Keine Aliase.")}</p>
      </div>
      <div>
        <h3>Eigenschaften und Notizen</h3>
        <div class="detail-copy">
          ${wikiEntityText(
            "knowledge",
            entry,
            entry.traits || "Keine Notizen.",
          )}
        </div>
      </div>
      ${wikiEntitySections("knowledge", entry)}
      <div>
        <h3>Verknüpfungen</h3>
        <div class="knowledge-related-list">
          ${relationshipCards ||
          '<span class="small-note">Keine Verknüpfungen.</span>'}
        </div>
      </div>
    </div>`,
    async () => {
      dialog.close();
      openWikiEditor("knowledge", entry.id);
    },
    "Bearbeiten",
  );
  dialog.classList.add("entity-dialog");
  dialog.querySelector("[data-cancel]").textContent = "Schließen";
  dialog.querySelector(".dialog-actions").firstElementChild.innerHTML =
    '<button type="button" class="button subtle" data-delete>Eintrag löschen</button>';
  dialog.querySelector("[data-delete]").addEventListener("click", async () => {
    if (!confirm(`Eintrag „${entry.name}“ löschen?`)) return;
    await api.deleteKnowledge(entry.id);
    state.project = await api.currentProject();
    dialog.close();
    render();
    toast("Eintrag gelöscht.");
  });
}

function wikiEntitySections(kind, entry) {
  const sections = entry.wikiSections || [];
  if (!sections.length) return "";
  const articles = wikiArticles();
  const article = articles.find(
    (item) => item.kind === kind && item.id === entry.id,
  );
  if (!article) return "";
  return sections
    .map(
      (section) =>
        html`<section class="wiki-entity-section">
          <h3>${esc(section.title)}</h3>
          <div class="detail-copy">
            ${wikiText(section.body, article, articles)}
          </div>
        </section>`,
    )
    .join("");
}

function wikiEntityText(kind, entry, text) {
  const articles = wikiArticles();
  const article = articles.find(
    (item) => item.kind === kind && item.id === entry.id,
  );
  return article ? wikiText(text, article, articles) : esc(text);
}

function openEntity(kind, id, fromDialog = false) {
  const open = () => {
    const entity = {
      character: state.project.characters,
      place: state.project.places,
      knowledge: state.project.knowledge,
    }[kind]?.find((item) => item.id === id);
    if (!entity) return;
    if (kind === "character") openCharacter(entity);
    else if (kind === "place") openPlace(entity);
    else openKnowledge(entity);
  };
  if (fromDialog) {
    dialog.close();
    setTimeout(open, 0);
  } else {
    open();
  }
}

function projectSearchResults(query) {
  const normalized = query.trim().toLocaleLowerCase("de-DE");
  if (!normalized || !state.project) return [];
  const results = [];
  const add = (kind, id, title, body, detail = "") => {
    const text = `${title} ${body} ${detail}`;
    const index = text.toLocaleLowerCase("de-DE").indexOf(normalized);
    if (index < 0) return;
    const excerptStart = Math.max(0, index - 55);
    const excerptText = text.slice(
      excerptStart,
      index + normalized.length + 90,
    );
    results.push({
      kind,
      id,
      title,
      detail,
      excerpt: excerpt(excerptText, 150),
    });
  };
  for (const chapter of state.project.chapters) {
    add(
      "chapter",
      chapter.id,
      chapter.title || "Kapitel",
      chapter.body || "",
      chapter.volume || "Band 1",
    );
  }
  for (const character of state.project.characters) {
    add(
      "character",
      character.id,
      character.name,
      `${character.description || ""} ${character.traits || ""} ${character.notes || ""} ${(character.wikiSections || []).map((section) => section.body).join(" ")} ${(character.aliases || []).join(" ")}`,
      character.role || "Figur",
    );
  }
  for (const place of state.project.places) {
    add(
      "place",
      place.id,
      place.name,
      `${place.description || ""} ${place.traits || ""} ${(place.wikiSections || []).map((section) => section.body).join(" ")} ${(place.aliases || []).join(" ")}`,
      [place.category, place.continent, place.city]
        .filter(Boolean)
        .join(" · ") || "Ort",
    );
  }
  for (const entry of state.project.knowledge) {
    add(
      "knowledge",
      entry.id,
      entry.name,
      `${entry.description || ""} ${entry.traits || ""} ${(entry.wikiSections || []).map((section) => section.body).join(" ")} ${(entry.aliases || []).join(" ")}`,
      entry.category || "Wissen",
    );
  }
  return results.slice(0, 80);
}

function renderProjectSearch(query) {
  const resultsElement = document.querySelector("#project-search-results");
  const replacing = state.searchMode === "replace";
  const replacement = document.querySelector(".project-replace-input-wrap");
  const replaceCurrent = document.querySelector("[data-replace-current]");
  const replaceAll = document.querySelector("[data-replace-all]");
  document
    .querySelectorAll("[data-search-mode]")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        button.dataset.searchMode === state.searchMode,
      ),
    );
  replacement.hidden = !replacing;
  replaceCurrent.hidden = !replacing;
  replaceAll.hidden = !replacing;
  document.querySelectorAll("[data-search-nav]").forEach((button) => {
    button.disabled = !state.searchHits.length;
  });
  replaceCurrent.disabled = true;
  replaceAll.disabled = true;
  if (!query.trim()) {
    state.searchHits = [];
    document.querySelectorAll("[data-search-nav]").forEach((button) => {
      button.disabled = true;
    });
    resultsElement.innerHTML =
      '<div class="project-search-empty">Suche in Kapiteln, Figuren, Orten und Wissen.</div>';
    document.querySelector("#project-search-count").textContent =
      "Kapitel, Figuren, Orte und Wissen";
    return;
  }
  const manuscriptHits = searchManuscript(query);
  state.searchHits = manuscriptHits;
  document.querySelectorAll("[data-search-nav]").forEach((button) => {
    button.disabled = !manuscriptHits.length;
  });
  if (state.searchHitIndex >= manuscriptHits.length) state.searchHitIndex = 0;
  const results = replacing
    ? [
        ...manuscriptHits.map((hit, index) => ({
          kind: "chapter",
          id: hit.id,
          title: hit.title,
          detail: `${hit.volume} · Treffer ${index + 1}`,
          excerpt: hit.excerpt,
          index: hit.index,
          hitIndex: index,
        })),
        ...projectSearchResults(query).filter(
          (result) => result.kind !== "chapter",
        ),
      ].slice(0, 120)
    : [
        ...[
          ...new Map(manuscriptHits.map((hit) => [hit.id, hit])).values(),
        ].map((hit) => ({
          kind: "chapter",
          id: hit.id,
          title: hit.title,
          detail: `${hit.volume} · Manuskript`,
          excerpt: hit.excerpt,
          index: hit.index,
        })),
        ...projectSearchResults(query).filter(
          (result) => result.kind !== "chapter",
        ),
      ].slice(0, 120);
  document.querySelector("#project-search-count").textContent = replacing
    ? `${manuscriptHits.length} Treffer im Manuskript${manuscriptHits.length ? ` · ${state.searchHitIndex + 1} von ${manuscriptHits.length}` : ""}`
    : `${results.length} passende Einträge`;
  const canReplace = replacing && manuscriptHits.length > 0;
  replaceCurrent.disabled = !canReplace;
  replaceAll.disabled = !canReplace;
  resultsElement.innerHTML = results.length
    ? results
        .map(
          (result) =>
            html`<button
              class="project-search-result"
              data-search-kind="${result.kind}"
              data-id="${esc(result.id)}"
              data-search-index="${result.index ?? ""}"
              data-hit-index="${result.hitIndex ?? ""}"
              aria-current="${result.hitIndex === state.searchHitIndex
                ? "true"
                : "false"}"
            >
              <span class="project-search-result-icon"
                >${{ chapter: "▤", character: "♧", place: "⌖", knowledge: "◇" }[
                  result.kind
                ]}</span
              >
              <span class="project-search-result-copy"
                ><strong>${esc(result.title)}</strong
                ><small
                  >${esc(result.detail)} ·
                  ${esc(
                    {
                      chapter: "Kapitel",
                      character: "Figur",
                      place: "Ort",
                      knowledge: "Wissen",
                    }[result.kind],
                  )}</small
                ><span>${esc(result.excerpt)}</span></span
              >
            </button>`,
        )
        .join("")
    : '<div class="project-search-empty">Keine passenden Treffer gefunden.</div>';
}

function searchManuscript(query) {
  if (!query.trim() || !state.project) return [];
  const expression = new RegExp(escapeRegex(query.trim()), "giu");
  const hits = [];
  for (const chapter of state.project.chapters) {
    for (const match of chapter.body.matchAll(expression)) {
      const index = match.index ?? 0;
      hits.push({
        id: chapter.id,
        title: chapter.title || "Kapitel",
        volume: chapter.volume || "Band 1",
        index,
        excerpt: excerpt(
          chapter.body.slice(
            Math.max(0, index - 55),
            index + match[0].length + 90,
          ),
          150,
        ),
      });
    }
  }
  return hits;
}

function setSearchHit(index, query) {
  if (!state.searchHits.length) return;
  state.searchHitIndex =
    (index + state.searchHits.length) % state.searchHits.length;
  renderProjectSearch(query);
  document
    .querySelector(
      `.project-search-result[data-hit-index="${state.searchHitIndex}"]`,
    )
    ?.scrollIntoView({ block: "nearest" });
}

async function replaceSelectedMatch() {
  const hit = state.searchHits[state.searchHitIndex];
  const query = document.querySelector("#project-search-input").value.trim();
  if (!hit || !query) return;
  const chapter = state.project.chapters.find((item) => item.id === hit.id);
  if (!chapter) return;
  const replacement = document.querySelector("#project-replace-input").value;
  chapter.body = `${chapter.body.slice(0, hit.index)}${replacement}${chapter.body.slice(hit.index + query.length)}`;
  await persistReplacedChapters([chapter]);
  toast("Treffer ersetzt.");
  renderProjectSearch(query);
}

async function replaceAllMatches() {
  const query = document.querySelector("#project-search-input").value.trim();
  if (!query) return;
  const replacement = document.querySelector("#project-replace-input").value;
  const chapters = state.project.chapters.filter((chapter) =>
    new RegExp(escapeRegex(query), "iu").test(chapter.body),
  );
  if (!chapters.length) return;
  const expression = new RegExp(escapeRegex(query), "giu");
  for (const chapter of chapters)
    chapter.body = chapter.body.replace(expression, () => replacement);
  await persistReplacedChapters(chapters);
  toast(`${format(state.searchHits.length)} Treffer ersetzt.`);
  state.searchHitIndex = 0;
  renderProjectSearch(query);
}

async function persistReplacedChapters(chapters) {
  const activeEditor = page.querySelector("#editor-text");
  if (
    activeEditor &&
    !chapters.some((chapter) => chapter.id === state.activeChapter)
  )
    await saveCurrentChapter();
  for (const chapter of chapters) {
    if (activeEditor && chapter.id === state.activeChapter)
      activeEditor.value = chapter.body;
    const saved = await api.saveChapter({
      ...chapter,
      order: state.project.chapters.indexOf(chapter) + 1,
    });
    chapter.id = saved.id;
    chapter.file = saved.file;
    chapter.updated = new Date().toISOString();
  }
  state.project = await api.currentProject();
  if (page.querySelector("#editor-text")) render();
}

function openSearchResult(kind, id, matchIndex = null) {
  searchDialog.close();
  if (kind === "chapter") {
    void saveCurrentChapter();
    state.activeChapter = id;
    setPage("writing");
    if (matchIndex !== null) {
      const editor = page.querySelector("#editor-text");
      const length = document.querySelector("#project-search-input").value
        .length;
      editor?.focus();
      editor?.setSelectionRange(matchIndex, matchIndex + length);
    }
    return;
  }
  setPage(
    { character: "characters", place: "places", knowledge: "knowledge" }[kind],
  );
  openEntity(kind, id);
}

function openRelationshipMap() {
  const characters = state.project.characters;
  const relations = [];
  const seen = new Set();
  for (const source of characters)
    for (const relation of source.relationships || []) {
      const target = characters.find((item) => item.id === relation.target);
      if (!target) continue;
      const key = [source.id, target.id].sort().join("::");
      if (seen.has(key)) continue;
      seen.add(key);
      const reciprocal = (target.relationships || []).some(
        (item) => item.target === source.id,
      );
      relations.push(
        html`<div class="relationship-map-row">
          <span>${esc(source.name)}</span
          ><b>${relation.bidirectional || reciprocal ? "↔" : "→"}</b
          ><span>${esc(target.name)}</span><small>${esc(relation.type)}</small>
        </div>`,
      );
    }
  openDialog(
    "Beziehungsübersicht",
    html`<p class="quiet">Verbindungen deiner Figuren im Überblick.</p>
      <div class="relationship-map">
        ${relations.length
          ? relations.join("")
          : html`<div class="empty-state">
              <strong>Noch keine Verbindungen</strong
              ><span>Füge Beziehungen in den Figurenprofilen hinzu.</span>
            </div>`}
      </div>`,
    async () => {},
    "Fertig",
  );
  dialog.querySelector("[data-cancel]").textContent = "Schließen";
}

function createProject() {
  openDialog(
    "Neues Schreibprojekt",
    html`<label class="field"
        >Projektname<input name="name" required placeholder="Titel"
      /></label>
      <p class="small-note">
        Du wählst im nächsten Schritt den Ordner, in dem Mycel das Projekt
        anlegt.
      </p>`,
    async (data) => {
      const project = await api.createProject(data.get("name").trim());
      if (!project) return;
      state.project = project;
      state.recentProjects = await api.recentProjects();
      state.page = "home";
      dialog.close();
      render();
      toast("Projekt bereit.");
    },
    "Ordner wählen",
  );
}

async function openProject() {
  const project = await api.chooseProject();
  if (!project) return;
  state.project = project;
  state.recentProjects = await api.recentProjects();
  state.activeChapter = project.chapters[0]?.id || null;
  toast("Projekt geöffnet.");
  render();
}

async function openRecentProject(root) {
  const project = await api.openRecentProject(root);
  if (!project) {
    state.recentProjects = await api.recentProjects();
    render();
    toast("Dieses Projekt ist nicht mehr verfügbar.");
    return;
  }
  state.project = project;
  state.activeChapter = project.chapters[0]?.id || null;
  render();
}

async function removeRecentProject(root) {
  state.recentProjects = await api.forgetRecentProject(root);
  render();
}

document.addEventListener("click", async (event) => {
  const pageNavigation = event.target.closest("[data-page]");
  if (pageNavigation && state.wikiEditing) {
    toast("Speichere oder brich die Bearbeitung erst ab.");
    return;
  }
  if (event.target.closest("[data-action^='new-']") && state.wikiEditing) {
    toast("Speichere oder brich die Bearbeitung erst ab.");
    return;
  }
  const wikiEditButton = event.target.closest("[data-wiki-edit]");
  if (wikiEditButton) {
    const [kind, ...idParts] = wikiEditButton.dataset.wikiEdit.split("|");
    openWikiEditor(kind, idParts.join("|"));
    return;
  }
  if (event.target.closest("[data-wiki-cancel]")) {
    state.wikiEditing = false;
    state.wikiDraft = null;
    state.wikiArticle = state.wikiReturnArticle;
    state.page = state.wikiReturnPage;
    render();
    return;
  }
  if (event.target.closest("[data-wiki-add-section]")) {
    page
      .querySelector(".wiki-edit-custom-list")
      .insertAdjacentHTML("beforeend", wikiCustomSection());
    page
      .querySelector(".wiki-edit-custom:last-child [data-wiki-custom-title]")
      ?.focus();
    return;
  }
  const addWikiProperty = event.target.closest("[data-wiki-add-property]");
  if (addWikiProperty) {
    const field = addWikiProperty.dataset.wikiAddProperty;
    const editor = page.querySelector(`[data-wiki-properties="${field}"]`);
    editor.insertAdjacentHTML("beforeend", wikiEditPropertyRow());
    editor.lastElementChild?.querySelector("[data-property-name]")?.focus();
    return;
  }
  const removeWikiProperty = event.target.closest(
    "[data-wiki-remove-property]",
  );
  if (removeWikiProperty) {
    const editor = removeWikiProperty.closest("[data-wiki-properties]");
    removeWikiProperty.closest(".wiki-property-editor-item").remove();
    if (!editor.children.length)
      editor.insertAdjacentHTML("beforeend", wikiEditPropertyRow());
    return;
  }
  const removeWikiSection = event.target.closest("[data-wiki-remove-section]");
  if (removeWikiSection) {
    removeWikiSection.closest(".wiki-edit-custom").remove();
    return;
  }
  const wikiImageButton = event.target.closest("[data-wiki-insert-image]");
  if (wikiImageButton) {
    const textarea = wikiImageButton
      .closest(".wiki-edit-section")
      .querySelector("textarea");
    await chooseWikiImage(textarea);
    return;
  }
  const removeInlineImage = event.target.closest(
    "[data-wiki-remove-inline-image]",
  );
  if (removeInlineImage) {
    const section = removeInlineImage.closest(".wiki-edit-section");
    const textarea = section.querySelector("textarea");
    const marker = removeInlineImage.dataset.wikiRemoveInlineImage;
    textarea.value = textarea.value
      .replaceAll(marker, "")
      .replace(/\n{3,}/g, "\n\n");
    textarea.dataset.wikiImages = JSON.stringify(
      JSON.parse(textarea.dataset.wikiImages || "[]").filter(
        (image) => image.marker !== marker,
      ),
    );
    section.querySelector(".wiki-edit-image-previews")?.remove();
    section
      .querySelector("textarea")
      .insertAdjacentHTML(
        "afterend",
        wikiEditImagePreviews(JSON.parse(textarea.dataset.wikiImages || "[]")),
      );
    return;
  }
  const wikiFormat = event.target.closest("[data-wiki-format]");
  if (wikiFormat) {
    const editor = wikiFormat.closest(".wiki-edit-section");
    const textarea = editor.querySelector("textarea");
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end);
    const format = wikiFormat.dataset.wikiFormat;
    let before = "";
    let after = "";
    let value = selected || "Text";
    if (format === "bold") [before, after] = ["**", "**"];
    if (format === "italic") [before, after] = ["*", "*"];
    if (format === "list") {
      value = (selected || "Listeneintrag")
        .split("\n")
        .map((line) => `- ${line}`)
        .join("\n");
    }
    const result = `${before}${value}${after}`;
    textarea.setRangeText(result, start, end, "select");
    textarea.focus();
    return;
  }
  const addWikiRelation = event.target.closest("[data-wiki-add-relation]");
  if (addWikiRelation) {
    const kind = page.querySelector("#wiki-editor-form").dataset.kind;
    const host = page.querySelector(".wiki-edit-relations");
    const row = document.createElement("div");
    row.className = "wiki-edit-relation";
    row.dataset.wikiRelation = "";
    if (kind === "character") {
      const others = state.project.characters.filter(
        (item) =>
          item.id !== page.querySelector("#wiki-editor-form").dataset.id,
      );
      row.innerHTML = html`<select
          data-relation-target
          aria-label="Verknüpfte Figur"
        >
          <option value="">Figur auswählen</option>
          ${others
            .map(
              (item) =>
                html`<option value="${esc(item.id)}">
                  ${esc(item.name)}
                </option>`,
            )
            .join("")}
        </select>
        <input data-relation-type placeholder="Beziehung" />
        <label
          ><input
            type="checkbox"
            data-relation-bidirectional
          />Beidseitig</label
        >
        <button type="button" class="button subtle" data-wiki-remove-relation>
          Entfernen
        </button>`;
    } else {
      row.innerHTML = html`<select
          data-relation-target
          aria-label="Verknüpfter Eintrag"
        >
          <option value="">Eintrag auswählen</option>
          ${knowledgeTargets(page.querySelector("#wiki-editor-form").dataset.id)
            .map(
              (target) =>
                html`<option
                  value="${esc(`${target.targetKind}:${target.id}`)}"
                >
                  ${target.targetKind === "character"
                    ? "Figur"
                    : target.targetKind === "place"
                      ? "Ort"
                      : "Wissen"}
                  · ${esc(target.name)}
                </option>`,
            )
            .join("")}
        </select>
        <input data-relation-type placeholder="Verknüpfung" />
        <button type="button" class="button subtle" data-wiki-remove-relation>
          Entfernen
        </button>`;
    }
    host.append(row);
    return;
  }
  const removeWikiRelation = event.target.closest(
    "[data-wiki-remove-relation]",
  );
  if (removeWikiRelation) {
    removeWikiRelation.closest("[data-wiki-relation]").remove();
    return;
  }
  if (event.target.closest("[data-wiki-image]")) {
    const kind = page.querySelector("#wiki-editor-form").dataset.kind;
    const image =
      kind === "character"
        ? await api.chooseCharacterImage()
        : await api.choosePlaceImage();
    if (!image) return;
    const property = event.target.closest(".wiki-edit-property");
    property.querySelector('[data-wiki-field="image"]').value = image;
    let preview = property.querySelector(".wiki-edit-image");
    if (!preview) {
      preview = document.createElement("img");
      preview.className = "wiki-edit-image";
      preview.alt = "";
      property.insertBefore(
        preview,
        property.querySelector("input[type=hidden]"),
      );
    }
    preview.src = image;
    let remove = property.querySelector("[data-wiki-remove-image]");
    if (!remove) {
      remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button subtle";
      remove.dataset.wikiRemoveImage = "";
      remove.textContent = "Entfernen";
      property.querySelector(".wiki-edit-image-actions").append(remove);
    }
    return;
  }
  if (event.target.closest("[data-wiki-remove-image]")) {
    const property = event.target.closest(".wiki-edit-property");
    property.querySelector('[data-wiki-field="image"]').value = "";
    property.querySelector(".wiki-edit-image")?.remove();
    event.target.closest("[data-wiki-remove-image]").remove();
    return;
  }
  const newEntry = event.target.closest("[data-action^='new-']");
  if (newEntry) {
    const kind = {
      "new-character": "character",
      "new-place": "place",
      "new-knowledge": "knowledge",
    }[newEntry.dataset.action];
    if (kind) {
      startWikiEntry(kind);
      return;
    }
  }
  const wikiCategory = event.target.closest("[data-wiki-category]");
  if (wikiCategory) {
    state.wikiCategory = wikiCategory.dataset.wikiCategory;
    page
      .querySelectorAll("[data-wiki-category]")
      .forEach((button) =>
        button.classList.toggle(
          "active",
          button.dataset.wikiCategory === state.wikiCategory,
        ),
      );
    applyWikiFilters();
    return;
  }
  const wikiLink = event.target.closest("[data-wiki-open]");
  if (wikiLink) {
    event.preventDefault();
    if (state.wikiEditing) {
      toast("Speichere oder brich die Bearbeitung erst ab.");
      return;
    }
    state.wikiArticle = wikiLink.dataset.wikiOpen;
    if (state.page !== "wiki") state.page = "wiki";
    render();
    return;
  }
  const placeTab = event.target.closest("[data-place-tab]");
  if (placeTab) {
    state.placeTab = placeTab.dataset.placeTab;
    localStorage.setItem("mycel-place-tab", state.placeTab);
    render();
    return;
  }
  const mapMarker = event.target.closest("[data-map-place]");
  if (mapMarker) {
    const place = state.project.places.find(
      (item) => item.id === mapMarker.dataset.mapPlace,
    );
    if (place) openPlace(place);
    return;
  }
  const chapterViewButton = event.target.closest("[data-chapter-view]");
  if (chapterViewButton) {
    state.chapterView = chapterViewButton.dataset.chapterView;
    localStorage.setItem("mycel-chapter-view", state.chapterView);
    render();
    return;
  }
  const searchResult = event.target.closest("[data-search-kind]");
  if (searchResult) {
    if (
      state.searchMode === "replace" &&
      searchResult.dataset.searchKind === "chapter" &&
      searchResult.dataset.hitIndex !== ""
    ) {
      state.searchHitIndex = Number(searchResult.dataset.hitIndex);
      renderProjectSearch(
        document.querySelector("#project-search-input").value,
      );
      return;
    }
    const index = searchResult.dataset.searchIndex;
    openSearchResult(
      searchResult.dataset.searchKind,
      searchResult.dataset.id,
      index === "" ? null : Number(index),
    );
    return;
  }
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    setPage(pageButton.dataset.page);
    return;
  }
  const formatButton = event.target.closest("[data-format]");
  if (formatButton) {
    formatText(formatButton.dataset.format);
    return;
  }
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "edit-chapter") {
    event.stopPropagation();
    const ch = state.project.chapters.find(
      (item) => item.id === button.dataset.id,
    );
    if (ch) editChapterForm(ch);
  }
  if (action === "create-project") createProject();
  else if (action === "choose-world-map") void chooseWorldMap();
  else if (action === "open-project") void openProject();
  else if (action === "open-recent-project")
    void openRecentProject(button.dataset.root);
  else if (action === "remove-recent-project")
    void removeRecentProject(button.dataset.root);
  else if (action === "new-chapter") createChapter();
  else if (action === "new-character") startWikiEntry("character");
  else if (action === "new-place") startWikiEntry("place");
  else if (action === "new-knowledge") startWikiEntry("knowledge");
  else if (action === "write-chapter") {
    void saveCurrentChapter();
    state.activeChapter = button.dataset.id;
    setPage("writing");
  } else if (
    ["open-character", "open-place", "open-knowledge"].includes(action)
  ) {
    openEntity(
      action.replace("open-", ""),
      button.dataset.id,
      dialog.open && dialog.contains(button),
    );
  } else if (action === "relationship-info") openRelationshipMap();
  else if (action === "save-now") {
    await saveCurrentChapter();
    toast("Kapitel gespeichert.");
  } else if (action === "save-goal") {
    state.project = await api.saveSettings({
      goal: document.querySelector("#goal-input").value,
    });
    render();
    toast("Manuskriptziel gespeichert.");
  }
});
document.addEventListener("input", (event) => {
  if (event.target.matches("#chapter-search")) applyChapterFilters();
  if (event.target.matches("#wiki-search")) {
    state.wikiSearch = event.target.value;
    applyWikiFilters();
  }
});
document.addEventListener("submit", async (event) => {
  const form = event.target.closest("#wiki-editor-form");
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.kind;
  const existingId = form.dataset.id;
  const value = (name) => {
    const field = form.querySelector(`[data-wiki-field="${name}"]`);
    if (!field) return "";
    return field instanceof HTMLTextAreaElement
      ? wikiEditorBody(field)
      : field.value || "";
  };
  const traits = [...form.querySelectorAll("[data-wiki-properties]")]
    .flatMap((editor) =>
      [...editor.querySelectorAll(".wiki-property-editor-item")].map((row) => ({
        name: row.querySelector("[data-property-name]").value.trim(),
        value: row.querySelector("[data-property-value]").value.trim(),
      })),
    )
    .filter((property) => property.name || property.value)
    .map((property) =>
      property.name ? `${property.name}: ${property.value}` : property.value,
    )
    .join("\n");
  const name = value("name").trim();
  if (!name) {
    toast("Gib dem Eintrag einen Namen.");
    return;
  }
  const entities = [
    ...state.project.characters.map((item) => ({ ...item, kind: "character" })),
    ...state.project.places.map((item) => ({ ...item, kind: "place" })),
    ...state.project.knowledge.map((item) => ({ ...item, kind: "knowledge" })),
  ];
  const nameKey = name.toLocaleLowerCase("de-DE");
  if (
    entities.some(
      (item) =>
        !(item.kind === kind && item.id === existingId) &&
        item.name.trim().toLocaleLowerCase("de-DE") === nameKey,
    )
  ) {
    toast("Dieser Name wird bereits verwendet.");
    return;
  }
  const color = value("color").toLowerCase();
  if (
    entities.some(
      (item) =>
        !(item.kind === kind && item.id === existingId) &&
        characterColor(item).toLowerCase() === color,
    )
  ) {
    toast("Bitte wähle eine eigene Markierungsfarbe.");
    return;
  }
  const sections = [...form.querySelectorAll(".wiki-edit-custom")]
    .map((section) => ({
      title: section.querySelector("[data-wiki-custom-title]").value.trim(),
      body: wikiEditorBody(section.querySelector("[data-wiki-custom-body]")),
    }))
    .filter((section) => section.title);
  let id = existingId || slug(name);
  let suffix = 2;
  const collection = {
    character: state.project.characters,
    place: state.project.places,
    knowledge: state.project.knowledge,
  }[kind];
  while (!existingId && collection.some((item) => item.id === id))
    id = `${slug(name)}-${suffix++}`;
  const record = {
    id,
    name,
    aliases: value("aliases"),
    color,
    image: value("image"),
    description: value("description"),
    traits,
    wikiSections: sections,
  };
  if (kind === "character") {
    record.role = value("role");
    record.notes = value("notes");
    record.relationships = [...form.querySelectorAll("[data-wiki-relation]")]
      .map((row) => ({
        target: row.querySelector("[data-relation-target]").value,
        type: row.querySelector("[data-relation-type]").value.trim(),
        bidirectional: row.querySelector("[data-relation-bidirectional]")
          .checked,
      }))
      .filter((relation) => relation.target && relation.type);
  }
  if (kind === "place") {
    record.category = value("category");
    record.continent = value("continent");
    record.region = value("region");
    record.city = value("city");
  }
  if (kind === "knowledge") {
    record.category = value("category");
    record.relationships = [...form.querySelectorAll("[data-wiki-relation]")]
      .map((row) => {
        const [targetKind, ...targetId] = row
          .querySelector("[data-relation-target]")
          .value.split(":");
        return {
          targetKind,
          target: targetId.join(":"),
          type: row.querySelector("[data-relation-type]").value.trim(),
        };
      })
      .filter((relation) => relation.target && relation.type);
  }
  try {
    if (kind === "character") await api.saveCharacter(record);
    else if (kind === "place") await api.savePlace(record);
    else await api.saveKnowledge(record);
    state.project = await api.currentProject();
    state.wikiDraft = null;
    state.wikiArticle = `${kind}|${id}`;
    state.wikiEditing = false;
    render();
    toast("Eintrag gespeichert.");
  } catch (error) {
    toast(`Eintrag konnte nicht gespeichert werden: ${error.message || error}`);
  }
});
document.addEventListener("change", (event) => {
  if (event.target.matches("#volume-filter")) applyChapterFilters();
});

function openProjectSearch(mode = "find") {
  if (!state.project) {
    toast("Öffne zuerst ein Projekt.");
    return;
  }
  state.searchMode = mode;
  if (!searchDialog.open) searchDialog.showModal();
  const input = document.querySelector("#project-search-input");
  if (!input.value) {
    const editor = page.querySelector("#editor-text");
    const selection = editor?.value.slice(
      editor.selectionStart,
      editor.selectionEnd,
    );
    if (selection) input.value = selection;
  }
  renderProjectSearch(input.value);
  (mode === "replace"
    ? document.querySelector("#project-replace-input")
    : input
  ).focus();
}

document
  .querySelector("#project-search-open")
  .addEventListener("click", () => openProjectSearch("find"));
document.querySelectorAll("[data-search-mode]").forEach((button) => {
  button.addEventListener("click", () =>
    openProjectSearch(button.dataset.searchMode),
  );
});
document
  .querySelector("#project-search-input")
  .addEventListener("input", (event) => {
    state.searchHitIndex = 0;
    renderProjectSearch(event.currentTarget.value);
  });
document
  .querySelector("#project-replace-input")
  .addEventListener("input", () => {
    renderProjectSearch(document.querySelector("#project-search-input").value);
  });
document
  .querySelector("#project-search-input")
  .addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      if (state.searchMode === "replace") void replaceSelectedMatch();
      else {
        const first = document.querySelector(
          '.project-search-result[data-search-kind="chapter"]',
        );
        if (first)
          openSearchResult(
            first.dataset.searchKind,
            first.dataset.id,
            Number(first.dataset.searchIndex),
          );
      }
    }
  });
document.querySelectorAll("[data-search-nav]").forEach((button) => {
  button.addEventListener("click", () => {
    const direction = button.dataset.searchNav === "next" ? 1 : -1;
    const nextIndex =
      (state.searchHitIndex + direction + state.searchHits.length) %
      state.searchHits.length;
    if (state.searchMode === "replace")
      setSearchHit(
        nextIndex,
        document.querySelector("#project-search-input").value,
      );
    else {
      const hit = state.searchHits[nextIndex];
      if (hit) openSearchResult("chapter", hit.id, hit.index);
    }
  });
});
document
  .querySelector("[data-replace-current]")
  .addEventListener("click", () => void replaceSelectedMatch());
document
  .querySelector("[data-replace-all]")
  .addEventListener("click", () => void replaceAllMatches());
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey) {
    const key = event.key.toLowerCase();
    if (!["k", "f", "h"].includes(key)) return;
    event.preventDefault();
    if (key === "h") openProjectSearch("replace");
    else openProjectSearch("find");
  }
});

function formatText(kind) {
  if (state.writingMode === "typewriter") return;
  const editor = page.querySelector("#editor-text");
  if (!editor) return;
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.slice(start, end);
  const pair = {
    bold: ["**", "**"],
    italic: ["*", "*"],
    quote: ["> ", ""],
    heading: ["## ", ""],
    list: ["- ", ""],
    scene: ["\n\n* * *\n\n", ""],
  }[kind];
  if (kind === "undo" || kind === "redo") {
    document.execCommand(kind);
    return;
  }
  const insertion =
    pair[0] + (selected || (kind === "scene" ? "" : "Text")) + pair[1];
  editor.setRangeText(insertion, start, end, "select");
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  editor.focus();
}

document
  .querySelector("#open-project")
  .addEventListener("click", () => void openProject());
document.querySelector("#new-project").addEventListener("click", createProject);
applyPreferences();
void Promise.all([api.currentProject(), api.recentProjects()]).then(
  ([project, recentProjects]) => {
    state.project = project;
    state.recentProjects = recentProjects;
    state.activeChapter = project?.chapters[0]?.id || null;
    render();
  },
);
