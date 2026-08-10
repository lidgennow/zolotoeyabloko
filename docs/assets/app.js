const numberFormatter = new Intl.NumberFormat("ru-RU");
const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC"
});

const STATUS_COLORS = {
  "запись в клинику": "#72c58d",
  "в работе / переговорах": "#8bb9a0",
  "ОТКАЗ": "#df7d86",
  "ндз финал": "#d6a258",
  "неактуал": "#c3a977",
  "отложенный спрос": "#79aaa6",
  "недозвон": "#679885",
  "дубль": "#8fa69a",
  "Другой город": "#71887d",
  "—": "#536b60"
};

const REFUSAL_COLORS = {
  "Не актуально / не нужно": "#8fbea0",
  "Цена / финансы": "#df7d86",
  "Не оставлял заявку": "#d6a258",
  "Уже лечится": "#75aaa2",
  "Медицинские причины": "#72b58a",
  "Технические/мусор": "#789085",
  "Другое": "#96ab9f"
};

let DATA = null;
let activeMonth = null;
let currentSlice = null;
let previousSlice = null;
let statusChart = null;
let countdownTimer = null;
let toastTimer = null;
let sortState = { key: "total", direction: -1 };

function fmt(value) {
  return numberFormatter.format(Number(value) || 0);
}

function money(value) {
  return value == null ? "—" : fmt(value) + " ₽";
}

function pct(value, base) {
  return base ? (Number(value || 0) / Number(base) * 100).toFixed(1) + "%" : "—";
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(iso) {
  if (!iso) return "—";
  return dateFormatter.format(new Date(iso + "T12:00:00Z"));
}

function formatMoscow(date) {
  return date.toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }) + " МСК";
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toast.classList.remove("visible");
  }, 5000);
}

function renderSkeletons() {
  const cards = Array.from({ length: 8 }, function (_, index) {
    const tone = index === 0 ? " tone-sage" : "";
    return "<div class='kpi-card" + tone + "' aria-hidden='true'>" +
      "<div class='skeleton skeleton-line' style='width:52%'></div>" +
      "<div class='skeleton skeleton-value'></div>" +
      "<div class='skeleton skeleton-line' style='width:72%;margin-top:18px'></div>" +
      "</div>";
  });
  document.getElementById("kpi").innerHTML = cards.join("");
}

function getMonthMeta(key) {
  return DATA.months.find(function (month) {
    return month.key === key;
  });
}

function getPreviousMonth(key) {
  const index = DATA.months.findIndex(function (month) {
    return month.key === key;
  });
  if (index <= 0) return null;
  const meta = DATA.months[index - 1];
  return { meta: meta, slice: DATA.by_month[meta.key] };
}

function isPartialMonth(key) {
  if (!key || key === "all" || DATA.period.date_max.slice(0, 7) !== key) return false;
  const maxDate = new Date(DATA.period.date_max + "T12:00:00Z");
  const lastDay = new Date(Date.UTC(maxDate.getUTCFullYear(), maxDate.getUTCMonth() + 1, 0)).getUTCDate();
  return maxDate.getUTCDate() < lastDay;
}

function renderMonthButtons() {
  const buttons = [{ key: "all", label: "Весь период", count: DATA.all.kpi.total }].concat(
    DATA.months.map(function (month) {
      return {
        key: month.key,
        label: month.label.split(" ")[0],
        count: month.count
      };
    })
  );

  document.getElementById("monthFilter").innerHTML = buttons.map(function (button) {
    return "<button type='button' data-key='" + escapeHtml(button.key) + "' aria-pressed='false'>" +
      escapeHtml(button.label) +
      "<span class='month-count'>" + fmt(button.count) + "</span>" +
      "</button>";
  }).join("");

  document.querySelectorAll("#monthFilter button").forEach(function (button) {
    button.addEventListener("click", function () {
      setActive(button.dataset.key);
    });
  });
}

