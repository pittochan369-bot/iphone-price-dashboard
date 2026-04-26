const CSV_URL = "https://docs.google.com/spreadsheets/d/1N4rhpLuY9yA-fAL4LP_J7TkO2wP71zgJ9OeuYosZmTA/export?format=csv&gid=0";
const MODELS = ["iPhone 17 Pro Max", "iPhone 17 Pro", "iPhone 17"];
const CAPACITY_ORDER = ["128GB", "256GB", "512GB", "1TB", "2TB"];
const COLORS = ["#0f766e", "#2563eb", "#9333ea", "#d97706", "#dc2626"];

const state = {
  selectedModel: MODELS[0],
  metric: "buyback",
  data: null
};

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0
});

const shortDate = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric"
});

const parseNumber = (value) => {
  if (!value) return null;
  const normalized = String(value).replace(/[,\s円]/g, "");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

const parseDate = (value) => {
  const match = String(value || "").match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function normalizeRows(rows) {
  const officialPrices = new Map();
  const bySku = new Map();

  rows.slice(1).forEach((row) => {
    const summaryModel = row[8];
    const summaryCapacity = row[9];
    const officialPrice = parseNumber(row[27]);

    if (MODELS.includes(summaryModel) && summaryCapacity && officialPrice !== null) {
      officialPrices.set(`${summaryModel}|${summaryCapacity}`, officialPrice);
    }

    const date = parseDate(row[0]);
    const model = row[2];
    const capacity = row[3];
    const buyback = parseNumber(row[5]);

    if (!date || !MODELS.includes(model) || !capacity || buyback === null) return;

    const key = `${model}|${capacity}`;
    if (!bySku.has(key)) {
      bySku.set(key, {
        key,
        model,
        capacity,
        official: null,
        points: []
      });
    }

    bySku.get(key).points.push({
      date,
      dateKey: row[0],
      buyback,
      official: null,
      profit: null
    });
  });

  const skus = [...bySku.values()].map((sku) => {
    const official = officialPrices.get(sku.key);
    const points = sku.points
      .sort((a, b) => a.date - b.date)
      .map((point) => ({
        ...point,
        official,
        profit: official === undefined ? null : point.buyback - official
      }));

    return {
      ...sku,
      official,
      points
    };
  });

  skus.sort((a, b) => {
    const modelDiff = MODELS.indexOf(a.model) - MODELS.indexOf(b.model);
    if (modelDiff !== 0) return modelDiff;
    return CAPACITY_ORDER.indexOf(a.capacity) - CAPACITY_ORDER.indexOf(b.capacity);
  });

  return {
    skus,
    latestDate: skus.flatMap((sku) => sku.points).sort((a, b) => b.date - a.date)[0]?.date
  };
}

async function loadCsv() {
  const liveUrl = `${CSV_URL}&cacheBust=${Date.now()}`;
  try {
    const response = await fetch(liveUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    document.getElementById("sourceStatus").textContent = "Google Sheet同期";
    return response.text();
  } catch (error) {
    const response = await fetch("sheet.csv");
    if (!response.ok) throw error;
    document.getElementById("sourceStatus").textContent = "ローカルCSV";
    return response.text();
  }
}

function latestPoint(sku) {
  return sku.points[sku.points.length - 1];
}

function maxPoint(sku) {
  return sku.points.reduce((best, point) => (
    point.buyback >= best.buyback ? point : best
  ), sku.points[0]);
}

function metricLabel() {
  return state.metric === "buyback" ? "買取価格" : "差益";
}

function renderTabs() {
  const modelTabs = document.getElementById("modelTabs");
  modelTabs.innerHTML = MODELS.map((model) => (
    `<button type="button" class="${model === state.selectedModel ? "active" : ""}" data-model="${model}">${model}</button>`
  )).join("");

  modelTabs.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedModel = button.dataset.model;
      render();
    });
  });

  document.querySelectorAll("#metricTabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.metric === state.metric);
    button.onclick = () => {
      state.metric = button.dataset.metric;
      render();
    };
  });
}

function selectedSkus() {
  return state.data.skus.filter((sku) => sku.model === state.selectedModel);
}

function renderSummary(skus) {
  const cards = document.getElementById("summaryCards");
  cards.innerHTML = skus.map((sku) => {
    const latest = latestPoint(sku);
    const max = maxPoint(sku);
    const profitClass = latest.profit >= 0 ? "positive" : "negative";
    const maxProfitClass = max.profit >= 0 ? "positive" : "negative";

    return `
      <article class="card">
        <h3>${sku.capacity}</h3>
        <dl>
          <dt>買取価格</dt><dd>${yen.format(latest.buyback)}</dd>
          <dt>購入価格</dt><dd>${sku.official ? yen.format(sku.official) : "--"}</dd>
          <dt>差益</dt><dd class="${profitClass}">${latest.profit === null ? "--" : yen.format(latest.profit)}</dd>
          <dt>最大値</dt><dd><span class="valueLine">${yen.format(max.buyback)}<small>${shortDate.format(max.date)}</small></span></dd>
          <dt>最大値差益</dt><dd class="${maxProfitClass}">${max.profit === null ? "--" : yen.format(max.profit)}</dd>
        </dl>
      </article>
    `;
  }).join("");
}

