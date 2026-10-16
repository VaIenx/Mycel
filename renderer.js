const api = window.mycel;
const state = {
  project: null,
  page: "home",
  activeChapter: null,
  activeCharacter: null,
  timer: null,
  lastSavedBody: "",
  saveTimer: null,
};
const page = document.querySelector("#page");
const dialog = document.querySelector("#dialog");
const toastEl = document.querySelector("#toast");

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
  characters = state.project?.characters || [],
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
  document.querySelector("#project-pill").textContent = "Kein Projekt geöffnet";
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
    <div class="welcome-note">
      Keine Konten, keine Synchronisierung, keine Ablenkung.
    </div>
  </section>`;
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
  return html`<article
    class="chapter-card"
    data-action="write-chapter"
    data-id="${esc(ch.id)}"
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
    <span class="status ${status === "Fertig" ? "complete" : ""}"
      >${esc(status)}</span
    >
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
    <div class="tabs">
      <button class="tab active">▤ &nbsp; Kapitel</button
      ><button class="tab" data-page="characters">♧ &nbsp; Figuren</button>
      <div class="tab-counts">
        <div><small>KAPITEL</small><strong>${chapters.length}</strong></div>
        <div>
          <small>WÖRTER GESAMT</small><strong>${format(totalWords())}</strong>
        </div>
      </div>
    </div>
    <div class="filterbar">
      <select class="select-like" id="volume-filter">
        <option value="all">Band: Alle Bände</option>
        ${[...new Set(chapters.map((ch) => ch.volume || "Band 1"))]
          .map((v) => html`<option>${esc(v)}</option>`)
          .join("")}</select
      ><input
        id="chapter-search"
        class="search"
        placeholder="Kapitel suchen …"
      />
      <div class="view-toggle">
        <button class="active">▦</button
        ><button title="Liste (bald verfügbar)">☷</button>
      </div>
    </div>
    <div id="chapter-grid" class="grid">${cards}</div>
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
            ch.description || ch.traits || "Noch keine Beschreibung.",
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
    <div class="tabs">
      <button class="tab" data-page="chapters">▤ &nbsp; Kapitel</button
      ><button class="tab active">♧ &nbsp; Figuren</button>
      <div class="tab-counts">
        <div><small>FIGUREN GESAMT</small><strong>${list.length}</strong></div>
      </div>
    </div>
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
      <div class="toolbar">
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
      </div>
      <div class="editor-wrap">
        <div
          id="editor-highlight"
          class="editor-highlight"
          aria-hidden="true"
          data-placeholder="Schreib den ersten Satz deiner Geschichte …"
        ></div>
        <textarea
          id="editor-text"
          class="editor-text"
          spellcheck="true"
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

function characterMatchData(characters) {
  const matches = new Map();
  characters.forEach((character) => {
    [character.name, ...(character.aliases || [])]
      .map((name) => String(name || "").trim())
      .filter(Boolean)
      .forEach((name) => {
        const key = name.toLocaleLowerCase("de-DE");
        if (!matches.has(key)) matches.set(key, { name, character });
      });
  });
  return [...matches.values()].sort((a, b) => b.name.length - a.name.length);
}