function setActive(key) {
  const validKeys = ["all"].concat(DATA.months.map(function (month) { return month.key; }));
  activeMonth = validKeys.includes(key) ? key : DATA.months[DATA.months.length - 1].key;
  localStorage.setItem("goldenAppleDashboardMonth", activeMonth);

  document.querySelectorAll("#monthFilter button").forEach(function (button) {
    const selected = button.dataset.key === activeMonth;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  currentSlice = activeMonth === "all" ? DATA.all : DATA.by_month[activeMonth];
  const previous = activeMonth === "all" ? null : getPreviousMonth(activeMonth);
  previousSlice = previous ? previous.slice : null;
  renderDashboard(previous ? previous.meta : null);
}

function renderDashboard(previousMeta) {
  renderHero(previousMeta);
  renderKpis(previousMeta);
  renderMonthComparison(previousMeta);
  renderFunnel();
  renderStatus();
  renderOperatorHeatmap();
  renderOperators();
  renderAppointments();
  renderRefusals();
}

function renderHero(previousMeta) {
  const kpi = currentSlice.kpi;
  const meta = activeMonth === "all" ? null : getMonthMeta(activeMonth);
  const partial = isPartialMonth(activeMonth);
  const periodLabel = meta ? meta.label : "Весь период";
  const comparison = previousMeta ? "Сравнение с " + previousMeta.label.toLowerCase() : "Без сравнения";

  document.getElementById("activePeriodLabel").textContent = periodLabel;
  document.getElementById("heroSubtitle").textContent = meta
    ? "Путь заявки за " + meta.label.toLowerCase() + (partial ? " · месяц ещё идёт" : "")
    : "Сводный путь заявки за весь доступный период";
  document.getElementById("period").textContent = activeMonth === "all"
    ? "Данные с " + formatDate(DATA.period.date_min) + " по " + formatDate(DATA.period.date_max)
    : (partial ? "Данные по " + formatDate(DATA.period.date_max) : "Полный календарный месяц");

  document.getElementById("comparisonNote").textContent = partial
    ? comparison + " · текущий месяц неполный"
    : comparison;

  animateNumber(document.getElementById("heroTotal"), kpi.total);
  animateNumber(document.getElementById("heroPcp"), kpi.pcp);
  animateNumber(document.getElementById("heroZapis"), kpi.zapis);
  animateNumber(document.getElementById("heroPrishel"), kpi.prishel);

  document.getElementById("heroTotalNote").textContent = previousSlice
    ? plainDelta(kpi.total, previousSlice.kpi.total) + " к прошлому месяцу"
    : "входящий поток";
  document.getElementById("heroPcpNote").textContent = pct(kpi.pcp, kpi.total) + " от заявок";
  document.getElementById("heroZapisNote").textContent = pct(kpi.zapis, kpi.pcp) + " от ПЦП";
  document.getElementById("heroPrishelNote").textContent = pct(kpi.prishel, kpi.zapis) + " от записей";
}

function plainDelta(current, previous) {
  if (previous == null || previous === 0) return "нет базы";
  const change = (current - previous) / previous * 100;
  if (Math.abs(change) < 0.05) return "без изменений";
  return (change > 0 ? "+" : "−") + Math.abs(change).toFixed(0) + "%";
}

function trendHtml(current, previous, options) {
  if (!previousSlice || previous == null) return "";
  const settings = options || {};
  if (previous === 0) {
    return "<span class='trend neutral'>новое</span>";
  }
  const change = (current - previous) / previous * 100;
  if (Math.abs(change) < 0.05) {
    return "<span class='trend neutral'>0%</span>";
  }
  const direction = change > 0 ? "↑" : "↓";
  const isBetter = settings.neutral
    ? null
    : (settings.lowerBetter ? change < 0 : change > 0);
  const className = isBetter == null ? "neutral" : (isBetter ? "good" : "bad");
  return "<span class='trend " + className + "'>" + direction + " " + Math.abs(change).toFixed(0) + "%</span>";
}

function renderKpis() {
  const kpi = currentSlice.kpi;
  const previous = previousSlice ? previousSlice.kpi : {};
  const cards = [
    {
      label: "Всего заявок",
      value: kpi.total,
      previous: previous.total,
      suffix: "",
      sub: "Входящий поток",
      progress: null,
      tone: "tone-sage"
    },
    {
      label: "Квалифицированы (ПЦП)",
      value: kpi.pcp,
      previous: previous.pcp,
      suffix: "",
      sub: pct(kpi.pcp, kpi.total) + " от заявок",
      progress: kpi.conv_pcp,
      tone: ""
    },
    {
      label: "Записаны в клинику",
      value: kpi.zapis,
      previous: previous.zapis,
      suffix: "",
      sub: pct(kpi.zapis, kpi.pcp) + " от ПЦП",
      progress: kpi.conv_zapis_from_pcp,
      tone: "tone-mint"
    },
    {
      label: "Пришли на приём",
      value: kpi.prishel,
      previous: previous.prishel,
      suffix: "",
      sub: pct(kpi.prishel, kpi.zapis) + " от записей",
      progress: kpi.conv_prishel_from_zapis,
      tone: ""
    },
    {
      label: "Активные записи",
      value: kpi.active_zapis,
      previous: previous.active_zapis,
      suffix: "",
      sub: "Без отметки явки",
      progress: null,
      tone: ""
    },
    {
      label: "План с депозитом",
      value: kpi.plan_with_dep_sum,
      previous: previous.plan_with_dep_sum,
      suffix: " ₽",
      sub: fmt(kpi.plan_with_dep_count) + " планов",
      progress: null,
      tone: "tone-mint"
    },
    {
      label: "Рекламный расход",
      value: kpi.ad_spend,
      previous: previous.ad_spend,
      suffix: " ₽",
      sub: kpi.ad_spend == null ? "Нет данных за месяц" : "По данным таблицы",
      progress: null,
      neutral: true,
      tone: "tone-cream"
    },
    {
      label: "ДРР",
      value: kpi.drr,
      previous: previous.drr,
      suffix: "%",
      decimals: 1,
      sub: "Расход / план с депозитом",
      progress: kpi.drr == null ? null : Math.min(kpi.drr, 100),
      lowerBetter: true,
      tone: kpi.drr != null && kpi.drr <= 20 ? "tone-sage" : "tone-cream"
    }
  ];

  document.getElementById("kpi").innerHTML = cards.map(function (card) {
    const noData = card.value == null;
    const value = noData ? "—" : fmt(card.value) + card.suffix;
    const progress = card.progress == null
      ? ""
      : "<div class='micro-progress' aria-hidden='true'><span data-width='" + Math.min(Number(card.progress) || 0, 100) + "'></span></div>";
    const trend = noData ? "" : trendHtml(Number(card.value), Number(card.previous), card);
    const dataAttributes = noData
      ? ""
      : " data-value='" + Number(card.value) + "' data-suffix='" + escapeHtml(card.suffix) + "' data-decimals='" + (card.decimals || 0) + "'";
    return "<article class='kpi-card " + card.tone + "'>" +
      "<div class='kpi-label'>" + escapeHtml(card.label) + "</div>" +
      "<strong class='kpi-value'" + dataAttributes + ">" + value + "</strong>" +
      "<div class='kpi-subline'><span>" + escapeHtml(card.sub) + "</span>" + trend + "</div>" +
      progress +
      "</article>";
  }).join("");

  document.querySelectorAll(".kpi-value[data-value]").forEach(function (element) {
    animateNumber(
      element,
      Number(element.dataset.value),
      element.dataset.suffix,
      Number(element.dataset.decimals)
    );
  });

  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      document.querySelectorAll(".micro-progress span").forEach(function (bar) {
        bar.style.width = bar.dataset.width + "%";
      });
    });
  });
}

