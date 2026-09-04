/* =========================================================
   Ledger — grade & GPA tracker
   All state lives in localStorage under STORAGE_KEY.
   ========================================================= */

const STORAGE_KEY = "ledger.gpa.v1";

const DEFAULT_SCALE = [
  { letter: "A+", min: 97, points: 4.0 },
  { letter: "A",  min: 93, points: 4.0 },
  { letter: "A-", min: 90, points: 3.7 },
  { letter: "B+", min: 87, points: 3.3 },
  { letter: "B",  min: 83, points: 3.0 },
  { letter: "B-", min: 80, points: 2.7 },
  { letter: "C+", min: 77, points: 2.3 },
  { letter: "C",  min: 73, points: 2.0 },
  { letter: "C-", min: 70, points: 1.7 },
  { letter: "D+", min: 67, points: 1.3 },
  { letter: "D",  min: 65, points: 1.0 },
  { letter: "F",  min: 0,  points: 0.0 },
];

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function defaultState() {
  return {
    scale: DEFAULT_SCALE.map((r) => ({ ...r })),
    classes: [],
    selectedId: null,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed.scale || !parsed.classes) return defaultState();
    return parsed;
  } catch (e) {
    console.error("Ledger: could not read saved data, starting fresh.", e);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Ledger: could not save data.", e);
  }
}

let state = loadState();

/* ---------------- sample data on first run ---------------- */

function seedIfEmpty() {
  if (state.classes.length > 0) return;
  state.classes = [
    {
      id: uid(),
      name: "AP Chemistry",
      credits: 1,
      bonus: 1.0,
      categories: [
        {
          id: uid(),
          name: "Homework",
          weight: 10,
          assignments: [
            { id: uid(), name: "Problem set 1", score: 9, max: 10 },
            { id: uid(), name: "Problem set 2", score: 8, max: 10 },
          ],
        },
        {
          id: uid(),
          name: "Labs",
          weight: 30,
          assignments: [{ id: uid(), name: "Titration lab", score: 27, max: 30 }],
        },
        {
          id: uid(),
          name: "Tests",
          weight: 60,
          assignments: [{ id: uid(), name: "Unit 1 test", score: 84, max: 100 }],
        },
      ],
    },
  ];
  state.selectedId = state.classes[0].id;
  saveState();
}

seedIfEmpty();
if (!state.selectedId && state.classes.length) state.selectedId = state.classes[0].id;

/* ---------------- grade math ---------------- */

function categoryAverage(category) {
  const list = category.assignments.filter(
    (a) => Number.isFinite(a.max) && a.max > 0 && Number.isFinite(a.score)
  );
  if (list.length === 0) return null;
  const total = list.reduce((sum, a) => sum + (a.score / a.max) * 100, 0);
  return total / list.length;
}

/**
 * Overall percent grade for a class, using only categories that
 * currently have assignments, with their weights renormalized
 * to sum to 100. Returns null if no assignments anywhere.
 */
function classGradePercent(cls) {
  const active = cls.categories
    .map((c) => ({ c, avg: categoryAverage(c) }))
    .filter((x) => x.avg !== null && x.c.weight > 0);
  const weightSum = active.reduce((s, x) => s + x.c.weight, 0);
  if (active.length === 0 || weightSum === 0) return null;
  const weighted = active.reduce((s, x) => s + (x.c.weight / weightSum) * x.avg, 0);
  return { percent: weighted, weightUsed: weightSum, totalWeight: totalCategoryWeight(cls) };
}

function totalCategoryWeight(cls) {
  return cls.categories.reduce((s, c) => s + (Number(c.weight) || 0), 0);
}

function scaleSorted() {
  return [...state.scale].sort((a, b) => b.min - a.min);
}

function percentToLetter(percent) {
  if (percent === null) return "—";
  const row = scaleSorted().find((r) => percent >= r.min);
  return row ? row.letter : scaleSorted().at(-1).letter;
}