function highlightedText(text, characters) {
  const matches = characterMatchData(characters);
  if (!matches.length) return esc(text);
  const expression = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:${matches
      .map(({ name }) => escapeRegex(name))
      .join("|")})(?![\\p{L}\\p{N}_])`,
    "giu",
  );
  const byName = new Map(
    matches.map(({ name, character }) => [
      name.toLocaleLowerCase("de-DE"),
      character,
    ]),
  );
  let output = "";
  let previous = 0;
  for (const match of text.matchAll(expression)) {
    output += esc(text.slice(previous, match.index));
    const character = byName.get(match[0].toLocaleLowerCase("de-DE"));
    output += `<span class="character-mention" data-character-id="${esc(
      character.id,
    )}" data-action="open-character" data-id="${esc(
      character.id,
    )}" style="--character-highlight: ${characterColor(character)}">${esc(
      match[0],
    )}</span>`;
    previous = match.index + match[0].length;
  }
  return output + esc(text.slice(previous));
}

function showCharacterTooltip(character, event) {
  const tooltip = document.querySelector("#character-tooltip");
  tooltip.innerHTML = html`<strong>${esc(character.name)}</strong>
    <span>${esc(character.role || "Figur")}</span>
    <p>
      ${esc(
        excerpt(
          character.description ||
            character.traits ||
            "Noch keine Beschreibung.",
          120,
        ),
      )}
    </p>`;
  tooltip.hidden = false;
  tooltip.style.left = `${Math.min(event.clientX + 14, innerWidth - 270)}px`;
  tooltip.style.top = `${Math.min(event.clientY + 16, innerHeight - 120)}px`;
}

function render() {
  document
    .querySelectorAll(".primary-nav [data-page]")
    .forEach((button) =>
      button.classList.toggle("active", button.dataset.page === state.page),
    );
  if (!state.project) return renderWelcome();
  document.querySelector("#project-pill").textContent = state.project.name;
  if (state.page === "home") page.innerHTML = renderHome();
  else if (state.page === "chapters") page.innerHTML = renderChapters();
  else if (state.page === "characters") page.innerHTML = renderCharacters();
  else if (state.page === "writing") page.innerHTML = renderWriting();
  else page.innerHTML = renderProgress();
  if (state.page === "chapters") {
    const search = page.querySelector("#chapter-search");
    const filter = page.querySelector("#volume-filter");
    const apply = () =>
      page.querySelectorAll(".chapter-card").forEach((card) => {
        const ch = state.project.chapters.find(
          (item) => item.id === card.dataset.id,
        );
        const matches =
          ch &&
          (!search.value ||
            (ch.title + " " + ch.body)
              .toLowerCase()
              .includes(search.value.toLowerCase())) &&
          (filter.value === "all" || (ch.volume || "Band 1") === filter.value);
        card.hidden = !matches;
      });
    search?.addEventListener("input", apply);
    filter?.addEventListener("change", apply);
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
  const editor = page.querySelector("#editor-text");
  if (editor) {
    editor.value = currentChapter()?.body || "";
    state.lastSavedWords = wordCount(editor.value);
    const highlight = page.querySelector("#editor-highlight");
    const updateHighlights = () => {
      highlight.innerHTML = highlightedText(
        editor.value,
        state.project.characters,
      );
      highlight.scrollTop = editor.scrollTop;
      highlight.scrollLeft = editor.scrollLeft;
    };
    updateHighlights();
    editor.addEventListener("scroll", () => {
      highlight.scrollTop = editor.scrollTop;
      highlight.scrollLeft = editor.scrollLeft;
    });
    highlight.addEventListener("pointerover", (event) => {
      const mention = event.target.closest(".character-mention");
      if (!mention) return;
      const character = state.project.characters.find(
        (item) => item.id === mention.dataset.characterId,
      );
      if (character) showCharacterTooltip(character, event);
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
      if (!event.target.closest(".character-mention")) return;
      document.querySelector("#character-tooltip").hidden = true;
    });
  }
  editor?.addEventListener("input", () => {
    const ch = currentChapter();
    if (!ch) return;
    ch.body = editor.value;
    page.querySelector("#editor-highlight").innerHTML = highlightedText(
      editor.value,
      state.project.characters,
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
        >Status<select name="status">
          ${["Entwurf", "In Arbeit", "Fertig"]
            .map(
              (status) =>
                html`<option ${existing?.status === status ? "selected" : ""}>
                  ${status}
                </option>`,
            )
            .join("")}
        </select></label
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
        status: data.get("status"),
        target: Number(data.get("target")) || 0,
        body: existing?.body || "",
        order: Number(data.get("order")) || state.project.chapters.length + 1,
      };
      if (!editing) state.project.chapters.push(chapter);
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

function editCharacterForm(ch = {}) {
  const editing = !!ch.id;
  const others = state.project.characters.filter((item) => item.id !== ch.id);
  const relationRows = (ch.relationships || [])
    .map(
      (rel) =>
        html`<div class="relation-row">
          <select name="relationTarget">
            <option value="">Figur auswählen</option>
            ${others
              .map(
                (item) =>
                  html`<option
                    value="${esc(item.id)}"
                    ${rel.target === item.id ? "selected" : ""}
                  >
                    ${esc(item.name)}
                  </option>`,
              )
              .join("")}</select
          ><input
            name="relationType"
            value="${esc(rel.type || "")}"
            placeholder="Beziehung"
          /><button
            type="button"
            class="button small"
            data-remove-relation
            aria-label="Beziehung entfernen"
          >
            ×
          </button>
        </div>`,
    )
    .join("");
  const addRelationshipRow = (host) => {
    const row = document.createElement("div");
    row.className = "relation-row";
    row.innerHTML = html`<select name="relationTarget">
        <option value="">Figur auswählen</option>
        ${others
          .map(
            (item) =>
              html`<option value="${esc(item.id)}">${esc(item.name)}</option>`,
          )
          .join("")}</select
      ><input name="relationType" placeholder="Beziehung" /><button
        type="button"
        class="button small"
        data-remove-relation
        aria-label="Beziehung entfernen"
      >
        ×
      </button>`;
    host.append(row);
  };
  openDialog(
    editing ? "Figur bearbeiten" : "Neue Figur",
    html`<div class="form-grid">
      <label class="field"
        >Name<input
          name="name"
          required
          value="${esc(ch.name || "")}"
          placeholder="Name der Figur" /></label
      ><label class="field"
        >Rolle<select name="role">
          ${[
            "Protagonist",
            "Antagonist",
            "Nebenfigur",
            "Unterstützend",
            "Neutral",
          ]
            .map(
              (role) =>
                html`<option ${ch.role === role ? "selected" : ""}>
                  ${role}
                </option>`,
            )
            .join("")}
        </select></label
      ><label class="field"
        >Markierungsfarbe<input
          name="color"
          type="color"
          value="${characterColor(ch)}" /></label
      ><label class="field full"
        >Aliase, durch Kommas getrennt<input
          name="aliases"
          value="${esc((ch.aliases || []).join(", "))}"
          placeholder="Spitzname, Titel" /></label
      ><label class="field full"
        >Kurzbeschreibung<textarea
          name="description"
          placeholder="Wer ist diese Figur?"
        ></textarea></label
      ><label class="field full"
        >Eigenschaften / Notizen<textarea
          name="traits"
          placeholder="Ziele, Konflikte, Besonderheiten …"
        ></textarea>
      </label>
      <div class="field full">
        <label>Beziehungen</label>
        <div class="relation-list">${relationRows}</div>
        ${others.length
          ? '<button type="button" class="button small" data-add-relation>＋ Beziehung hinzufügen</button>'
          : '<span class="small-note">Lege zuerst eine zweite Figur an.</span>'}
      </div>
      <div class="field full">
        <label>Porträtbild</label
        ><input
          name="image"
          value="${esc(ch.image || "")}"
          placeholder="Noch kein Bild ausgewählt"
          readonly
        /><button type="button" class="button small" data-image>
          Bild aus Ordner auswählen …
        </button>
      </div>
    </div>`,
    async (data) => {
      const name = data.get("name").trim();
      if (
        state.project.characters.some(
          (item) =>
            item.id !== ch.id &&
            item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      ) {
        toast("Es gibt bereits eine Figur mit diesem Namen.");
        return false;
      }
      const color = data.get("color").toLowerCase();
      if (
        state.project.characters.some(
          (item) =>
            item.id !== ch.id && characterColor(item).toLowerCase() === color,
        )
      ) {
        toast("Bitte wähle eine eigene Markierungsfarbe.");
        return false;
      }
      let id = ch.id || slug(name);
      let suffix = 2;
      while (
        !editing &&
        state.project.characters.some((item) => item.id === id)
      )
        id = `${slug(name)}-${suffix++}`;
      const targets = data.getAll("relationTarget");
      const types = data.getAll("relationType");
      const relationships = targets
        .map((target, index) => ({
          target,
          type: String(types[index] || "").trim(),
        }))
        .filter((rel) => rel.target && rel.type);
      try {
        await api.saveCharacter({
          id,
          name,
          role: data.get("role"),
          aliases: data.get("aliases"),
          description: data.get("description"),
          traits: data.get("traits"),
          color,
          relationships,
          image: data.get("image"),
        });
      } catch (error) {
        toast(
          `Figur konnte nicht gespeichert werden: ${error.message || error}`,
        );
        return false;
      }
      state.project = await api.currentProject();
      state.activeCharacter = id;
      dialog.close();
      toast(editing ? "Figur gespeichert." : "Figur erstellt.");
      render();
    },
    editing ? "Änderungen speichern" : "Figur anlegen",
  );
  dialog.querySelector('[name="description"]').value = ch.description || "";
  dialog.querySelector('[name="traits"]').value = ch.traits || "";
  dialog
    .querySelector("[data-add-relation]")
    ?.addEventListener("click", () =>
      addRelationshipRow(dialog.querySelector(".relation-list")),
    );
  dialog.querySelector(".relation-list").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-relation]");
    if (remove) remove.closest(".relation-row").remove();
  });
  dialog.querySelector("[data-image]").addEventListener("click", async () => {
    const image = await api.chooseCharacterImage();
    if (image) dialog.querySelector('input[name="image"]').value = image;
  });
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
            <strong>${esc(target.name)}</strong><span>${esc(rel.type)}</span>
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
          ${esc(ch.description || "Noch keine Beschreibung.")}
        </div>
        <h3>Notizen</h3>
        <div class="detail-copy">
          ${esc(ch.traits || "Noch keine Eigenschaften oder Notizen.")}
        </div>
        <h3>Beziehungen</h3>
        <div class="relation-list">
          ${relationships ||
          '<span class="small-note">Noch keine Beziehungen festgehalten.</span>'}
        </div>
      </div>
    </div>`,
    async () => {
      dialog.close();
      setTimeout(() => editCharacterForm(ch), 0);
    },
    "Bearbeiten",
  );
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
      relations.push(
        html`<div class="relationship-map-row">
          <span>${esc(source.name)}</span><b>↔</b
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
  state.activeChapter = project.chapters[0]?.id || null;
  toast("Projekt geöffnet.");
  render();
}

document.addEventListener("click", async (event) => {
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
  else if (action === "open-project") void openProject();
  else if (action === "new-chapter") createChapter();
  else if (action === "new-character") editCharacterForm();
  else if (action === "write-chapter") {
    void saveCurrentChapter();
    state.activeChapter = button.dataset.id;
    setPage("writing");
  } else if (action === "open-character") {
    const ch = state.project.characters.find(
      (item) => item.id === button.dataset.id,
    );
    if (ch) openCharacter(ch);
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

function formatText(kind) {
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
void api.currentProject().then((project) => {
  state.project = project;
  state.activeChapter = project?.chapters[0]?.id || null;
  render();
});