function comparisonDelta(current, previous, isRate) {
  const difference = Number(current || 0) - Number(previous || 0);
  if (Math.abs(difference) < 0.05) {
    return { label: "0", className: "neutral" };
  }

  if (isRate) {
    return {
      label: (difference > 0 ? "+" : "−") + Math.abs(difference).toFixed(1) + " п.п.",
      className: difference > 0 ? "good" : "bad"
    };
  }

  if (!previous) {
    return {
      label: current ? "новое" : "0",
      className: current ? "good" : "neutral"
    };
  }

  const percentChange = difference / Number(previous) * 100;
  return {
    label: (percentChange > 0 ? "+" : "−") + Math.abs(percentChange).toFixed(0) + "%",
    className: percentChange > 0 ? "good" : "bad"
  };
}

function renderMonthComparison(previousMeta) {
  const head = document.getElementById("comparisonHead");
  const container = document.getElementById("monthComparison");
  const summary = document.getElementById("monthComparisonSummary");

  if (!previousSlice || !previousMeta) {
    head.innerHTML = "";
    summary.textContent = activeMonth === "all"
      ? "Выберите конкретный месяц"
      : "Нет данных за предыдущий месяц";
    container.innerHTML = "<div class='empty-state'><div><strong>Сравнение пока недоступно</strong>Выберите месяц, перед которым есть данные</div></div>";
    return;
  }

  const currentMeta = getMonthMeta(activeMonth);
  const currentKpi = currentSlice.kpi;
  const previousKpi = previousSlice.kpi;
  const partial = isPartialMonth(activeMonth);
  const metrics = [
    { label: "Заявки", note: "входящий поток", current: currentKpi.total, previous: previousKpi.total },
    { label: "ПЦП", note: "квалифицированы", current: currentKpi.pcp, previous: previousKpi.pcp },
    { label: "Записи", note: "записаны в клинику", current: currentKpi.zapis, previous: previousKpi.zapis },
    { label: "Приёмы", note: "пришли на приём", current: currentKpi.prishel, previous: previousKpi.prishel },
    { label: "ПЦП → запись", note: "конверсия", current: currentKpi.conv_zapis_from_pcp, previous: previousKpi.conv_zapis_from_pcp, rate: true },
    { label: "Явка", note: "конверсия", current: currentKpi.conv_prishel_from_zapis, previous: previousKpi.conv_prishel_from_zapis, rate: true }
  ];

  summary.textContent = currentMeta.label + " против " + previousMeta.label.toLowerCase() +
    (partial ? " · текущий месяц неполный" : "");
  head.innerHTML = "<span></span><span>" + escapeHtml(previousMeta.label) +
    "</span><span>Δ</span><span>" + escapeHtml(currentMeta.label) + "</span>";

  container.innerHTML = metrics.map(function (metric) {
    const maximum = metric.rate
      ? 100
      : Math.max(Number(metric.current || 0), Number(metric.previous || 0), 1);
    const previousWidth = Math.min(Number(metric.previous || 0) / maximum * 100, 100);
    const currentWidth = Math.min(Number(metric.current || 0) / maximum * 100, 100);
    const delta = comparisonDelta(metric.current, metric.previous, metric.rate);
    const previousValue = metric.rate ? Number(metric.previous || 0).toFixed(1) + "%" : fmt(metric.previous);
    const currentValue = metric.rate ? Number(metric.current || 0).toFixed(1) + "%" : fmt(metric.current);

    return "<div class='compare-row'>" +
      "<div class='compare-metric'><strong>" + escapeHtml(metric.label) + "</strong><small>" + escapeHtml(metric.note) + "</small></div>" +
      "<div class='compare-side previous'><div class='compare-track'><span class='compare-fill' data-width='" + previousWidth.toFixed(2) +
        "'></span><span class='compare-value'>" + previousValue + "</span></div></div>" +
      "<div class='compare-delta " + delta.className + "'>" + delta.label + "</div>" +
      "<div class='compare-side current'><div class='compare-track'><span class='compare-fill' data-width='" + currentWidth.toFixed(2) +
        "'></span><span class='compare-value'>" + currentValue + "</span></div></div>" +
      "</div>";
  }).join("");

  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      document.querySelectorAll(".compare-fill").forEach(function (bar) {
        bar.style.width = bar.dataset.width + "%";
      });
    });
  });
}