function percentToGpaPoints(percent) {
  if (percent === null) return null;
  const row = scaleSorted().find((r) => percent >= r.min);
  return row ? row.points : scaleSorted().at(-1).points;
}

/** Lowest percent that achieves at least targetPoints GPA points. */
function gpaPointsToMinPercent(targetPoints) {
  const rows = scaleSorted().slice().reverse(); // ascending by min
  for (const r of rows) {
    if (r.points >= targetPoints) return r.min;
  }
  return 100; // unreachable on this scale
}

function classSummary(cls) {
  const grade = classGradePercent(cls);
  const percent = grade ? grade.percent : null;
  const letter = percentToLetter(percent);
  const gpaPoints = percentToGpaPoints(percent);
  const weightedPoints = gpaPoints === null ? null : gpaPoints + (Number(cls.bonus) || 0);
  return { percent, letter, gpaPoints, weightedPoints, grade };
}

function overallSummary() {
  const rows = state.classes.map((cls) => ({ cls, summary: classSummary(cls) }));
  const graded = rows.filter((r) => r.summary.weightedPoints !== null);
  const totalCredits = graded.reduce((s, r) => s + (Number(r.cls.credits) || 0), 0);
  let weightedGpa = null;
  let unweightedGpa = null;
  if (graded.length && totalCredits > 0) {
    weightedGpa =
      graded.reduce((s, r) => s + r.summary.weightedPoints * (Number(r.cls.credits) || 0), 0) /
      totalCredits;
    unweightedGpa =
      graded.reduce((s, r) => s + r.summary.gpaPoints * (Number(r.cls.credits) || 0), 0) /
      totalCredits;
  }
  return { rows, totalCredits, weightedGpa, unweightedGpa };
}

/* ---------------- goal solving ---------------- */

/**
 * Within a class, find the average % needed in one target category so the
 * class's overall percent grade hits targetPercent, assuming every other
 * category stays at its current average (or 0 if it has no data yet).
 */
function solveCategoryTarget(cls, targetCategoryId, targetPercent) {
  const totalWeight = totalCategoryWeight(cls);
  if (totalWeight <= 0) return { error: "This class has no category weights set yet." };
  const target = cls.categories.find((c) => c.id === targetCategoryId);
  if (!target || target.weight <= 0) return { error: "Pick a category with a weight above 0." };

  let otherContribution = 0;
  for (const c of cls.categories) {
    if (c.id === targetCategoryId) continue;
    const avg = categoryAverage(c) ?? 0;
    otherContribution += (c.weight / totalWeight) * avg;
  }
  const targetShare = target.weight / totalWeight;
  const required = (targetPercent - otherContribution) / targetShare;
  return { required, otherContribution, targetShare };
}

function solveOverallClassTarget(targetOverallGpa, targetClassId) {
  const { rows, totalCredits } = overallSummary();
  const targetRow = rows.find((r) => r.cls.id === targetClassId);
  if (!targetRow) return { error: "Pick a class." };
  const targetCredits = Number(targetRow.cls.credits) || 0;
  if (targetCredits <= 0) return { error: "That class needs credits greater than 0." };

  let otherWeighted = 0;
  let otherCredits = 0;
  for (const r of rows) {
    if (r.cls.id === targetClassId) continue;
    const pts = r.summary.weightedPoints ?? 0;
    const credits = Number(r.cls.credits) || 0;
    otherWeighted += pts * credits;
    otherCredits += credits;
  }
  const totalCreditsWithTarget = otherCredits + targetCredits;
  const requiredWeightedPoints =
    (targetOverallGpa * totalCreditsWithTarget - otherWeighted) / targetCredits;
  return { requiredWeightedPoints, otherCredits, totalCreditsWithTarget };
}

/* ---------------- rendering ---------------- */

const el = {
  classList: document.getElementById("class-list"),
  classPanel: document.getElementById("class-panel"),
  emptyState: document.getElementById("empty-state"),
  sealValue: document.getElementById("seal-value"),
  overallBody: document.getElementById("overall-table-body"),
  overallCredits: document.getElementById("overall-credits"),
  overallGpaCell: document.getElementById("overall-gpa-cell"),
  overallGoalClass: document.getElementById("overall-goal-class"),
  overallGoalTarget: document.getElementById("overall-goal-target"),
  overallGoalResult: document.getElementById("overall-goal-result"),
};