function renderTable(skus) {
  const tbody = document.getElementById("priceRows");
  tbody.innerHTML = skus.map((sku) => {
    const latest = latestPoint(sku);
    const max = maxPoint(sku);
    const profitClass = latest.profit >= 0 ? "positive" : "negative";
    const maxProfitClass = max.profit >= 0 ? "positive" : "negative";

    return `
      <tr>
        <td data-label="機種">${sku.model}</td>
        <td data-label="容量">${sku.capacity}</td>
        <td data-label="最新日">${shortDate.format(latest.date)}</td>
        <td data-label="買取価格">${yen.format(latest.buyback)}</td>
        <td data-label="購入価格">${sku.official ? yen.format(sku.official) : "--"}</td>
        <td data-label="差益" class="${profitClass}">${latest.profit === null ? "--" : yen.format(latest.profit)}</td>
        <td data-label="最大値"><span class="valueLine">${yen.format(max.buyback)}<small>${shortDate.format(max.date)}</small></span></td>
        <td data-label="最大値差益" class="${maxProfitClass}">${max.profit === null ? "--" : yen.format(max.profit)}</td>
      </tr>
    `;
  }).join("");
}

function renderLegend(skus) {
  document.getElementById("legend").innerHTML = skus.map((sku, index) => (
    `<span><i style="background:${COLORS[index % COLORS.length]}"></i>${sku.capacity}</span>`
  )).join("");
}

function renderChart(skus) {
  const svg = document.getElementById("priceChart");
  const rect = svg.getBoundingClientRect();
  const width = Math.max(320, rect.width || 900);
  const height = Math.max(280, rect.height || 390);
  const isNarrow = width < 520;
  const margin = isNarrow
    ? { top: 22, right: 12, bottom: 40, left: 58 }
    : { top: 26, right: 26, bottom: 46, left: 74 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const allPoints = skus.flatMap((sku) => sku.points.filter((point) => point[state.metric] !== null));
  const dates = [...new Map(allPoints.map((point) => [point.dateKey, point.date])).entries()]
    .sort((a, b) => a[1] - b[1]);
  const values = allPoints.map((point) => point[state.metric]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = Math.max(1000, Math.round((rawMax - rawMin) * 0.12));
  const min = Math.floor((rawMin - pad) / 1000) * 1000;
  const max = Math.ceil((rawMax + pad) / 1000) * 1000;
  const yTicks = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index / 4));

  const x = (dateKey) => {
    const index = dates.findIndex(([key]) => key === dateKey);
    return margin.left + (dates.length <= 1 ? innerWidth / 2 : (index / (dates.length - 1)) * innerWidth);
  };

  const y = (value) => margin.top + innerHeight - ((value - min) / (max - min || 1)) * innerHeight;

  const grid = yTicks.map((tick) => {
    const yy = y(tick);
    return `<line x1="${margin.left}" y1="${yy}" x2="${width - margin.right}" y2="${yy}" stroke="#e6ebf1" />
      <text x="${margin.left - 10}" y="${yy + 4}" text-anchor="end" fill="#657382" font-size="12">${yen.format(tick).replace("￥", "¥")}</text>`;
  }).join("");

  const labelStep = isNarrow ? Math.ceil(dates.length / 5) : 1;
  const xLabels = dates.map(([key, date], index) => {
    if (isNarrow && index % labelStep !== 0 && index !== dates.length - 1) return "";
    const xx = margin.left + (dates.length <= 1 ? innerWidth / 2 : (index / (dates.length - 1)) * innerWidth);
    return `<text x="${xx}" y="${height - 18}" text-anchor="middle" fill="#657382" font-size="${isNarrow ? 11 : 12}">${shortDate.format(date)}</text>`;
  }).join("");

  const lines = skus.map((sku, index) => {
    const points = sku.points
      .filter((point) => point[state.metric] !== null)
      .map((point) => `${x(point.dateKey)},${y(point[state.metric])}`)
      .join(" ");
    const color = COLORS[index % COLORS.length];
    const dots = sku.points
      .filter((point) => point[state.metric] !== null)
      .map((point) => `<circle cx="${x(point.dateKey)}" cy="${y(point[state.metric])}" r="4" fill="${color}"><title>${sku.capacity} ${shortDate.format(point.date)} ${yen.format(point[state.metric])}</title></circle>`)
      .join("");
    return `<polyline fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" points="${points}" />${dots}`;
  }).join("");

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="#fbfcfe" />
    ${grid}
    <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#b8c2cc" />
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#b8c2cc" />
    ${xLabels}
    ${lines}
  `;
}

function render() {
  const skus = selectedSkus();
  renderTabs();
  document.getElementById("chartTitle").textContent = `${state.selectedModel} / ${metricLabel()}`;
  renderSummary(skus);
  renderLegend(skus);
  renderChart(skus);
  renderTable(skus);
}

async function boot() {
  try {
    const csv = await loadCsv();
    state.data = normalizeRows(parseCsv(csv));
    document.getElementById("latestDate").textContent = state.data.latestDate
      ? shortDate.format(state.data.latestDate)
      : "--";
    render();
    window.addEventListener("resize", () => renderChart(selectedSkus()));
  } catch (error) {
    document.getElementById("sourceStatus").textContent = "読み込み失敗";
    document.getElementById("summaryCards").innerHTML = `<article class="card"><h3>データを読み込めませんでした</h3><p>${error.message}</p></article>`;
  }
}

boot();