function animateNumber(element, target, suffix, decimals) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ending = suffix || "";
  const precision = decimals || 0;
  if (target == null || Number.isNaN(Number(target))) {
    element.textContent = "—";
    return;
  }
  if (reduceMotion) {
    element.textContent = Number(target).toLocaleString("ru-RU", {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision
    }) + ending;
    return;
  }
  const duration = 650;
  const start = performance.now();
  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Number(target) * eased;
    element.textContent = value.toLocaleString("ru-RU", {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision
    }) + ending;
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderFunnel() {
  const kpi = currentSlice.kpi;
  const stages = [
    { label: "Всего заявок", note: "входящий поток", value: kpi.total, base: kpi.total },
    { label: "Квалифицированы (ПЦП)", note: "из всех заявок", value: kpi.pcp, base: kpi.total },
    { label: "Записаны в клинику", note: "из квалифицированных", value: kpi.zapis, base: kpi.pcp },
    { label: "Пришли на приём", note: "из записанных", value: kpi.prishel, base: kpi.zapis }
  ];

  document.getElementById("funnel").innerHTML = stages.map(function (stage, index) {
    const width = kpi.total ? Math.max(stage.value / kpi.total * 100, 6) : 0;
    const conversion = index === 0 ? "100%" : pct(stage.value, stage.base);
    return "<div class='funnel-row'>" +
      "<div class='funnel-label'>" + escapeHtml(stage.label) + "<small>" + escapeHtml(stage.note) + "</small></div>" +
      "<div class='funnel-track'><div class='funnel-fill' data-width='" + width.toFixed(2) + "'>" + fmt(stage.value) + "</div></div>" +
      "<div class='funnel-conversion'>" + conversion + "</div>" +
      "</div>";
  }).join("");

  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      document.querySelectorAll(".funnel-fill").forEach(function (bar) {
        bar.style.width = bar.dataset.width + "%";
      });
    });
  });
}