function fmtPct(v) {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : `${v.toFixed(1)}%`;
}
function fmtGpa(v) {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(2);
}

function renderAll() {
  renderClassList();
  renderClassPanel();
  renderOverall();
  renderSeal();
  saveState();
}

function renderSeal() {
  const { weightedGpa } = overallSummary();
  el.sealValue.textContent = fmtGpa(weightedGpa);
}

function renderClassList() {
  el.classList.innerHTML = "";
  for (const cls of state.classes) {
    const summary = classSummary(cls);
    const li = document.createElement("li");
    li.className = "class-list-item" + (cls.id === state.selectedId ? " active" : "");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "class-list-btn";
    btn.innerHTML = `<span class="class-list-name">${escapeHtml(cls.name || "Untitled class")}</span><span class="class-list-grade">${fmtPct(summary.percent)}</span>`;
    btn.addEventListener("click", () => {
      state.selectedId = cls.id;
      renderAll();
    });
    li.appendChild(btn);
    el.classList.appendChild(li);
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function renderClassPanel() {
  const cls = state.classes.find((c) => c.id === state.selectedId);
  el.classPanel.innerHTML = "";
  if (!cls) {
    const div = document.createElement("div");
    div.className = "empty-state";
    div.innerHTML = `<p>No class selected.</p><p class="empty-hint">Add a class on the left, or select one, to start filling in the ledger.</p>`;
    el.classPanel.appendChild(div);
    return;
  }

  const summary = classSummary(cls);
  const totalWeight = totalCategoryWeight(cls);

  const panel = document.createElement("div");
  panel.innerHTML = `
    <div class="class-header">
      <input class="class-title-input" id="cls-name" value="${escapeHtml(cls.name)}" aria-label="Class name">
      <div class="class-meta">
        <label class="field-inline">Credits
          <input type="number" step="0.5" min="0" id="cls-credits" value="${cls.credits}">
        </label>
        <label class="field-inline">GPA weight bonus
          <input type="number" step="0.1" id="cls-bonus" value="${cls.bonus}">
        </label>
      </div>
      <button class="btn-remove-class" id="cls-remove" type="button">Remove class</button>
    </div>

    <div class="stat-row">
      <div class="stat"><div class="stat-label">Current grade</div><div class="stat-value">${fmtPct(summary.percent)}</div></div>
      <div class="stat"><div class="stat-label">Letter</div><div class="stat-value">${summary.letter}</div></div>
      <div class="stat"><div class="stat-label">GPA points</div><div class="stat-value">${fmtGpa(summary.gpaPoints)}</div></div>
      <div class="stat"><div class="stat-label">Weighted GPA</div><div class="stat-value accent">${fmtGpa(summary.weightedPoints)}</div></div>
    </div>

    <div class="categories-head">
      <h3>Categories</h3>
      <span class="weight-total ${totalWeight !== 100 ? "warn" : ""}">${totalWeight}% of 100% assigned</span>
    </div>
    <div id="categories-host"></div>
    <button class="btn-add-category" id="add-category" type="button">+ Add category</button>

    <div class="goal-box">
      <h3>What score do I need?</h3>
      <p class="section-hint">Pick a category, set your target grade for this class, and see what average that category needs (assumes every other category stays where it is now).</p>
      <div class="goal-row">
        <label>Category
          <select id="goal-category"></select>
        </label>
        <label>Target for class
          <input type="text" id="goal-target" placeholder="e.g. 92 or A- or 3.7 gpa">
        </label>
        <button class="btn-solve" id="goal-solve" type="button">Solve</button>
      </div>
      <p class="goal-result" id="goal-result"></p>
    </div>
  `;
  el.classPanel.appendChild(panel);

  // categories
  const host = panel.querySelector("#categories-host");
  for (const cat of cls.categories) {
    host.appendChild(renderCategoryBlock(cls, cat));
  }

  // goal category options
  const goalCategorySelect = panel.querySelector("#goal-category");
  for (const cat of cls.categories) {
    const opt = document.createElement("option");
    opt.value = cat.id;
    opt.textContent = `${cat.name} (${cat.weight}%)`;
    goalCategorySelect.appendChild(opt);
  }

  // header field events
  panel.querySelector("#cls-name").addEventListener("change", (e) => {
    cls.name = e.target.value;
    renderAll();
  });
  panel.querySelector("#cls-credits").addEventListener("change", (e) => {
    cls.credits = parseFloat(e.target.value) || 0;
    renderAll();
  });
  panel.querySelector("#cls-bonus").addEventListener("change", (e) => {
    cls.bonus = parseFloat(e.target.value) || 0;
    renderAll();
  });
  panel.querySelector("#cls-remove").addEventListener("click", () => {
    if (!confirm(`Remove "${cls.name}"? This can't be undone.`)) return;
    state.classes = state.classes.filter((c) => c.id !== cls.id);
    state.selectedId = state.classes[0]?.id || null;
    renderAll();
  });
  panel.querySelector("#add-category").addEventListener("click", () => {
    cls.categories.push({ id: uid(), name: "New category", weight: 0, assignments: [] });
    renderAll();
  });

  // goal solve
  panel.querySelector("#goal-solve").addEventListener("click", () => {
    const catId = goalCategorySelect.value;
    const raw = panel.querySelector("#goal-target").value.trim();
    const resultEl = panel.querySelector("#goal-result");
    const targetPercent = parseGoalInput(raw);
    if (catId === undefined || catId === "" || cls.categories.length === 0) {
      resultEl.textContent = "Add a category first.";
      resultEl.classList.add("warn");
      return;
    }
    if (targetPercent === null) {
      resultEl.textContent = "Enter a target like 92, A-, or 3.7 gpa.";
      resultEl.classList.add("warn");
      return;
    }
    const res = solveCategoryTarget(cls, catId, targetPercent);
    if (res.error) {
      resultEl.textContent = res.error;
      resultEl.classList.add("warn");
      return;
    }
    resultEl.classList.remove("warn");
    const cat = cls.categories.find((c) => c.id === catId);
    if (res.required > 100) {
      resultEl.textContent = `Not reachable through "${cat.name}" alone — you'd need ${res.required.toFixed(1)}% there, above the 100% ceiling.`;
      resultEl.classList.add("warn");
    } else if (res.required < 0) {
      resultEl.textContent = `Already on track — even 0% in "${cat.name}" would clear that target.`;
    } else {
      resultEl.textContent = `You need about ${res.required.toFixed(1)}% average in "${cat.name}" to reach that target.`;
    }
  });
}

function parseGoalInput(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  const gpaMatch = lower.match(/^(\d+(\.\d+)?)\s*gpa$/);
  if (gpaMatch) return gpaPointsToMinPercent(parseFloat(gpaMatch[1]));
  const letterRow = scaleSorted().find((r) => r.letter.toLowerCase() === lower);
  if (letterRow) return letterRow.min;
  const num = parseFloat(lower.replace("%", ""));
  if (Number.isFinite(num)) return num;
  return null;
}

function renderCategoryBlock(cls, cat) {
  const wrap = document.createElement("div");
  wrap.className = "category-block";
  const avg = categoryAverage(cat);
  wrap.innerHTML = `
    <div class="category-row">
      <input class="category-name-input" value="${escapeHtml(cat.name)}" aria-label="Category name">
      <span class="category-weight">
        <input type="number" min="0" max="100" step="1" value="${cat.weight}" aria-label="Category weight percent">%
      </span>
      <span class="category-avg">${fmtPct(avg)}</span>
      <button class="category-toggle" type="button">${cat.assignments.length} item${cat.assignments.length === 1 ? "" : "s"}</button>
      <button class="category-remove" type="button" aria-label="Remove category">✕ remove</button>
    </div>
    <div class="assignments" hidden></div>
  `;

  const nameInput = wrap.querySelector(".category-name-input");
  const weightInput = wrap.querySelector('input[type="number"]');
  const toggleBtn = wrap.querySelector(".category-toggle");
  const removeBtn = wrap.querySelector(".category-remove");
  const assignmentsHost = wrap.querySelector(".assignments");

  nameInput.addEventListener("change", (e) => {
    cat.name = e.target.value;
    renderAll();
  });
  weightInput.addEventListener("change", (e) => {
    cat.weight = Math.max(0, Math.min(100, parseFloat(e.target.value) || 0));
    renderAll();
  });
  removeBtn.addEventListener("click", () => {
    cls.categories = cls.categories.filter((c) => c.id !== cat.id);
    renderAll();
  });
  toggleBtn.addEventListener("click", () => {
    const hidden = assignmentsHost.hasAttribute("hidden");
    if (hidden) assignmentsHost.removeAttribute("hidden");
    else assignmentsHost.setAttribute("hidden", "");
  });

  for (const a of cat.assignments) {
    assignmentsHost.appendChild(renderAssignmentRow(cls, cat, a));
  }
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn-add-assignment";
  addBtn.textContent = "+ Add assignment";
  addBtn.addEventListener("click", () => {
    cat.assignments.push({ id: uid(), name: "New item", score: 0, max: 100 });
    assignmentsHost.removeAttribute("hidden");
    renderAll();
  });
  assignmentsHost.appendChild(addBtn);

  return wrap;
}

function renderAssignmentRow(cls, cat, a) {
  const row = document.createElement("div");
  row.className = "assignment-row";
  row.innerHTML = `
    <input class="name-input" value="${escapeHtml(a.name)}" aria-label="Assignment name">
    <input type="number" step="0.5" value="${a.score}" aria-label="Score earned">
    <span class="assignment-slash">/</span>
    <input type="number" step="0.5" value="${a.max}" aria-label="Score possible">
    <button class="assignment-remove" type="button" aria-label="Remove assignment">✕</button>
  `;
  const [nameInput, scoreInput, maxInput] = row.querySelectorAll("input");
  const removeBtn = row.querySelector(".assignment-remove");

  nameInput.addEventListener("change", (e) => {
    a.name = e.target.value;
    renderAll();
  });
  scoreInput.addEventListener("change", (e) => {
    a.score = parseFloat(e.target.value);
    renderAll();
  });
  maxInput.addEventListener("change", (e) => {
    a.max = parseFloat(e.target.value);
    renderAll();
  });
  removeBtn.addEventListener("click", () => {
    cat.assignments = cat.assignments.filter((x) => x.id !== a.id);
    renderAll();
  });

  return row;
}

function renderOverall() {
  const { rows, totalCredits, weightedGpa } = overallSummary();
  el.overallBody.innerHTML = "";
  for (const { cls, summary } of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(cls.name || "Untitled class")}</td>
      <td>${cls.credits}</td>
      <td>${fmtPct(summary.percent)}</td>
      <td>${summary.letter}</td>
      <td>+${(Number(cls.bonus) || 0).toFixed(1)}</td>
      <td>${fmtGpa(summary.weightedPoints)}</td>
    `;
    el.overallBody.appendChild(tr);
  }
  el.overallCredits.textContent = totalCredits || "—";
  el.overallGpaCell.textContent = fmtGpa(weightedGpa);

  // goal class select
  el.overallGoalClass.innerHTML = "";
  for (const cls of state.classes) {
    const opt = document.createElement("option");
    opt.value = cls.id;
    opt.textContent = cls.name || "Untitled class";
    el.overallGoalClass.appendChild(opt);
  }
}

/* ---------------- global controls ---------------- */

document.getElementById("btn-add-class").addEventListener("click", () => {
  const cls = {
    id: uid(),
    name: "New class",
    credits: 1,
    bonus: 0,
    categories: [
      { id: uid(), name: "Homework", weight: 10, assignments: [] },
      { id: uid(), name: "Projects", weight: 30, assignments: [] },
      { id: uid(), name: "Tests", weight: 60, assignments: [] },
    ],
  };
  state.classes.push(cls);
  state.selectedId = cls.id;
  renderAll();
});

document.getElementById("btn-reset").addEventListener("click", () => {
  if (!confirm("Clear every class and reset the GPA scale? This can't be undone.")) return;
  state = defaultState();
  saveState();
  renderAll();
});

document.getElementById("overall-goal-solve").addEventListener("click", () => {
  const targetVal = parseFloat(el.overallGoalTarget.value);
  const resultEl = el.overallGoalResult;
  if (!Number.isFinite(targetVal)) {
    resultEl.textContent = "Enter a target GPA, like 3.7.";
    resultEl.classList.add("warn");
    return;
  }
  const classId = el.overallGoalClass.value;
  if (!classId) {
    resultEl.textContent = "Add a class first.";
    resultEl.classList.add("warn");
    return;
  }
  const res = solveOverallClassTarget(targetVal, classId);
  resultEl.classList.remove("warn");
  if (res.error) {
    resultEl.textContent = res.error;
    resultEl.classList.add("warn");
    return;
  }
  const cls = state.classes.find((c) => c.id === classId);
  if (res.requiredWeightedPoints > 4.0 + (Number(cls.bonus) || 0) + 1) {
    resultEl.textContent = `Not realistically reachable through "${cls.name}" alone — it would need a weighted GPA of ${res.requiredWeightedPoints.toFixed(2)}.`;
    resultEl.classList.add("warn");
  } else if (res.requiredWeightedPoints <= 0) {
    resultEl.textContent = `Already on track — "${cls.name}" could drop to 0 and you'd still clear that target.`;
  } else {
    const requiredPercentFloor = gpaPointsToMinPercent(res.requiredWeightedPoints - (Number(cls.bonus) || 0));
    resultEl.textContent = `"${cls.name}" needs a weighted GPA of about ${res.requiredWeightedPoints.toFixed(2)} — roughly ${requiredPercentFloor}% or higher, before its weight bonus.`;
  }
});

