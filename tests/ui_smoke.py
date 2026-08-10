import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


OUTPUT_DIR = Path("/tmp/zolotoeyabloko-ui")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DATA = json.loads(Path("docs/data.json").read_text())
EXPECTED_TOTAL = DATA["all"]["kpi"]["total"]
EXPECTED_MONTH_BUTTONS = len(DATA["months"]) + 1
LATEST_MONTH = DATA["months"][-1]["key"]
EXPECTED_LATEST_OPERATORS = len(DATA["by_month"][LATEST_MONTH]["operator_stats"])


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    console_errors = []
    page_errors = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    page.goto("http://127.0.0.1:8765")
    page.wait_for_load_state("networkidle")
    expect(page).to_have_title("Пульс месяца — Омск")
    expect(page.locator("html")).to_have_attribute("data-theme", "light")
    expect(page.locator(".theme-option")).to_have_count(2)
    expect(page.locator("#themeLight")).to_be_visible()
    expect(page.locator("#themeDark")).to_be_visible()
    expect(page.locator("#themeLight")).to_have_attribute("aria-pressed", "true")
    expect(page.locator("#themeDark")).to_have_attribute("aria-pressed", "false")
    page.locator("#themeDark").click()
    expect(page.locator("html")).to_have_attribute("data-theme", "dark")
    expect(page.locator("#themeDark")).to_have_attribute("aria-pressed", "true")
    page.locator("#themeLight").click()
    expect(page.locator("html")).to_have_attribute("data-theme", "light")
    expect(page.locator(".brand")).not_to_contain_text("Золотое Яблоко")
    expect(page.locator("#monthFilter button")).to_have_count(EXPECTED_MONTH_BUTTONS)
    expect(page.locator(".kpi-card")).to_have_count(8)
    expect(page.locator("#monthFilter button.active")).to_have_count(1)
    expect(page.locator(".compare-row")).to_have_count(6)
    expect(page.locator("#monthComparisonSummary")).to_contain_text("против")
    expect(page.locator("#operatorHeatmap tbody tr")).to_have_count(
        EXPECTED_LATEST_OPERATORS
    )
    assert page.locator("#operatorHeatmap .heat-cell").count() > 0
    assert page.locator("#operatorHeatmap .low-sample").count() > 0
    expect(page.locator(".heatmap-legend")).to_have_count(0)
    expect(page.locator(".operator-details-heading span")).to_have_count(0)
    page.locator(".comparison-section").screenshot(
        path=OUTPUT_DIR / "comparison.png"
    )
    page.locator(".heatmap-card").screenshot(path=OUTPUT_DIR / "heatmap.png")

    page.get_by_role("button", name="Весь период").click()
    expect(page.locator("#activePeriodLabel")).to_have_text("Весь период")
    expect(page.locator("#monthComparison")).to_contain_text(
        "Сравнение пока недоступно"
    )
    expect(page.locator("#heroTotal")).to_have_text(
        f"{EXPECTED_TOTAL:,}".replace(",", " "), timeout=2_000
    )
    operator_names = set(
        page.locator("#ops tbody tr td:first-child strong").all_inner_texts()
    )
    assert "Лена" in operator_names
    assert "Елена" not in operator_names
    assert "Галина" in operator_names
    assert "Галя" not in operator_names

    page.locator("#ops [data-sort='zapis']").click()
    expect(page.locator("#ops th").nth(3)).to_have_attribute("aria-sort", "descending")

    page.locator("#appointmentSearch").fill("zzzz-no-result")
    expect(page.locator("#appts")).to_contain_text("Ничего не найдено")
    page.locator("#appointmentSearch").fill("")

    page.locator(".refusal-group summary").first.click()
    expect(page.locator(".refusal-group").first).to_have_attribute("open", "")
    page.screenshot(path=OUTPUT_DIR / "desktop.png", full_page=True)

    assert not console_errors, console_errors
    assert not page_errors, page_errors
    page.route("**/data.json*", lambda route: route.abort())
    page.evaluate("loadData()")
    page.wait_for_timeout(1_800)
    expect(page.locator("#nextUpdate")).to_have_text("повтор через 2 мин")
    assert "visible" not in page.locator("#toast").get_attribute("class").split()
    page.unroute("**/data.json*")
    assert all("ERR_FAILED" in error for error in console_errors), console_errors
    console_errors.clear()

    mobile = browser.new_page(viewport={"width": 390, "height": 844})
    mobile_errors = []
    mobile.on("pageerror", lambda error: mobile_errors.append(str(error)))
    mobile.goto("http://127.0.0.1:8765")
    mobile.wait_for_load_state("networkidle")
    expect(mobile.locator(".kpi-card")).to_have_count(8)
    expect(mobile.locator("#monthFilter button")).to_have_count(EXPECTED_MONTH_BUTTONS)
    expect(mobile.locator("html")).to_have_attribute("data-theme", "light")
    expect(mobile.locator("#themeLight")).to_be_visible()
    expect(mobile.locator("#themeDark")).to_be_visible()
    expect(mobile.locator(".heatmap-legend")).to_have_count(0)
    body_widths = mobile.evaluate(
        "() => ({scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth})"
    )
    assert body_widths["scroll"] <= body_widths["client"] + 1, body_widths
    mobile.screenshot(path=OUTPUT_DIR / "mobile.png", full_page=True)

    assert not console_errors, console_errors
    assert not page_errors, page_errors
    assert not mobile_errors, mobile_errors
    print("UI smoke passed:", body_widths)
    browser.close()