function renderStatus() {
  const entries = Object.entries(currentSlice.status_counts || {}).sort(function (a, b) {
    return b[1] - a[1];
  });
  const total = entries.reduce(function (sum, entry) {
    return sum + Number(entry[1] || 0);
  }, 0);
  const fallbackColors = ["#72b58a", "#8fbea0", "#d2ad70", "#75aaa2", "#879c91"];
  const colors = entries.map(function (entry, index) {
    return STATUS_COLORS[entry[0]] || fallbackColors[index % fallbackColors.length];
  });

  document.getElementById("statusTotal").textContent = fmt(total);
  document.getElementById("statusLegend").innerHTML = entries.map(function (entry, index) {
    return "<div class='legend-row'>" +
      "<span class='legend-dot' style='background:" + colors[index] + "'></span>" +
      "<span title='" + escapeHtml(entry[0]) + "'>" + escapeHtml(entry[0]) + "</span>" +
      "<strong>" + fmt(entry[1]) + " · " + pct(entry[1], total) + "</strong>" +
      "</div>";
  }).join("");

  if (statusChart) {
    statusChart.destroy();
    statusChart = null;
  }
  if (!window.Chart) {
    document.querySelector(".chart-wrap").style.display = "none";
    return;
  }
  document.querySelector(".chart-wrap").style.display = "";
  const chartSurface = getComputedStyle(document.documentElement)
    .getPropertyValue("--surface").trim() || "#13241e";
  statusChart = new Chart(document.getElementById("chStatus"), {
    type: "doughnut",
    data: {
      labels: entries.map(function (entry) { return entry[0]; }),
      datasets: [{
        data: entries.map(function (entry) { return entry[1]; }),
        backgroundColor: colors,
        borderColor: chartSurface,
        borderWidth: 3,
        hoverOffset: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "70%",
      animation: { duration: 650 },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: true,
          callbacks: {
            label: function (context) {
              return " " + fmt(context.raw) + " · " + pct(context.raw, total);
            }
          }
        }
      }
    }
  });
}