/* ---------------- GPA scale modal ---------------- */

const scaleModal = document.getElementById("scale-modal-backdrop");
document.getElementById("btn-toggle-scale").addEventListener("click", () => {
  renderScaleTable();
  scaleModal.classList.add("open");
});
document.getElementById("scale-close").addEventListener("click", () => {
  scaleModal.classList.remove("open");
  renderAll();
});
scaleModal.addEventListener("click", (e) => {
  if (e.target === scaleModal) {
    scaleModal.classList.remove("open");
    renderAll();
  }
});
document.getElementById("scale-add-row").addEventListener("click", () => {
  state.scale.push({ letter: "—", min: 0, points: 0 });
  renderScaleTable();
});
document.getElementById("scale-reset-default").addEventListener("click", () => {
  if (!confirm("Reset the GPA scale to the default table?")) return;
  state.scale = DEFAULT_SCALE.map((r) => ({ ...r }));
  renderScaleTable();
});

function renderScaleTable() {
  const body = document.getElementById("scale-table-body");
  body.innerHTML = "";
  scaleSorted().forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input value="${escapeHtml(row.letter)}" data-field="letter"></td>
      <td><input type="number" value="${row.min}" data-field="min"></td>
      <td><input type="number" step="0.1" value="${row.points}" data-field="points"></td>
      <td><button class="assignment-remove" type="button" aria-label="Remove row">✕</button></td>
    `;
    tr.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", () => {
        const field = input.dataset.field;
        row[field] = field === "letter" ? input.value : parseFloat(input.value) || 0;
      });
    });
    tr.querySelector("button").addEventListener("click", () => {
      state.scale = state.scale.filter((r) => r !== row);
      renderScaleTable();
    });
    body.appendChild(tr);
  });
}

/* ---------------- init ---------------- */

renderAll();