function renderOperatorHeatmap() {
  const entries = Object.entries(currentSlice.operator_stats || {}).sort(function (a, b) {
    return Number(b[1].total || 0) - Number(a[1].total || 0);
  });
  const table = document.getElementById("operatorHeatmap");

  if (!entries.length) {
    table.innerHTML = "<tbody><tr><td colspan='6'><div class='empty-state'><div><strong>Нет данных</strong>За выбранный месяц операторы не найдены</div></div></td></tr></tbody>";
    return;
  }

  const definitions = [
    { key: "pcp", label: "ПЦП", value: "pcp", base: "total", lowerBetter: false },
    { key: "zapis", label: "Запись", value: "zapis", base: "pcp", lowerBetter: false },
    { key: "prishel", label: "Явка", value: "prishel", base: "zapis", lowerBetter: false },
    { key: "otval", label: "Отвал", value: "otval", base: "zapis", lowerBetter: true }
  ];

  const ranges = {};
  definitions.forEach(function (definition) {
    const validRates = entries.map(function (entry) {
      const stats = entry[1];
      const base = Number(stats[definition.base] || 0);
      return base >= 5 ? Number(stats[definition.value] || 0) / base * 100 : null;
    }).filter(function (value) { return value != null; });
    ranges[definition.key] = validRates.length
      ? { min: Math.min.apply(null, validRates), max: Math.max.apply(null, validRates) }
      : null;
  });

  const maxWorkload = Math.max.apply(null, entries.map(function (entry) {
    return Number(entry[1].total || 0);
  }).concat([1]));

  function heatCell(stats, definition) {
    const count = Number(stats[definition.value] || 0);
    const base = Number(stats[definition.base] || 0);
    if (!base) {
      return "<td class='heat-cell low-sample' title='Нет базы для расчёта'><strong>—</strong><small>нет базы</small></td>";
    }

    const rate = count / base * 100;
    if (base < 5 || !ranges[definition.key]) {
      return "<td class='heat-cell low-sample' title='Малая выборка: " + fmt(count) + " из " + fmt(base) + "'><strong>" +
        rate.toFixed(1) + "%</strong><small>" + fmt(count) + " из " + fmt(base) + "</small></td>";
    }

    const range = ranges[definition.key];
    let score = range.max === range.min ? 50 : (rate - range.min) / (range.max - range.min) * 100;
    if (definition.lowerBetter) score = 100 - score;
    return "<td class='heat-cell' style='--heat:" + score.toFixed(1) + "' title='" + fmt(count) + " из " + fmt(base) +
      "'><strong>" + rate.toFixed(1) + "%</strong><small>" + fmt(count) + " из " + fmt(base) + "</small></td>";
  }

  const header = "<thead><tr><th scope='col'>Оператор</th><th scope='col'>Нагрузка</th>" +
    definitions.map(function (definition) {
      return "<th scope='col'>" + escapeHtml(definition.label) + "</th>";
    }).join("") + "</tr></thead>";
  const rows = entries.map(function (entry) {
    const name = entry[0] === "—" ? "Без оператора" : entry[0];
    const stats = entry[1];
    const workload = Number(stats.total || 0) / maxWorkload * 100;
    return "<tr><td class='heat-operator'><strong>" + escapeHtml(name || "Без оператора") + "</strong><small>оператор</small></td>" +
      "<td class='workload-cell'><div class='workload-number'><strong>" + fmt(stats.total) + "</strong><small>заявок</small></div>" +
        "<div class='workload-track'><span style='width:" + workload.toFixed(2) + "%'></span></div></td>" +
      definitions.map(function (definition) { return heatCell(stats, definition); }).join("") +
      "</tr>";
  }).join("");

  table.innerHTML = header + "<tbody>" + rows + "</tbody>";
}

function renderOperators() {
  const entries = Object.entries(currentSlice.operator_stats || {});
  const columns = [
    { key: "name", label: "Оператор", numeric: false },
    { key: "total", label: "Заявки", numeric: true },
    { key: "pcp", label: "ПЦП", numeric: true },
    { key: "zapis", label: "Записи", numeric: true },
    { key: "prishel", label: "Пришли", numeric: true },
    { key: "otval", label: "Отвал", numeric: true },
    { key: "active", label: "Активные", numeric: true },
    { key: "plan_with_dep", label: "План + деп.", numeric: true }
  ];

  entries.sort(function (left, right) {
    const leftValue = sortState.key === "name" ? left[0] : Number(left[1][sortState.key] || 0);
    const rightValue = sortState.key === "name" ? right[0] : Number(right[1][sortState.key] || 0);
    if (typeof leftValue === "string") {
      return leftValue.localeCompare(rightValue, "ru") * sortState.direction;
    }
    return (leftValue - rightValue) * sortState.direction;
  });

  const leader = Object.entries(currentSlice.operator_stats || {}).sort(function (a, b) {
    return Number(b[1].zapis || 0) - Number(a[1].zapis || 0);
  })[0];
  document.getElementById("operatorInsight").textContent = leader
    ? fmt(entries.length) + " операторов · цвет — позиция внутри команды"
    : "Нет данных по операторам";

  const header = columns.map(function (column) {
    const active = column.key === sortState.key;
    const ariaSort = active ? (sortState.direction === 1 ? "ascending" : "descending") : "none";
    return "<th scope='col' aria-sort='" + ariaSort + "'" + (column.numeric ? " style='text-align:right'" : "") + ">" +
      "<button class='sort-button' type='button' data-sort='" + column.key + "'>" + escapeHtml(column.label) + "</button>" +
      "</th>";
  }).join("");

  const rows = entries.length ? entries.map(function (entry) {
    const name = entry[0];
    const stats = entry[1];
    const isLeader = leader && name === leader[0] && Number(stats.zapis || 0) > 0;
    return "<tr>" +
      "<td><strong>" + escapeHtml(name || "Без оператора") + "</strong>" + (isLeader ? "<span class='leader-badge'>лидер</span>" : "") + "</td>" +
      "<td class='num'>" + fmt(stats.total) + "</td>" +
      "<td class='num'>" + fmt(stats.pcp) + " <small>" + pct(stats.pcp, stats.total) + "</small></td>" +
      "<td class='num'>" + fmt(stats.zapis) + " <small>" + pct(stats.zapis, stats.pcp) + "</small></td>" +
      "<td class='num metric-good'>" + fmt(stats.prishel) + "</td>" +
      "<td class='num metric-bad'>" + fmt(stats.otval) + " <small>" + pct(stats.otval, stats.zapis) + "</small></td>" +
      "<td class='num metric-warn'>" + fmt(stats.active) + "</td>" +
      "<td class='num metric-good'>" + (stats.plan_with_dep ? money(stats.plan_with_dep) : "—") + "</td>" +
      "</tr>";
  }).join("") : "<tr><td colspan='8'><div class='empty-state'><div><strong>Нет данных</strong>За выбранный месяц операторы не найдены</div></div></td></tr>";

  document.getElementById("ops").innerHTML = "<thead><tr>" + header + "</tr></thead><tbody>" + rows + "</tbody>";
  document.querySelectorAll("#ops [data-sort]").forEach(function (button) {
    button.addEventListener("click", function () {
      const key = button.dataset.sort;
      if (sortState.key === key) {
        sortState.direction *= -1;
      } else {
        sortState.key = key;
        sortState.direction = key === "name" ? 1 : -1;
      }
      renderOperators();
    });
  });
}

function attendancePill(value) {
  if (!value) return "<span class='pill pill-muted'>Без отметки</span>";
  if (value === "Пришел") return "<span class='pill pill-good'>Пришёл</span>";
  if (value === "Не пришел") return "<span class='pill pill-bad'>Не пришёл</span>";
  if (value === "Отмена записи") return "<span class='pill pill-bad'>Отмена</span>";
  if (value === "Перезапись") return "<span class='pill pill-warn'>Перезапись</span>";
  return "<span class='pill pill-muted'>" + escapeHtml(value) + "</span>";
}

function renderAppointments() {
  const query = document.getElementById("appointmentSearch").value.trim().toLocaleLowerCase("ru");
  const attendance = document.getElementById("attendanceFilter").value;
  const appointments = currentSlice.appointments || [];
  const visible = appointments.filter(function (row) {
    const status = row["Явка:"] || "";
    const statusMatch = !attendance || (attendance === "__empty" ? !status : status === attendance);
    if (!statusMatch) return false;
    if (!query) return true;
    const searchable = [
      row["Имя:"],
      row["Телефон:"],
      row["Имя оператора, взявшего в работу"],
      row["Комментарии:"],
      row["Дата записи"]
    ].join(" ").toLocaleLowerCase("ru");
    return searchable.includes(query);
  });

  document.getElementById("apptCnt").textContent = query || attendance
    ? "— " + fmt(visible.length) + " из " + fmt(appointments.length)
    : "— " + fmt(appointments.length);

  const rows = visible.length ? visible.map(function (row) {
    return "<tr>" +
      "<td class='patient-cell'><strong>" + escapeHtml(row["Имя:"] || "Без имени") + "</strong><small>" + escapeHtml(row["Телефон:"] || "") + "</small></td>" +
      "<td>" + escapeHtml(row["Дата записи"] || "—") + "</td>" +
      "<td>" + attendancePill(row["Явка:"]) + "</td>" +
      "<td>" + escapeHtml(row["Имя оператора, взявшего в работу"] || "—") + "</td>" +
      "<td class='num'>" + (row.payment ? money(row.payment) : "—") + "</td>" +
      "<td class='num'>" + (row.plan_total ? money(row.plan_total) : "—") + "</td>" +
      "<td class='comment-cell'>" + escapeHtml(row["Комментарии:"] || "Без комментария") + "</td>" +
      "</tr>";
  }).join("") : "<tr><td colspan='7'><div class='empty-state'><div><strong>Ничего не найдено</strong>Измените поиск или фильтр статуса</div></div></td></tr>";

  document.getElementById("appts").innerHTML =
    "<thead><tr><th>Пациент</th><th>Дата записи</th><th>Явка</th><th>Оператор</th>" +
    "<th style='text-align:right'>Оплата</th><th style='text-align:right'>План</th><th>Комментарий</th></tr></thead>" +
    "<tbody>" + rows + "</tbody>";
}

function renderRefusals() {
  const categories = currentSlice.refusal_categories || [];
  const kpi = currentSlice.kpi;
  const total = categories.reduce(function (sum, category) {
    return sum + Number(category.count || 0);
  }, 0);

  document.getElementById("refTotal").textContent = total
    ? "— " + fmt(total) + " всего"
    : "";

  if (!total) {
    document.getElementById("refCats").innerHTML =
      "<div class='empty-state'><div><strong>Потерь нет</strong>За выбранный месяц причины отказов не зафиксированы</div></div>";
    return;
  }

  document.getElementById("refCats").innerHTML = categories.map(function (category, index) {
    const color = REFUSAL_COLORS[category.cat] || "#9fb2a6";
    const badge = index < 3 ? "<span class='top-badge'>топ-" + (index + 1) + "</span>" : "";
    const details = (category.items || []).map(function (item) {
      return "<div class='refusal-detail-row'>" +
        "<div><strong>" + escapeHtml(item["Имя:"] || "Без имени") + "</strong>" +
        "<small>" + escapeHtml(item["Имя оператора, взявшего в работу"] || "Без оператора") + "</small></div>" +
        "<div class='refusal-comment'>" + escapeHtml(item["Комментарии:"] || "Без комментария") + "</div>" +
        "</div>";
    }).join("");
    return "<details class='refusal-group' style='--cat-color:" + color + "'>" +
      "<summary><div class='refusal-summary'>" +
      "<div class='refusal-name'>" + escapeHtml(category.cat) + badge + "<span class='refusal-chevron'>⌄</span></div>" +
      "<div class='refusal-track'><div class='refusal-fill' data-width='" + Math.min(Number(category.share || 0), 100) + "'></div></div>" +
      "<div class='refusal-count'>" + fmt(category.count) + "<small>" + Number(category.share || 0).toFixed(1) + "%</small></div>" +
      "</div></summary>" +
      (details ? "<div class='refusal-details'>" + details + "</div>" : "") +
      "</details>";
  }).join("");

  document.getElementById("refTotal").title =
    "Отказ: " + fmt(kpi.refusals_total) + ", неактуал: " + fmt(kpi.neaktual_total);

  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      document.querySelectorAll(".refusal-fill").forEach(function (bar) {
        bar.style.width = bar.dataset.width + "%";
      });
    });
  });
}

function startCountdown(nextUpdateAt) {
  clearInterval(countdownTimer);
  clearTimeout(countdownTimer);
  const element = document.getElementById("nextUpdate");
  if (nextUpdateAt <= Date.now()) {
    element.textContent = "скоро";
    countdownTimer = setTimeout(loadData, 2 * 60 * 1000);
    return;
  }
  function update() {
    const remaining = nextUpdateAt - Date.now();
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      element.textContent = "обновляется";
      countdownTimer = setTimeout(loadData, 45 * 1000);
      return;
    }
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    element.textContent = minutes ? minutes + "м " + seconds + "с" : seconds + "с";
  }
  update();
  countdownTimer = setInterval(update, 1000);
}

function applyData(data) {
  DATA = data;
  const generatedAt = new Date(data.generated_at);
  const validGeneratedAt = !Number.isNaN(generatedAt.getTime());
  document.getElementById("generatedAt").textContent = validGeneratedAt
    ? formatMoscow(generatedAt)
    : (data.generated_at || "—");
  startCountdown(validGeneratedAt ? generatedAt.getTime() + 30 * 60 * 1000 : Date.now() + 30 * 60 * 1000);

  renderMonthButtons();
  const savedMonth = localStorage.getItem("goldenAppleDashboardMonth");
  const validKeys = data.months.map(function (month) { return month.key; });
  const initialMonth = savedMonth === "all" || validKeys.includes(savedMonth)
    ? savedMonth
    : validKeys[validKeys.length - 1];
  setActive(initialMonth);
}

function loadData() {
  fetch("data.json?t=" + Date.now(), { cache: "no-store" })
    .then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then(applyData)
    .catch(function (error) {
      console.error("Не удалось загрузить data.json", error);
      document.getElementById("nextUpdate").textContent = "ошибка";
      showToast("Не удалось загрузить данные. Проверьте data.json и обновите страницу.");
    });
}

function init() {
  renderSkeletons();
  document.getElementById("appointmentSearch").addEventListener("input", function () {
    if (currentSlice) renderAppointments();
  });
  document.getElementById("attendanceFilter").addEventListener("change", function () {
    if (currentSlice) renderAppointments();
  });
  loadData();
}

init();
